/** Session-scoped built-in connectors with Host-only credential resolution. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as json } from 'zod'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  apply as applyMcpClient,
  Config as McpConfig,
  inject as mcpInject,
  name as mcpName,
} from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-tools'
import { builtinConnector, connectorCredentialRef } from './connector-catalog.ts'
import { CONNECTOR_TOOL_SCHEMAS } from './connector-tool-schemas.ts'
import {
  callConnectorGateway,
  ConnectorRequestError,
  type ConnectorCredentials,
  type ConnectorRequestPolicy,
} from './connector-gateway.ts'
import { callConnectorMail } from './connector-mail.ts'

/** Built-in selection and deployment-owned vendor request limits. */
export interface Config extends ConnectorRequestPolicy {
  /** Maximum message summaries returned by one mailbox search. */
  maxMailResults: number
  /** Bundled connector identity. */
  kind: string
  /** Unique namespace matching the saved workbench key. */
  serverName: string
}
/** Defaults apply once when the session-scoped plugin loads. */
export const Config = z.object({
  kind: z.string().required(),
  serverName: z
    .string()
    .pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .required(),
  timeoutMs: z.number().step(1).min(1).default(60000),
  maxResponseBytes: z.number().step(1).min(1).default(1048576),
  maxMailResults: z.number().step(1).min(1).default(50),
})
/** Session-scoped plugin identity. */
export const name = 'workbench-connector'

/** The local credential provider and normal scoped tool registry. */
export const inject = ['credentials', 'tools']

/** Start the selected official MCP server or register native gateway tools.
 * @param ctx The expert's scoped plugin context.
 * @param config Validated catalog identity and request limits.
 * @returns After credentials are admitted and the initial MCP connection is mounted.
 * @throws When configuration, credentials or initial MCP activation is invalid.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const entry = builtinConnector(config.kind)
  if (!entry) throw new Error('Unknown built-in connector')
  const read = async (): Promise<ConnectorCredentials> => {
    const hit = await ctx.credentials.resolve(credentialRef(connectorCredentialRef(config.serverName)))
    if (!hit) throw new ConnectorRequestError('credentials')
    let value: unknown
    try {
      value = JSON.parse(hit.value)
    } catch (_error: unknown) {
      throw new ConnectorRequestError('credentials')
    }
    const credentials = json.record(json.string(), json.string()).safeParse(value)
    if (!credentials.success || entry.fields.some(field => !credentials.data[field]?.trim()))
      throw new ConnectorRequestError('credentials')
    if (config.kind === 'wechat-reading' && !credentials.data.api_key?.startsWith('wrk-'))
      throw new ConnectorRequestError('credentials')
    if (config.kind === 'qq-music' && !credentials.data.api_key?.startsWith('qmk-'))
      throw new ConnectorRequestError('credentials')
    return credentials.data
  }
  const creds = await read()
  const remote = remoteSpec(config.kind, creds)
  if (remote) {
    await ctx
      .plugin(
        { apply: applyMcpClient, Config: McpConfig, inject: mcpInject, name: mcpName },
        {
          transport: 'streamable-http',
          serverName: config.serverName,
          ...remote,
          toolCallTimeoutMs: config.timeoutMs,
          failOnStartupError: true,
        },
      )
      .await()
    return
  }
  const schemas = CONNECTOR_TOOL_SCHEMAS[config.kind]
  if (!schemas) throw new Error('Built-in connector has no tool adapter')
  for (const schema of schemas) {
    const argsSchema = json.fromJSONSchema(schema.inputSchema)
    ctx.tools.register({
      name: `mcp__${config.serverName}__${schema.name}`,
      description: schema.description,
      parameters: schema.inputSchema,
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: json.string().parse(value) }],
      },
      execute: async (input, exec) => {
        const args = json.record(json.string(), json.unknown()).parse(argsSchema.parse(input))
        const current = await read()
        return config.kind === 'qq-mail'
          ? callConnectorMail(current, schema.name, args, exec.signal, config)
          : callConnectorGateway(config.kind, current, schema.name, args, exec.signal, config)
      },
      presentCall: args => ({
        card: 'generic',
        title: `${config.serverName} · ${schema.name}`,
        rawInput: args,
      }),
    })
  }
}

function remoteSpec(
  kind: string,
  creds: ConnectorCredentials,
): { url: string; headers: Record<string, string> } | undefined {
  switch (kind) {
    case 'tencent-docs':
      return {
        url: 'https://docs.qq.com/openapi/mcp',
        headers: { Authorization: json.string().parse(creds.token) },
      }
    case 'tencent-meeting':
      return {
        url: 'https://mcp.meeting.tencent.com/mcp/wemeet-open/v1',
        headers: { 'X-Tencent-Meeting-Token': json.string().parse(creds.token), 'X-Skill-Version': 'v1.0.1' },
      }
    case 'tencent-weiyun': {
      const raw = json
        .string()
        .parse(creds.token)
        .trim()
        .replace(/^["']|["']$/g, '')
      const token =
        /mcp_token=([^\s;,&"']+)/i.exec(raw)?.[1] ??
        /WEIYUN_MCP_TOKEN\s*=\s*['"]?([^'"\s]+)/i.exec(raw)?.[1] ??
        raw
      return { url: 'https://www.weiyun.com/api/v3/mcpserver', headers: { WyHeader: `mcp_token=${token}` } }
    }
    case 'tencent-lexiang':
      return {
        url: `https://mcp.lexiang-app.com/mcp?company_from=${encodeURIComponent(json.string().parse(creds.client_id))}&preset=meta`,
        headers: { Authorization: `Bearer ${creds.api_key}` },
      }
    default:
      return undefined
  }
}
