/** Account-bound durable outbox for whitelisted desktop operations and runtime failures. */
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { JingworkDesktopAuth } from './jingwork-auth.ts'
import { logRecord } from './conversation-log-source.ts'

/** Desktop operations accepted by the backend audit intake. */
export const DESKTOP_LOG_OPERATIONS = [
  'launch', 'sign_out', 'agent_open', 'agent_save', 'agent_remove', 'config_import',
  'plugin_operation', 'knowledge_read', 'session_start', 'settings_change',
] as const
/** One whitelisted action without business content. */
export type DesktopLogOperation = typeof DESKTOP_LOG_OPERATIONS[number]
/** JSON payload sent to the existing backend log pages. */
export type DesktopClientLog = {
  kind: 'operation'
  event: { operation: DesktopLogOperation; outcome: 'success' | 'failed'; correlation_id: string }
} | {
  kind: 'runtime'
  event: { source: 'desktop'; operation: string; error_code: string; message: string; correlation_id: string; actions: string[] }
}
interface PendingLog { uid: string; log: DesktopClientLog }

/** Owns one private outbox and serialized writes for one Electron main process. */
export class JingworkClientLogs {
  private tail = Promise.resolve()
  private readonly abort = new AbortController()
  private readonly timer: ReturnType<typeof setInterval>
  private closed = false
  private failed = false
  private deliveryPending = false
  private recent: DesktopLogOperation[] = []

  private constructor(
    private readonly auth: JingworkDesktopAuth,
    private readonly path: string,
    private pending: PendingLog[],
    intervalMs: number,
    private readonly timeoutMs: number,
  ) {
    this.timer = setInterval(() => { this.requestDelivery() }, intervalMs)
    this.timer.unref()
    this.requestDelivery()
  }

  /** Open the native outbox without reassigning records from another account.
   * @param auth Native credential owner.
   * @param userData Private desktop state directory.
   * @param intervalMs Retry interval.
   * @param timeoutMs Request timeout.
   * @returns Lifecycle-owned collector.
   */
  static async open(auth: JingworkDesktopAuth, userData: string, intervalMs: number, timeoutMs: number): Promise<JingworkClientLogs> {
    const path = join(userData, 'jingwork', `${createHash('sha256').update(auth.origin).digest('hex')}-client-logs.json`)
    let raw: string | undefined
    try { raw = await readFile(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const value: unknown = raw === undefined ? [] : JSON.parse(raw)
    if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid desktop log outbox')
    const pending = value.map((item: unknown): PendingLog => {
      if (!logRecord(item) || typeof item.uid !== 'string' || !item.uid || !logRecord(item.log)
        || !logRecord(item.log.event)) throw new Error('Invalid desktop log ownership')
      const event = item.log.event
      if (typeof event.correlation_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(event.correlation_id)) {
        throw new Error('Invalid desktop log identity')
      }
      if (item.log.kind === 'operation') {
        const operation = DESKTOP_LOG_OPERATIONS.find(operation => operation === event.operation)
        if (operation === undefined || (event.outcome !== 'success' && event.outcome !== 'failed')) {
          throw new Error('Invalid desktop operation')
        }
        return { uid: item.uid, log: { kind: 'operation', event: {
          operation, outcome: event.outcome, correlation_id: event.correlation_id,
        } } }
      }
      if (item.log.kind !== 'runtime' || event.source !== 'desktop' || typeof event.operation !== 'string'
        || event.operation.length > 256 || typeof event.error_code !== 'string' || event.error_code.length > 128
        || event.message !== 'Desktop operation failed. Check the local diagnostic report.' || !Array.isArray(event.actions)
        || event.actions.length > 10 || !event.actions.every((action: unknown) => typeof action === 'string'
          && DESKTOP_LOG_OPERATIONS.some(operation => operation === action))) throw new Error('Invalid desktop runtime log')
      return { uid: item.uid, log: { kind: 'runtime', event: { source: 'desktop', operation: event.operation,
        error_code: event.error_code, message: event.message, correlation_id: event.correlation_id,
        actions: event.actions as string[],
      } } }
    })
    return new JingworkClientLogs(auth, path, pending, intervalMs, timeoutMs)
  }

  /** Record a completed action without recording its arguments.
   * @param operation Whitelisted operation.
   * @param outcome Business result, independent of upload success.
   */
  operation(operation: DesktopLogOperation, outcome: 'success' | 'failed' = 'success'): void {
    this.recent = [...this.recent, operation].slice(-10)
    this.enqueue({ kind: 'operation', event: { operation, outcome, correlation_id: randomUUID() } })
  }

  /** Record an error classification without raw messages, stacks, paths or credentials.
   * @param operation Failing subsystem.
   * @param code Stable failure classification.
   */
  runtime(operation: string, code: string): void {
    this.enqueue({ kind: 'runtime', event: { source: 'desktop', operation: operation.slice(0, 256),
      error_code: code.slice(0, 128), message: 'Desktop operation failed. Check the local diagnostic report.',
      correlation_id: randomUUID(), actions: [...this.recent] } })
  }

  /** Stop intake, cancel network I/O and join all accepted local writes. */
  async close(): Promise<void> {
    this.closed = true
    clearInterval(this.timer)
    this.abort.abort()
    await this.tail
  }

  private enqueue(log: DesktopClientLog): void {
    const uid = this.auth.accountId
    if (this.closed || uid === undefined) return
    this.schedule(async () => {
      if (this.pending.length >= 1000) throw new Error('Desktop log outbox is full')
      const next = [...this.pending, { uid, log }]
      await this.save(next)
      this.pending = next
    })
  }

  private schedule(work: () => Promise<void>): void {
    this.tail = this.tail.then(work).catch((_error: unknown) => {
      if (!this.closed && !this.failed) {
        this.failed = true
        console.warn('Jingwork client logs unavailable. Pending records are retained. Check sign-in, backend access and local storage.')
      }
    })
  }

  private requestDelivery(): void {
    if (this.closed || this.deliveryPending) return
    this.deliveryPending = true
    this.schedule(async () => {
      try { await this.deliver() } finally { this.deliveryPending = false }
    })
  }

  private save(pending: PendingLog[]): Promise<void> {
    return writeFileAtomic(this.path, JSON.stringify(pending), { mode: 0o600, dirMode: 0o700 })
  }

  private async deliver(): Promise<void> {
    const uid = this.auth.accountId
    if (uid === undefined || this.closed) return
    for (const item of [...this.pending]) {
      if (item.uid !== uid) continue
      await this.auth.sendClientLog(uid, item.log, AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.timeoutMs)]))
      const next = this.pending.filter(entry => entry !== item)
      await this.save(next)
      this.pending = next
    }
    if (this.failed) { this.failed = false; console.info('Jingwork client log delivery resumed.') }
  }
}
