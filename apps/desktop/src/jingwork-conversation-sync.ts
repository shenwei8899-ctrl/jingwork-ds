/** Durable, account-bound delivery of committed desktop conversation text to Jingwork. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { JingworkDesktopAuth } from './jingwork-auth.ts'
import { logRecord, type ConversationLogSource } from './conversation-log-source.ts'

interface Binding { uid: string; after: number; since: number; filesAfter?: number; mutationsAfter?: number; uploadedFiles?: string[] }
interface SyncState { deviceId: string; sessions: Record<string, Binding> }

/** Validate the local acknowledgement ledger before delivering any messages.
 * @param value Parsed ledger.
 * @returns Valid ledger or a failure that prevents account reassignment.
 */
function decodeState(value: unknown): SyncState {
  if (!logRecord(value) || typeof value.deviceId !== 'string' || !value.deviceId || !logRecord(value.sessions)) {
    throw new Error('Conversation synchronization ledger is invalid')
  }
  const sessions: Record<string, Binding> = {}
  for (const [id, entry] of Object.entries(value.sessions)) {
    if (!logRecord(entry) || typeof entry.uid !== 'string' || typeof entry.after !== 'number'
      || !Number.isSafeInteger(entry.after) || entry.after < -1 || typeof entry.since !== 'number'
      || !Number.isFinite(entry.since)) throw new Error('Conversation synchronization ownership is invalid')
    if (entry.filesAfter !== undefined && (typeof entry.filesAfter !== 'number'
      || !Number.isSafeInteger(entry.filesAfter) || entry.filesAfter < -1)) {
      throw new Error('Conversation file synchronization cursor is invalid')
    }
    if (entry.uploadedFiles !== undefined && (!Array.isArray(entry.uploadedFiles)
      || !entry.uploadedFiles.every((id: unknown) => typeof id === 'string'))) {
      throw new Error('Conversation file acknowledgements are invalid')
    }
    if (entry.mutationsAfter !== undefined && (typeof entry.mutationsAfter !== 'number'
      || !Number.isSafeInteger(entry.mutationsAfter) || entry.mutationsAfter < -1)) {
      throw new Error('Conversation mutation synchronization cursor is invalid')
    }
    sessions[id] = { uid: entry.uid, after: entry.after, since: entry.since,
      filesAfter: entry.filesAfter === undefined ? -1 : entry.filesAfter,
      mutationsAfter: entry.mutationsAfter === undefined ? -1 : entry.mutationsAfter,
      uploadedFiles: entry.uploadedFiles === undefined ? [] : entry.uploadedFiles }
  }
  return { deviceId: value.deviceId, sessions }
}

/** Start one serialized synchronization worker for one Desktop Host generation.
 * @param auth Native account and backend delivery owner.
 * @param source Passive Host reader.
 * @param userData Private native state directory.
 * @param intervalMs Configured scan and retry interval.
 * @param timeoutMs Deadline of one scan.
 * @param report Reports a degraded sync without including message text or credentials.
 * @returns Async disposer that cancels requests and joins the worker before Host shutdown.
 */
export function startJingworkConversationSync(
  auth: JingworkDesktopAuth, source: ConversationLogSource, userData: string,
  intervalMs: number, timeoutMs: number, report: (failed: boolean, reason?: string) => void,
): () => Promise<void> {
  const lifetime = new AbortController()
  const path = join(userData, 'jingwork', `${createHash('sha256').update(auth.origin).digest('hex')}-conversation-sync.json`)
  const save = (state: SyncState) => writeFileAtomic(path, JSON.stringify(state), { mode: 0o600, dirMode: 0o700 })
  const run = async () => {
    let state: SyncState
    try {
      let raw: string | undefined
      try { raw = await readFile(path, 'utf8') } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      state = raw === undefined ? { deviceId: randomUUID(), sessions: {} } : decodeState(JSON.parse(raw))
      await save(state)
    } catch (error) {
      report(true, error instanceof Error ? error.message : 'Local ledger unavailable')
      return
    }
    let failed = false
    while (true) {
      try {
        const uid = auth.accountId
        if (uid !== undefined) {
          const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)])
          const ids = await source.list(signal)
          let fileFailure = false
          if (auth.accountId !== uid) throw new Error('Conversation account changed')
          for (const id of ids) {
            const sessionSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)])
            sessionSignal.throwIfAborted()
            if (auth.accountId !== uid) throw new Error('Conversation account changed')
            if (!Object.hasOwn(state.sessions, id)) {
              const next = { ...state, sessions: { ...state.sessions, [id]: { uid, after: -1, since: 0 } } }
              await save(next)
              state = next
            }
            const binding: Binding | undefined = Object.hasOwn(state.sessions, id) ? state.sessions[id] : undefined
            if (binding === undefined || binding.uid !== uid) continue
            const captured = await source.read(id, binding.after, sessionSignal, binding.filesAfter ?? -1, binding.mutationsAfter ?? -1)
            const events = captured.events.filter(event => Date.parse(event.timestamp) >= binding.since)
            for (let offset = 0; offset < events.length; offset += 100) {
              await auth.syncConversationLogs(uid, { device_id: state.deviceId, agent_id: captured.agentId,
                agent_name: captured.agentName, events: events.slice(offset, offset + 100) }, sessionSignal)
            }
            if (auth.accountId !== uid) throw new Error('Conversation account changed')
            binding.after = captured.cursor
            await save(state)
            let sessionFilesFailed = false
            const uploadedFiles = new Set(binding.uploadedFiles ?? [])
            for (const file of captured.files ?? []) {
              if (file.seq <= ((file.mutation ? binding.mutationsAfter : binding.filesAfter) ?? -1) || uploadedFiles.has(file.source_id)
                || Date.parse(file.timestamp) < binding.since) continue
              try {
                if (auth.accountId !== uid) throw new Error('Conversation account changed')
                const bytes = await readDeliveredFile(file.path, sessionSignal)
                await auth.syncConversationFile(uid, state.deviceId, captured.agentId, file, bytes, sessionSignal)
                uploadedFiles.add(file.source_id)
                binding.uploadedFiles = [...uploadedFiles]
                await save(state)
              } catch (error) {
                sessionFilesFailed = true
                fileFailure = true
                if (!failed) { failed = true; report(true, error instanceof Error ? error.message : 'File delivery unavailable') }
              }
            }
            if (!sessionFilesFailed) {
              if (auth.accountId !== uid) throw new Error('Conversation account changed')
              binding.filesAfter = captured.cursor
              binding.mutationsAfter = captured.cursor
              binding.uploadedFiles = []
              await save(state)
            }
          }
          if (failed && !fileFailure) { failed = false; report(false) }
        }
      } catch (error) {
        if (lifetime.signal.aborted) break
        if (!failed) { failed = true; report(true, error instanceof Error ? error.message : 'Delivery unavailable') }
      }
      try { await delay(intervalMs, undefined, { signal: lifetime.signal }) } catch (_cancelled) {
        break
      }
    }
  }
  const task = run()
  return async () => { lifetime.abort(); await task }
}

/** Read one stable regular file within the shared 100 MiB upload ceiling.
 * @param path Path recorded by a successful file delivery.
 * @param signal Worker cancellation.
 * @returns Owned bytes; concurrent growth or replacement leaves the delivery unacknowledged.
 */
async function readDeliveredFile(path: string, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted()
  const flags: { O_NOFOLLOW?: number; O_NONBLOCK?: number } = constants
  const handle = await open(path, constants.O_RDONLY | (flags.O_NOFOLLOW ?? 0) | (flags.O_NONBLOCK ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > 100 * 1024 * 1024) throw new Error('Delivered file exceeds the upload limit or is not a regular file')
    const bytes = new Uint8Array(before.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await handle.stat()
    if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Delivered file changed during synchronization')
    }
    return bytes.slice(0, offset)
  } finally {
    await handle.close()
  }
}
