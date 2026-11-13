/** Custom HTTP MCP connections resolving optional HTTP authentication headers from the local credential store. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { z as json } from 'zod'
import { apply as applyMcp, Config as McpConfig, inject as mcpInject, name as mcpName } from '@deepseek-ai/dsh-mcp-client'
import { connectorCredentialRef } from './connector-catalog.ts'

/** Saved HTTP endpoint and stable credential namespace. */
export interface Config {
  /** Credential and MCP tool namespace. */
  serverName: string
  /** HTTP MCP endpoint. */
  url: string
}
/** Validate endpoint settings before activation. */
export const Config = z.object({
  serverName: z.string().pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/).required(),
  url: z.string().required(),
})
/** Session-owned custom connector plugin. */
export const name = 'workbench-custom-connector'
/** Credentials stay on the Host throughout activation. */
export const inject = ['credentials', 'tools']

/** Resolve the saved optional authentication headers without returning it to the Client.
 * @param ctx Host credential context.
 * @param slug Connector namespace.
 * @returns Authentication headers, empty for an unauthenticated server.
 * @throws When a stored credential cannot be parsed.
 */
export async function customConnectorHeaders(ctx: Context, slug: string): Promise<Record<string, string>> {
  const hit = await ctx.credentials.resolve(credentialRef(connectorCredentialRef(slug)))
  if (!hit) return {}
  const value = json.object({
    api_key: json.string().optional(),
    authorization: json.string().optional(),
    linker_api_key: json.string().optional(),
  }).parse(JSON.parse(hit.value))
  const headers = value.authorization === undefined ? bearerHeaders(value.api_key ?? '') : {}
  if (value.authorization?.trim()) Object.assign(headers, bearerHeaders(value.authorization))
  if (value.linker_api_key?.trim()) headers['X-Linker-Api-Key'] = value.linker_api_key.trim()
  return headers
}

/** Convert a user-entered key to the Authorization header.
 * @param key Optional raw key or bearer value.
 * @returns HTTP headers for the MCP service.
 */
export function bearerHeaders(key: string): Record<string, string> {
  const value = key.trim()
  return value ? { Authorization: /^Bearer\s/i.test(value) ? value : `Bearer ${value}` } : {}
}

/** Activate the standard MCP client using Host-resolved credentials.
 * @param ctx Session plugin context.
 * @param config Saved endpoint and namespace.
 * @returns Once initial MCP activation succeeds.
 * @throws When credentials or the server cannot be loaded.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const url = new URL(config.url)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Connector must use HTTP')
  const headers = await customConnectorHeaders(ctx, config.serverName)
  await ctx.plugin({ apply: applyMcp, Config: McpConfig, inject: mcpInject, name: mcpName }, {
    transport: 'streamable-http', serverName: config.serverName, url: config.url, headers, failOnStartupError: true,
  }).await()
}
