/** Host-side MCP handshake tests with transient keys and deterministic connection cleanup. */
import { Context } from '@deepseek-ai/cordis'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { connectorCredentialRef } from './connector-catalog.ts'
import { withKnowledgeClient, parseKnowledgeCatalog } from './mcp-knowledge.ts'
import { bearerHeaders, customConnectorHeaders } from './custom-connector.ts'

/** Deployment-owned time limit for a connection test. */
export interface ConnectorTestPolicy {
  /** Maximum elapsed request time in milliseconds. */
  timeoutMs: number
}

/** Tests negotiate MCP and verify Know catalog access without saving settings or credentials. */
export class ConnectorController extends TypertRemoteService {
  static inject = ['typert', 'credentials']
  private readonly lifetime = new AbortController()

  /**
   * @param ctx Host context carrying credentials and Remote registration.
   * @param config Deployment test limits.
   */
  constructor(ctx: Context, private readonly config: ConnectorTestPolicy) {
    super(ctx, 'workbenchConnectors', { namespace: 'workbenchConnectors' })
    ctx.effect(() => () => { this.lifetime.abort() }, 'workbench: connector test lifetime')
  }

  /** Merge optional draft headers with saved authentication without exposing stored values.
   * @param slug Existing or newly allocated connector namespace.
   * @param authorization Draft Authorization value, empty to retain the saved value.
   * @param linkerApiKey Draft X-Linker-Api-Key, empty to retain the saved value.
   * @returns Whether credentials were stored successfully.
   */
  @Remote
  async saveCredentials(slug: string, authorization: string, linkerApiKey: string): Promise<boolean> {
    const request = z.object({
      slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
      authorization: z.string().max(65536),
      linkerApiKey: z.string().max(65536),
    }).safeParse({ slug, authorization, linkerApiKey })
    if (!request.success) return false
    try {
      const headers = await customConnectorHeaders(this.ctx, slug)
      if (authorization.trim()) Object.assign(headers, bearerHeaders(authorization))
      if (linkerApiKey.trim()) headers['X-Linker-Api-Key'] = linkerApiKey.trim()
      if (!headers.Authorization?.trim()) return false
      await this.ctx.credentials.set(credentialRef(connectorCredentialRef(slug)), JSON.stringify({
        authorization: headers.Authorization, linker_api_key: headers['X-Linker-Api-Key'] ?? '',
      }))
      return true
    } catch (_error: unknown) {
      // Credential failures return a status without including secret values.
      return false
    }
  }

  /** List authorized knowledge bases from a compatible saved MCP connector.
   * @param url HTTP MCP endpoint.
   * @param slug Saved connector namespace.
   * @param signal Request cancellation signal.
   * @returns Validated bases, unsupported service status, or a safe failure status.
   */
  @Remote
  async listKnowledge(url: string, slug: string, signal?: AbortSignal): Promise<{
    status: 'ready' | 'unsupported' | 'upstream-error' | 'failed'
    bases: { id: string; name: string; description: string }[]
  }> {
    const input = { url, slug }
    const valid = z.object({
      url: z.url(), slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
    }).safeParse(input).success
    if (!valid) return { status: 'failed', bases: [] }
    try {
      const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])])
      return await withKnowledgeClient(this.ctx, url, slug, this.config.timeoutMs, combined, async (client, abort) => {
        const names = new Set<string>()
        let cursor: string | undefined
        do {
          const page = await client.listTools({ cursor }, { signal: abort, timeout: this.config.timeoutMs })
          for (const tool of page.tools) names.add(tool.name)
          cursor = page.nextCursor
        } while (cursor)
        if (!names.has('know_list_kb') || !names.has('know_query_kb')) return { status: 'unsupported', bases: [] }
        const result = await client.callTool({ name: 'know_list_kb', arguments: { include_stats: false } }, { signal: abort, timeout: this.config.timeoutMs })
        if (result.isError) return { status: 'upstream-error', bases: [] }
        return { status: 'ready', bases: parseKnowledgeCatalog(result) }
      })
    } catch (_error: unknown) {
      // Server bodies may contain credentials and are excluded from Client error reports.
      return { status: 'failed', bases: [] }
    }
  }

  /** Read names and descriptions from the saved connector's current MCP tool catalog.
   * @param url HTTP MCP service address.
   * @param slug Saved credential namespace.
   * @param signal Request cancellation signal.
   * @returns Connection status and the complete tool catalog.
   */
  @Remote
  async listTools(url: string, slug: string, signal?: AbortSignal): Promise<{ status: 'connected' | 'invalid' | 'failed'; tools: { name: string; description: string }[] }> {
    return this.inspect(url, '', slug, undefined, signal)
  }

  /** Verify MCP discovery and, for Know servers, authorized catalog access.
   * @param url HTTP MCP service address.
   * @param key Draft Authorization value, empty to retain the saved value.
   * @param slug Existing connector namespace, empty for an unsaved connector.
   * @param linkerApiKey Optional draft X-Linker-Api-Key, empty to retain the saved value.
   * @param signal Request cancellation signal.
   * @returns A safe status without server response bodies or credential values.
   */
  @Remote
  async test(url: string, key: string, slug: string, linkerApiKey?: string, signal?: AbortSignal): Promise<'connected' | 'invalid' | 'failed'> {
    return (await this.inspect(url, key, slug, linkerApiKey, signal, true)).status
  }

  private async inspect(url: string, key: string, slug: string, linkerApiKey?: string, signal?: AbortSignal, verifyKnowledge = false): Promise<{ status: 'connected' | 'invalid' | 'failed'; tools: { name: string; description: string }[] }> {
    const request = z.object({
      url: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)),
      key: z.string().max(65536),
      linkerApiKey: z.string().max(65536).optional(),
      slug: z.union([z.literal(''), z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)]),
    }).safeParse({ url, key, slug, linkerApiKey })
    if (!request.success) return { status: 'invalid', tools: [] }
    const client = new Client({ name: 'jingwork-connector-test', version: '1.0.0' })
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([this.lifetime.signal, timeout, ...(signal ? [signal] : [])])
    let connected = false
    const tools: { name: string; description: string }[] = []
    try {
      const headers = slug ? await customConnectorHeaders(this.ctx, slug) : {}
      if (key.trim()) Object.assign(headers, bearerHeaders(key))
      if (linkerApiKey?.trim()) headers['X-Linker-Api-Key'] = linkerApiKey.trim()
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers },
        fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, combined]) : combined }),
      })
      try {
        await client.connect(transport)
        let cursor: string | undefined
        do {
          const page = await client.listTools({ cursor }, { signal: combined, timeout: this.config.timeoutMs })
          tools.push(...page.tools.map(tool => ({ name: tool.name, description: tool.description ?? '' })))
          cursor = page.nextCursor
        } while (cursor)
        if (verifyKnowledge && tools.some(tool => tool.name === 'know_list_kb')) {
          const result = await client.callTool({ name: 'know_list_kb', arguments: { include_stats: false } }, {
            signal: combined, timeout: this.config.timeoutMs,
          })
          parseKnowledgeCatalog(result)
        }
        connected = true
      } finally {
        await transport.close()
      }
    } catch (_error: unknown) {
      // Remote failures expose only a localized status, never server text containing secrets.
      connected = false
    } finally {
      await client.close()
    }
    return { status: connected ? 'connected' : 'failed', tools: connected ? tools : [] }
  }
}
