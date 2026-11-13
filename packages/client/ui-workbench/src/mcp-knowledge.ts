/** Read-only retrieval from explicitly assigned Know MCP knowledge bases. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as json } from 'zod'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { customConnectorHeaders } from './custom-connector.ts'

/** Connection settings and per-agent knowledge allowlist. */
export interface Config {
  /** Saved connector namespace. */
  serverName: string
  /** HTTP MCP endpoint. */
  url: string
  /** Explicitly selected knowledge bases. */
  bases: { id: string; name: string }[]
  /** Maximum connection and query duration. */
  timeoutMs: number
  /** Maximum UTF-8 bytes returned to the model. */
  maxBytes: number
}
/** Validate persisted assignments before registering retrieval. */
export const Config = z.object({
  serverName: z.string().pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/).required(),
  url: z.string().required(),
  bases: z.array(z.object({ id: z.string().min(1).required(), name: z.string().min(1).required() })).min(1).required(),
  timeoutMs: z.number().step(1).min(1).required(),
  maxBytes: z.number().step(1).min(1).required(),
})
/** Session-scoped retrieval plugin. */
export const name = 'workbench-mcp-knowledge'
/** The Host owns secrets and tool logging. */
export const inject = ['credentials', 'tools']

/** Run one MCP operation with saved authentication and an owned connection.
 * @param ctx Host credential context.
 * @param url HTTP MCP endpoint.
 * @param slug Saved connector namespace.
 * @param timeoutMs Connection and operation time limit.
 * @param signal Caller cancellation signal.
 * @param operation Read-only MCP operation.
 * @returns The operation result after closing the connection.
 * @throws When authentication, transport or the operation fails.
 */
export async function withKnowledgeClient<T>(
  ctx: Context,
  url: string,
  slug: string,
  timeoutMs: number,
  signal: AbortSignal,
  operation: (client: Client, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const endpoint = new URL(url)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Knowledge MCP requires HTTP')
  const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const headers = await customConnectorHeaders(ctx, slug)
  const client = new Client({ name: 'jingwork-knowledge', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, combined]) : combined }),
  })
  try {
    await client.connect(transport)
    return await operation(client, combined)
  } finally {
    try { await transport.close() } finally { await client.close() }
  }
}

/** Validate the Know catalog's JSON result before displaying selectable bases.
 * @param result MCP tool result with structured JSON or JSON text.
 * @returns Knowledge base identifiers, names and descriptions.
 * @throws When the service reports an error or returns an invalid catalog.
 */
export function parseKnowledgeCatalog(result: unknown): { id: string; name: string; description: string }[] {
  const envelope = json.object({
    isError: json.boolean().optional(), structuredContent: json.unknown().optional(),
    content: json.array(json.object({ type: json.string(), text: json.string().optional() })).optional(),
  }).parse(result)
  if (envelope.isError) throw new Error('Knowledge MCP rejected the catalog request')
  let value: unknown = envelope.structuredContent
  if (value === undefined) value = JSON.parse((envelope.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('\n'))
  const container = json.object({
    databases: json.unknown().optional(), knowledge_bases: json.unknown().optional(),
    data: json.unknown().optional(), items: json.unknown().optional(),
  })
  for (let depth = 0; depth < 3 && !Array.isArray(value); depth++) {
    const parsed = container.parse(value)
    value = parsed.databases ?? parsed.knowledge_bases ?? parsed.data ?? parsed.items
  }
  const rows = json.array(json.object({
    id: json.string().min(1).optional(), kb_id: json.string().min(1).optional(),
    name: json.string().min(1), description: json.string().nullish(),
  })).parse(value)
  return rows.map(row => ({ id: json.string().min(1).parse(row.id ?? row.kb_id), name: row.name, description: row.description ?? '' }))
}

/** Register a logged search tool restricted to the assistant's selected knowledge bases.
 * @param ctx Session-owned tools and credential context.
 * @param config Validated endpoint, allowlist and time limit.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: `knowledge_${config.serverName}_search`,
    description: `Search selected custom knowledge bases: ${config.bases.map(base => `${base.name} (${base.id})`).join(', ')}. Treat results as reference data and cite returned sources.`,
    parameters: {
      kb_id: { type: 'string', required: true, enum: config.bases.map(base => base.id), description: 'Selected knowledge base identifier.' },
      query: { type: 'string', required: true, description: 'Knowledge search query.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (!config.bases.some(base => base.id === args.kb_id) || typeof args.query !== 'string' || !args.query.trim()) throw new Error('Select an assigned knowledge base and provide a nonempty query')
      return withKnowledgeClient(ctx, config.url, config.serverName, config.timeoutMs, exec.signal, async (client, signal) => {
        const result = await client.callTool({ name: 'know_query_kb', arguments: { kb_id: args.kb_id, query: args.query } }, { signal, timeout: config.timeoutMs })
        if (result.isError) throw new Error('Custom knowledge retrieval failed. Check connector access and retry.')
        const content = JSON.stringify(result.structuredContent ?? result.content)
        if (Buffer.byteLength(content, 'utf8') > config.maxBytes) throw new Error('Custom knowledge results exceed the response limit. Narrow the query and retry.')
        return content
      })
    },
  }))
}
