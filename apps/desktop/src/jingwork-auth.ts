/** Jingwork's browser authorization protocol and encrypted desktop credential cache. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { DesktopClientLog } from './jingwork-client-logs.ts'
import type { CapturedConversationEvent } from './conversation-log-source.ts'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Desktop authentication deployment settings. */
export interface JingworkLoginConfig {
  /** Jingwork web origin serving its login page and /api proxy. */
  readonly url: string
  /** Timeout of each backend request in milliseconds. */
  readonly requestTimeoutMs: number
  /** Scan and retry interval for desktop conversation log delivery. */
  readonly conversationLogIntervalMs?: number
}
/** Public enterprise model directory; upstream credentials remain server-owned. */
export interface JingworkModelCatalog {
  models: { id: string; name: string; provider: string; input?: ('text' | 'image')[] }[]
  defaultModel: string | null
}

/** Role fields synchronized to a Harness workbench preset; execution remains Harness-owned. */
export interface JingworkRole {
  slug: string
  name: string
  description: string
  instructions: string
  category: 'enterprise'
  enabled: true
  knowledge: string
  skills: string[]
  connectors: string[]
}
/** Native encryption, isolated from the browser displaying the login page. */
export interface JingworkCredentialCipher {
  /** @param value Credential document. @returns OS-encrypted bytes. */
  encrypt(value: string): Uint8Array
  /** @param value OS-encrypted bytes. @returns Decrypted credential document. */
  decrypt(value: Uint8Array): string
}
/** One server-issued device authorization attempt, owned by the native process. */
export interface JingworkLoginAttempt {
  readonly url: string
  readonly deviceCode: string
  readonly expiresAt: number
  readonly intervalMs: number
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Validate an application URL before sending credentials or loading a remote login document.
 * @param value Deployment URL.
 * @returns A canonical HTTP loopback or HTTPS application URL with an optional path prefix.
 */
export function jingworkOrigin(value: string): string {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.search || url.hash
    || !/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(url.pathname)) {
    throw new Error('Jingwork requires an HTTPS origin or a loopback HTTP origin')
  }
  return url.origin + url.pathname.replace(/\/$/, '')
}

/** A terminal device authorization response requires a fresh server-issued attempt. */
export class JingworkLoginRefused extends Error {}

/** Read the user-owned account deployment before a packaged JingWork deployment.
 * @param userData Electron-owned private data directory.
 * @param packagedDefaultsPath Required package configuration when no user override exists; omitted for opt-in Harness installations.
 * @returns Validated Jingwork settings, or undefined when an opt-in installation has no configuration.
 * @throws If the selected user configuration or required packaged configuration cannot be read or validated.
 */
export function readJingworkLoginConfig(userData: string, packagedDefaultsPath?: string): JingworkLoginConfig | undefined {
  let raw: string
  try { raw = readFileSync(join(userData, 'desktop', 'jingwork.json'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Desktop Jingwork authentication configuration cannot be read')
    if (packagedDefaultsPath === undefined) return undefined
    try { raw = readFileSync(packagedDefaultsPath, 'utf8') } catch (_error) {
      throw new Error('Desktop Jingwork packaged authentication configuration cannot be read; reinstall the application')
    }
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!record(value) || typeof value.url !== 'string') throw new Error('missing origin')
    const timeout = value.requestTimeoutMs ?? 15000
    if (typeof timeout !== 'number' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2147483647) {
      throw new Error('invalid request timeout')
    }
    const interval = value.conversationLogIntervalMs
    if (interval !== undefined && (typeof interval !== 'number' || !Number.isSafeInteger(interval)
      || interval < 1000 || interval > 2147483647)) throw new Error('invalid conversation log interval')
    return { url: jingworkOrigin(value.url), requestTimeoutMs: timeout,
      ...(interval === undefined ? {} : { conversationLogIntervalMs: interval }) }
  } catch (_error) {
    throw new Error('Desktop Jingwork authentication configuration requires a valid origin and request timeout')
  }
}

/** Browser login grants a Jingwork API credential; model-provider keys remain separate. */
export class JingworkDesktopAuth {
  readonly origin: string
  private secret: string | undefined
  private accountName: string | undefined
  private uid: string | undefined
  private readonly path: string
  /**
   * @param config Validated deployment settings.
   * @param userData Electron-owned private data directory.
   * @param cipher OS-backed native encryption.
   * @param send Native network implementation.
   */
  constructor(
    private readonly config: JingworkLoginConfig,
    userData: string,
    private readonly cipher: JingworkCredentialCipher,
    private readonly send: typeof fetch,
  ) {
    this.origin = jingworkOrigin(config.url)
    this.path = join(userData, 'jingwork', `${createHash('sha256').update(this.origin).digest('hex')}.bin`)
  }

  /** Validate the cached account against Jingwork before opening the workspace.
   * @returns Whether the server still accepts this device's credential.
   */
  async restore(): Promise<boolean> {
    let bytes: Uint8Array
    try { bytes = await readFile(this.path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw new Error('Jingwork credential storage is unavailable')
    }
    let value: unknown
    try { value = JSON.parse(this.cipher.decrypt(bytes)) } catch (_error) {
      // A cache that cannot be decrypted requires a fresh browser authorization.
      return false
    }
    if (!record(value) || value.origin !== this.origin || typeof value.secret !== 'string') return false
    const response = await this.request('/api/auth/me', { headers: { Authorization: `Bearer ${value.secret}` } })
    if (response.status === 401 || response.status === 423) {
      await rm(this.path, { force: true })
      this.secret = undefined
      this.uid = undefined
      this.accountName = undefined
      return false
    }
    if (!response.ok) throw new Error('Jingwork account validation failed')
    const user = await this.json(response)
    if (!record(user) || typeof user.id !== 'number' || typeof user.uid !== 'string') {
      throw new Error('Jingwork returned an invalid account')
    }
    this.secret = value.secret
    this.uid = user.uid
    this.accountName = typeof user.username === 'string' ? user.username : user.uid
    return true
  }

  /** Create the existing Jingwork browser authorization flow.
   * @param signal Native window lifetime.
   * @returns Same-origin login URL and private polling parameters.
   */
  async begin(signal: AbortSignal): Promise<JingworkLoginAttempt> {
    const response = await this.request('/api/auth/cli/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_name: 'JingWork' }), signal,
    })
    if (!response.ok) throw new Error('Jingwork login is unavailable')
    const value = await this.json(response)
    if (!record(value) || typeof value.device_code !== 'string' || typeof value.user_code !== 'string'
      || typeof value.verification_uri !== 'string' || typeof value.expires_in !== 'number'
      || !Number.isSafeInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 86400
      || typeof value.interval !== 'number' || !Number.isSafeInteger(value.interval) || value.interval < 1 || value.interval > 3600) {
      throw new Error('Jingwork returned an invalid login session')
    }
    const verification = new URL(value.verification_uri, this.origin + '/')
    if (verification.origin !== new URL(this.origin).origin
      || verification.pathname !== new URL(this.origin).pathname.replace(/\/$/, '') + '/auth/cli/authorize'
      || verification.username || verification.password || verification.hash) {
      throw new Error('Jingwork returned an invalid login address')
    }
    verification.search = new URLSearchParams({ user_code: value.user_code }).toString()
    const login = new URL(this.origin + '/login')
    login.search = new URLSearchParams({ redirect: '/auth/cli/authorize' + verification.search }).toString()
    return { url: login.href, deviceCode: value.device_code, expiresAt: Date.now() + value.expires_in * 1000,
      intervalMs: value.interval * 1000 }
  }

  /** Wait for the user's approval and persist the OS-encrypted credential before entering Harness.
   * @param attempt Server-issued login attempt.
   * @param signal Native window lifetime; closing the window cancels polling.
   */
  async complete(attempt: JingworkLoginAttempt, signal: AbortSignal): Promise<void> {
    while (Date.now() < attempt.expiresAt) {
      signal.throwIfAborted()
      const response = await this.request('/api/auth/cli/sessions/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_code: attempt.deviceCode }), signal,
      })
      const value = await this.json(response)
      if (response.ok) {
        if (!record(value) || typeof value.secret !== 'string' || !value.secret.startsWith('yxkey_')
          || !record(value.user) || typeof value.user.id !== 'number' || typeof value.user.uid !== 'string') {
          throw new Error('Jingwork returned an invalid authorization')
        }
        signal.throwIfAborted()
        const encrypted = this.cipher.encrypt(JSON.stringify({ origin: this.origin, secret: value.secret }))
        await writeFileAtomic(this.path, encrypted, { mode: 0o600, dirMode: 0o700 })
        signal.throwIfAborted()
        this.secret = value.secret
        this.uid = value.user.uid
        this.accountName = typeof value.user.username === 'string' ? value.user.username : value.user.uid
        return
      }
      if (!record(value) || !record(value.detail) || value.detail.error !== 'authorization_pending') {
        throw new JingworkLoginRefused('Jingwork authorization was refused or expired')
      }
      await delay(Math.min(attempt.intervalMs, Math.max(1, attempt.expiresAt - Date.now())), undefined, { signal })
    }
    throw new JingworkLoginRefused('Jingwork authorization expired')
  }

  /** Read the display name validated by the most recent successful login. @returns Public account name. */
  get name(): string | undefined { return this.accountName }

  /** Authenticated backend identity used to bind local log delivery. @returns Current UID, or undefined while signed out. */
  get accountId(): string | undefined { return this.uid }

  /** Deliver one bounded, retry-safe batch using the account that owns the Session.
   * @param uid Persisted Session owner.
   * @param batch Backend log fields without user identity.
   * @param signal Worker deadline or shutdown.
   */
  async syncConversationLogs(uid: string, batch: {
    device_id: string
    agent_id: string
    agent_name: string
    events: CapturedConversationEvent[]
  }, signal: AbortSignal): Promise<void> {
    const secret = this.secret
    if (secret === undefined || this.uid !== uid) throw new Error('Conversation log account changed')
    const response = await this.request('/api/system/conversation-logs/sync', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch), signal,
    })
    if (!response.ok) throw new Error('Conversation log synchronization failed')
    const receipt = await this.json(response)
    if (this.secret !== secret || this.uid !== uid) throw new Error('Conversation log account changed')
    if (!record(receipt) || receipt.received !== batch.events.length || typeof receipt.inserted !== 'number'
      || !Number.isSafeInteger(receipt.inserted) || receipt.inserted < 0 || receipt.inserted > batch.events.length) {
      throw new Error('Invalid conversation log acknowledgement')
    }
  }

  /** Submit one account-owned audit or system log and validate persistence acknowledgement.
   * @param uid Account captured when the event occurred.
   * @param log Whitelisted, content-free event.
   * @param signal Outbox lifetime or request deadline.
   */
  async sendClientLog(uid: string, log: DesktopClientLog, signal: AbortSignal): Promise<void> {
    const secret = this.secret
    if (secret === undefined || this.uid !== uid) throw new Error('Desktop log account changed')
    const route = log.kind === 'operation' ? 'operation-logs' : 'runtime-logs'
    const response = await this.request(`/api/system/${route}`, {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(log.event), signal,
    })
    if (!response.ok) throw new Error('Desktop log upload failed')
    const receipt = await this.json(response)
    if (this.secret !== secret || this.uid !== uid) throw new Error('Desktop log account changed')
    if (!record(receipt) || typeof receipt.id !== 'number' || !Number.isSafeInteger(receipt.id) || receipt.id <= 0) {
      throw new Error('Invalid desktop log acknowledgement')
    }
  }

  /** Revoke the IAM login before removing this device's encrypted credential.
   * @throws When platform sign-out cannot be confirmed; the local credential remains available for retry.
   */
  async signOut(): Promise<void> {
    if (this.secret !== undefined) {
      const response = await this.request('/api/auth/iam/logout', {
        method: 'POST', headers: { Authorization: `Bearer ${this.secret}` },
      })
      if (!response.ok && response.status !== 401) throw new Error('Jingwork platform sign-out failed')
    }
    await rm(this.path, { force: true })
    this.accountName = undefined
    this.uid = undefined
    this.secret = undefined
  }

  /** Read the current account's permitted model directory.
   * @returns Public model names and the administrator's suggested default.
   */
  async models(): Promise<JingworkModelCatalog> {
    const value = await this.knowledgeRequest('/api/system/model-providers/desktop-catalog')
    if (!record(value) || !Array.isArray(value.models)
      || (value.default_model !== null && typeof value.default_model !== 'string')) {
      throw new Error('Invalid enterprise model directory')
    }
    const models = value.models.map((item: unknown) => {
      if (!record(item) || typeof item.id !== 'string' || !item.id || item.id.length > 512
        || typeof item.name !== 'string' || typeof item.provider !== 'string') {
        throw new Error('Invalid enterprise model')
      }
      if (item.input !== undefined && (!Array.isArray(item.input)
        || !item.input.every((value: unknown) => value === 'text' || value === 'image'))) {
        throw new Error('Invalid enterprise model input capabilities')
      }
      const input: ('text' | 'image')[] = Array.isArray(item.input)
        ? item.input.map((value: 'text' | 'image') => value) : ['text']
      return { id: item.id, name: item.name, provider: item.provider, input }
    })
    return { models, defaultModel: value.default_model }
  }

  /** Forward one model request using the current device's IAM-bound credential.
   * @param body OpenAI-compatible request bytes.
   * @param signal Calling Host request lifetime.
   * @returns The upstream response stream; the caller owns cancellation and consumption.
   */
  async completeModel(body: string, signal: AbortSignal): Promise<Response> {
    const secret = this.secret
    if (secret === undefined) throw new Error('Enterprise sign-in is required')
    const response = await this.send(this.origin + '/api/model-credits/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body, redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
    })
    if (this.secret !== secret) {
      await response.body?.cancel()
      throw new Error('Enterprise account changed')
    }
    return response
  }

  /** Read agents visible to the current Jingwork account.
   * @returns Public catalog fields; credentials and runtime configuration stay native.
   */
  async agents(): Promise<{ id: string; name: string; description: string }[]> {
    if (this.secret === undefined) throw new Error('Jingwork login is required')
    const secret = this.secret
    const response = await this.request('/api/agent', { headers: { Authorization: `Bearer ${secret}` } })
    if (!response.ok) throw new Error('Jingwork agent catalog is unavailable')
    const value = await this.json(response)
    if (this.secret !== secret) throw new Error('Jingwork account changed')
    if (!record(value) || !Array.isArray(value.agents)) throw new Error('Jingwork returned an invalid agent catalog')
    return value.agents.map((item: unknown) => {
      if (!record(item) || typeof item.slug !== 'string' || !item.slug || typeof item.name !== 'string'
        || (item.description !== null && item.description !== undefined && typeof item.description !== 'string')) {
        throw new Error('Jingwork returned an invalid agent')
      }
      return { id: item.slug, name: item.name, description: typeof item.description === 'string' ? item.description : '' }
    })
  }

  /** Read the latest authorized role for a Harness-owned conversation.
   * @param id Jingwork agent slug.
   * @returns A stable native preset configuration containing only role fields.
   */
  async role(id: string): Promise<JingworkRole> {
    const secret = this.secret
    if (secret === undefined) throw new Error('Jingwork login is required')
    const response = await this.request(`/api/agent/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    if (!response.ok) throw new Error('Jingwork agent is unavailable')
    const value = await this.json(response)
    if (this.secret !== secret) throw new Error('Jingwork account changed')
    const agent = record(value) ? value.agent : undefined
    if (!record(agent) || agent.slug !== id || typeof agent.name !== 'string' || !agent.name
      || agent.name.length > 120 || (agent.description != null && typeof agent.description !== 'string')
      || !record(agent.config_json)) throw new Error('Jingwork returned an invalid role')
    const context = agent.config_json.context
    if (context !== undefined && !record(context)) throw new Error('Jingwork returned an invalid role context')
    const prompt = context?.system_prompt
    if (prompt !== undefined && typeof prompt !== 'string') throw new Error('Jingwork returned an invalid role prompt')
    const instructions = prompt || 'You are a helpful assistant.'
    const description = typeof agent.description === 'string' ? agent.description : ''
    if (instructions.length > 65536 || description.length > 65536) throw new Error('Jingwork role exceeds Harness limits')
    return { slug: `jw-${createHash('sha256').update(this.origin + '/' + id).digest('hex').slice(0, 24)}`,
      name: agent.name, description, instructions, category: 'enterprise', enabled: true,
      knowledge: '', skills: [], connectors: [] }
  }

  /** List knowledge bases authorized for the current account.
   * @returns Public identifiers and labels, excluding credentials.
   */
  async knowledgeBases(): Promise<{ id: string; name: string; description: string }[]> {
    const value = await this.knowledgeRequest('/api/knowledge/databases/external')
    if (!record(value) || !Array.isArray(value.databases)) throw new Error('Invalid knowledge catalog')
    return value.databases.map((item: unknown) => {
      if (!record(item) || typeof item.kb_id !== 'string' || !item.kb_id || item.kb_id.length > 256
        || typeof item.name !== 'string' || typeof item.description !== 'string') throw new Error('Invalid knowledge base')
      return { id: item.kb_id, name: item.name, description: item.description }
    })
  }

  /** Retrieve backend-authorized reference passages.
   * @param id Selected knowledge base identifier.
   * @param query User or model search text.
   * @param signal Relay shutdown or request cancellation.
   * @returns JSON retrieval results from the backend.
   */
  async retrieveKnowledge(id: string, query: string, signal?: AbortSignal): Promise<unknown> {
    return this.knowledgeRequest(`/api/knowledge/databases/external/${encodeURIComponent(id)}/retrieve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
      ...(signal === undefined ? {} : { signal }),
    })
  }

  private async knowledgeRequest(path: string, init: RequestInit = {}): Promise<unknown> {
    const secret = this.secret
    if (secret === undefined) throw new Error('Jingwork login is required')
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${secret}`)
    const response = await this.request(path, { ...init, headers })
    if (!response.ok) throw new Error('Jingwork knowledge is unavailable')
    const value = await this.json(response)
    if (this.secret !== secret) throw new Error('Jingwork account changed')
    return value
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs)
    return this.send(this.origin + path, {
      ...init, redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    })
  }
  private async json(response: Response): Promise<unknown> {
    try { return await response.json() } catch (_error) { throw new Error('Jingwork returned an invalid response') }
  }
}
