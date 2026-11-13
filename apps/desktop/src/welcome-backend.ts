import type { ProductEvent } from '@deepseek-ai/dsh-client-product-analytics/types'
/** Native welcome operations using the shared Web authentication and RPC APIs. */

import { conversationLogSource, type ConversationLogSource } from './conversation-log-source.ts'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { load as loadYaml } from 'js-yaml'
import type { JingworkRole, JingworkModelCatalog } from './jingwork-auth.ts'
import { desktopAccountBackend, type DesktopAccountBackend } from './account-backend.ts'

/** Metadata needed before the native entry or workspace becomes visible. */
export interface WelcomeState {
  readonly loggedIn: boolean
  readonly hasApiKey: boolean
  readonly writable: boolean
  readonly localePreference: string | null
}

/** Narrow operations available to the native welcome flow. */
export interface DesktopWelcomeBackend {
  /** @returns the current Host policy; every read observes live configuration. */
  analyticsEnabled(): Promise<boolean>
  readonly account: DesktopAccountBackend
  /** Passive committed-message reads for native backend log delivery. */
  readonly conversationLogs: ConversationLogSource
  /** Synchronize a role with revision-fenced settings and await its native preset.
   * @param role Latest backend role.
   * @param timeoutMs Deployment request deadline in milliseconds.
   * @returns Ready Harness preset id.
   */
  prepareEnterprise(role: JingworkRole, timeoutMs: number): Promise<string>
  /** Register enterprise models through the existing adapter settings and private credentials.
   * @param catalog Account-authorized public directory.
   * @param connection Current process's private model relay.
   * @returns The saved enterprise default, or null when the default uses a personal provider.
   */
  syncModels(catalog: JingworkModelCatalog, connection: { baseURL: string; token: string }): Promise<string | null>
  /** Save a previously synchronized enterprise model as the default for new sessions.
   * @param model Server-owned model identifier.
   */
  setEnterpriseModel(model: string): Promise<void>
  /** @param event - desktop-owned fields. @returns after local Host intake. */
  report(event: ProductEvent): Promise<void>
  /** @returns Configured-key presence and the shared language preference, without credential values. */
  read(): Promise<WelcomeState>
  /** @returns The saved UI language without account or provider requests. */
  readLocalePreference(): Promise<string | null>
  /**
   * @param apiKey - User-entered official provider key.
   * @returns A safe write outcome without provider diagnostics.
   */
  save(apiKey: string): Promise<{ ok: boolean }>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Authenticate the native HTTP client through the Web application's launch URL.
 * @param authenticatedUrl - URL supplied by the running Desktop Host.
 * @param send - Electron session fetch, retaining the Web authentication cookie.
 * @returns metadata reads and write-only credential operations over standard RPC.
 */
export async function connectDesktopWelcome(
  authenticatedUrl: string,
  send: (input: string, init?: RequestInit) => Promise<Response>,
  cookies: () => Promise<string> = () => Promise.resolve(''),
): Promise<DesktopWelcomeBackend> {
  const origin = new URL(authenticatedUrl).origin
  const authenticated = await send(authenticatedUrl, { credentials: 'include' })
  await authenticated.body?.cancel()
  if (!authenticated.ok) throw new Error('desktop welcome: Web authentication failed')
  const invoke = async (
    request: { namespace: string; method: string; args: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const rpcId = randomUUID()
    const method = `${request.namespace}/${request.method}`
    const response = await send(new URL(`/api/${method}`, origin).href, {
      method: 'POST', credentials: 'include', redirect: 'error', ...(signal === undefined ? {} : { signal }),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: request.args } }),
    })
    if (!response.ok) throw new Error('desktop welcome: Web request failed')
    const envelope: unknown = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) {
      throw new Error('desktop welcome: Web RPC failed')
    }
    return envelope.result.value
  }
  const account = desktopAccountBackend(origin, invoke, cookies)
  const settingsAndReference = async () => {
    const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
    if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
    const official: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'llm-deepseek')
    if (official === undefined) return { settings: { namespaces: settings.namespaces }, ref: undefined }
    if (!record(official) || !record(official.value) || typeof official.value.apiKeyEnv !== 'string') {
      throw new Error('desktop welcome: missing official DeepSeek credential reference')
    }
    return { settings: { namespaces: settings.namespaces }, ref: official.value.apiKeyEnv }
  }
  const localePreference = (namespaces: unknown[]): string | null => {
    const locale: unknown = namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
    if (!record(locale) || !record(locale.value)
      || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
      throw new Error('desktop welcome: invalid locale preference')
    }
    return locale.value.preference ?? null
  }
  const read = async (): Promise<WelcomeState> => {
    const { settings, ref } = await settingsAndReference()
    const providers = await invoke({ namespace: 'llm', method: 'listConfigurableProviders', args: {} })
    if (!Array.isArray(providers)) throw new Error('desktop welcome: invalid provider directory')
    const namespaces = settings.namespaces
    const refs = providers.flatMap((provider: unknown) => {
      if (!record(provider) || typeof provider.settingsNs !== 'string' || !Array.isArray(provider.settingsPath)) {
        throw new Error('desktop welcome: invalid provider settings address')
      }
      const namespace: unknown = namespaces.find((item: unknown) => record(item) && item.ns === provider.settingsNs)
      let value: unknown = record(namespace) ? namespace.value : undefined
      for (const key of provider.settingsPath as unknown[]) {
        if (typeof key !== 'string') throw new Error('desktop welcome: invalid provider settings path')
        value = record(value) ? value[key] : undefined
      }
      return record(value) && typeof value.apiKeyEnv === 'string' ? [value.apiKeyEnv] : []
    })
    const unique = [...new Set([...(ref === undefined ? [] : [ref]), ...refs])]
    const states: Record<string, unknown> = {}
    // credentials.describe accepts at most 64 references per request.
    for (let offset = 0; offset < unique.length; offset += 64) {
      const batch = await invoke({ namespace: 'credentials', method: 'describe', args: { refs: unique.slice(offset, offset + 64) } })
      if (!record(batch)) throw new Error('desktop welcome: invalid credential metadata')
      Object.assign(states, batch)
    }
    if (ref !== undefined && !record(states[ref])) throw new Error('desktop welcome: missing credential metadata')
    return {
      loggedIn: (await account.state()).status === 'credential-stored',
      hasApiKey: Object.values(states).some(value => record(value) && value.configured === true),
      writable: ref !== undefined && record(states[ref]) && states[ref].writable === true,
      localePreference: localePreference(namespaces),
    }
  }
  return {
    account,
    conversationLogs: conversationLogSource(origin, invoke, cookies),
    read,
    async prepareEnterprise(role, timeoutMs) {
      const signal = AbortSignal.timeout(timeoutMs)
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} }, signal)
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('Harness settings are unavailable')
      const namespace: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'ui-workbench')
      if (!record(namespace) || !record(namespace.value) || !Array.isArray(namespace.value.experts)
        || typeof namespace.revision !== 'number') throw new Error('Harness workbench is unavailable')
      const experts: unknown[] = namespace.value.experts
      const previous = experts.find(item => record(item) && item.slug === role.slug)
      if (previous !== undefined && (!record(previous) || previous.category !== 'enterprise')) {
        throw new Error('Harness enterprise role conflicts with a personal agent')
      }
      if (JSON.stringify(previous) !== JSON.stringify(role)) {
        await invoke({ namespace: 'settings', method: 'update', args: {
          ns: 'ui-workbench', patch: { experts: [...experts.filter(item => !record(item) || item.slug !== role.slug), role] },
          expectedRevision: namespace.revision,
        } }, signal)
      }
      const id = `workbench-${role.slug}`
      while (!signal.aborted) {
        const roster = await invoke({ namespace: 'agentPresets', method: 'list', args: {} }, signal)
        if (!record(roster) || !Array.isArray(roster.presets)) throw new Error('Harness preset directory is unavailable')
        const preset: unknown = roster.presets.find((item: unknown) => record(item) && item.id === id)
        if (record(preset)) {
          if (preset.broken) throw new Error('Harness enterprise preset could not be activated')
          const document = await invoke({ namespace: 'agentPresets', method: 'read', args: { agentPreset: id } }, signal)
          if (!record(document) || typeof document.content !== 'string') throw new Error('Harness preset document is unavailable')
          const plugins: unknown = loadYaml(document.content)
          const persona: unknown = Array.isArray(plugins)
            ? plugins.find((item: unknown) => record(item) && item.id === 'persona') : undefined
          if (record(persona) && record(persona.config) && persona.config.prefix === role.instructions
            && document.name === role.name && document.description === role.description) return id
        }
        await delay(100, undefined, { signal })
      }
      throw new Error('Harness enterprise preset activation timed out')
    },
    async syncModels(catalog, connection) {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('Model settings are unavailable')
      const namespace: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'llm-pi-ai')
      const defaults: unknown = settings.namespaces.find((item: unknown) => record(item) && item.ns === 'agent-default-model')
      if (!record(namespace) || typeof namespace.revision !== 'number' || !record(namespace.value)
        || !record(namespace.value.providers)) throw new Error('Enterprise model adapter is unavailable')
      const route = 'jingwork-enterprise'
      if (catalog.models.length === 0) {
        if (namespace.value.providers[route] !== undefined) {
          await invoke({ namespace: 'settings', method: 'mutate', args: {
            ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', route] }], expectedRevision: namespace.revision,
          } })
        }
      } else {
        await invoke({ namespace: 'credentials', method: 'set', args: { ref: 'JINGWORK_ENTERPRISE_MODEL_TOKEN', value: connection.token } })
        const profile = {
          displayName: 'JingWork', api: 'openai-completions', baseURL: connection.baseURL,
          apiKeyEnv: 'JINGWORK_ENTERPRISE_MODEL_TOKEN',
          models: catalog.models.map(model => ({ id: model.id, name: model.name, input: model.input ?? ['text'] })),
        }
        if (JSON.stringify(namespace.value.providers[route]) !== JSON.stringify(profile)) {
          await invoke({ namespace: 'settings', method: 'mutate', args: {
            ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', route], value: profile }], expectedRevision: namespace.revision,
          } })
        }
      }
      return record(defaults) && record(defaults.value) && defaults.value.provider === route
        && typeof defaults.value.model === 'string' ? defaults.value.model : null
    },
    async setEnterpriseModel(model) {
      await invoke({ namespace: 'settings', method: 'mutate', args: {
        ns: 'agent-default-model', ops: [
          { op: 'set', path: ['provider'], value: 'jingwork-enterprise' },
          { op: 'set', path: ['model'], value: model },
          { op: 'unset', path: ['reasoningEffort'] },
        ],
      } })
    },
    async analyticsEnabled() {
      const enabled = await invoke({ namespace: 'productAnalytics', method: 'enabled', args: {} }, AbortSignal.timeout(1000))
      if (typeof enabled !== 'boolean') throw new Error('desktop analytics: invalid collection policy')
      return enabled
    },
    async report(event) { await invoke({ namespace: 'productAnalytics', method: 'report', args: { event } }, AbortSignal.timeout(1000)) },
    async readLocalePreference() {
      const settings = await invoke({ namespace: 'settings', method: 'describe', args: {} })
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop welcome: missing settings namespaces')
      return localePreference(settings.namespaces)
    },
    async save(apiKey) {
      if (!/^[\x21-\x7e]+$/.test(apiKey)) return { ok: false }
      try {
        const { ref } = await settingsAndReference()
        if (ref === undefined) return { ok: false }
        await invoke({ namespace: 'credentials', method: 'set', args: { ref, value: apiKey } })
        return { ok: true }
      } catch {
        // Provider diagnostics may contain credentials; the native form owns failure copy.
        return { ok: false }
      }
    },
  }
}
