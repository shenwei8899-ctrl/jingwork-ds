/** Passive native reads of committed conversation events through the authenticated Host. */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import WebSocket from 'ws'
import { parseRemoteStreamServerMessage, REMOTE_STREAM_MUX_PATH } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import type { AccountInvoke } from './account-backend.ts'
import { mutationPath, mutationResultPath } from '@deepseek-ai/dsh-client-ui-deliverables/src/produced-files.ts'

/** JSON object decoded at the Host transport. @param value Wire value. @returns Whether fields can be read. */
export function logRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** One committed message accepted by the backend log API. */
export interface CapturedConversationEvent {
  event_id: string
  thread_id: string
  event_type: 'user_message' | 'assistant_message'
  content: string
  timestamp: string
}
/** One committed delivery or successful file mutation; the worker reads its current local bytes. */
export interface CapturedConversationFile {
  source_id: string
  thread_id: string
  path: string
  timestamp: string
  seq: number
  /** Successful mutation results use a separate backfill cursor from explicit deliveries. */
  mutation?: true
}
/** A passive source remains usable across account changes but belongs to one Host generation. */
export interface ConversationLogSource {
  /** @param signal Owner cancellation. @returns Top-level Session identifiers. */
  list(signal: AbortSignal): Promise<string[]>
  /** @param id Session identifier. @param after Last acknowledged sequence. @param signal Owner cancellation.
   * @param filesAfter Independent file cursor. When absent, files use the message cursor.
   * @param mutationsAfter Independent successful-mutation cursor; defaults to the file cursor.
   * @returns Fixed-cut committed messages and the Session's preset identifier.
   */
  read(id: string, after: number, signal: AbortSignal, filesAfter?: number, mutationsAfter?: number): Promise<{
    cursor: number
    agentId: string
    agentName: string
    createdAt: number
    events: CapturedConversationEvent[]
    /** Absent for text-only sources, otherwise committed file declarations. */
    files?: CapturedConversationFile[]
  }>
}

/** Read explicit deliveries and successful first-party file mutations, excluding reads and user attachments.
 * @param records Fixed-cut Host records.
 * @param id Source Session identifier.
 * @param after Last acknowledged sequence.
 * @param cwd Session directory, required when a recorded delivery uses a relative path.
 * @param mutationsAfter Last acknowledged successful-mutation sequence.
 * @returns Stable file identities and native paths for the account-bound worker.
 */
export function captureConversationFiles(
  records: unknown[], id: string, after: number, cwd: string | undefined, mutationsAfter = after,
): CapturedConversationFile[] {
  const calls = new Map<string, string>()
  return records.flatMap((entry) => {
    if (!logRecord(entry) || entry.type !== 'event' || !logRecord(entry.event)) throw new Error('Invalid conversation record')
    const event = entry.event
    if (event.type === 'tool/call' && logRecord(event.data)) {
      const { callId, name, arguments: args } = event.data
      if (typeof callId === 'string' && typeof name === 'string' && typeof args === 'string') {
        const path = mutationPath(name, args)
        if (path !== null) calls.set(callId, path)
      }
      return []
    }
    if (event.type === 'tool/result' && logRecord(event.data) && logRecord(event.data.message)) {
      const message = event.data.message
      const callId = logRecord(message.source) ? message.source.callId : undefined
      if (typeof callId !== 'string') return []
      const argumentPath = calls.get(callId)
      calls.delete(callId)
      if (message.isError === true || argumentPath === undefined || typeof event.seq !== 'number'
        || event.seq <= mutationsAfter) return []
      const path = mutationResultPath(argumentPath, event.data.meta)
      if (path === null || !path || path.includes('\0')) return []
      if (!Number.isSafeInteger(event.seq) || typeof event.time !== 'number'
        || !Number.isFinite(event.time)) throw new Error('Invalid file mutation address')
      if (!isAbsolute(path) && cwd === undefined) throw new Error('Mutated file directory is unavailable')
      return [{ source_id: `${id}:${event.seq}:mutation:0`, thread_id: id,
        path: isAbsolute(path) ? path : resolve(cwd ?? '', path),
        timestamp: new Date(event.time).toISOString(), seq: event.seq, mutation: true as const }]
    }
    if (event.type !== 'deliverables/presented') return []
    if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || typeof event.time !== 'number'
      || !Number.isFinite(event.time)) throw new Error('Invalid file delivery address')
    if (event.seq <= after) return []
    if (!logRecord(event.data) || !Array.isArray(event.data.files)) throw new Error('Invalid file delivery')
    const seq = event.seq
    const timestamp = new Date(event.time).toISOString()
    return event.data.files.map((file: unknown, index: number) => {
      if (!logRecord(file) || typeof file.path !== 'string' || !file.path || file.path.includes('\0')) {
        throw new Error('Invalid delivered file path')
      }
      if (!isAbsolute(file.path) && cwd === undefined) throw new Error('Delivered file directory is unavailable')
      return { source_id: `${id}:${seq}:file:${index}`, thread_id: id,
        path: isAbsolute(file.path) ? file.path : resolve(cwd ?? '', file.path),
        timestamp, seq }
    })
  })
}

/** Whether successful results in the upload window still need earlier call records.
 * @param records Fixed-cut records already read.
 * @param after Acknowledged successful-mutation cursor.
 * @returns Whether another historical page may supply a required call.
 */
function needsMutationCalls(records: unknown[], after: number): boolean {
  const calls = new Set<string>()
  for (const entry of records) {
    if (!logRecord(entry) || !logRecord(entry.event)) continue
    const event = entry.event
    if (!logRecord(event.data)) continue
    if (event.type === 'tool/call' && typeof event.data.callId === 'string') calls.add(event.data.callId)
  }
  return records.some((entry) => {
    if (!logRecord(entry) || !logRecord(entry.event)) return false
    const event = entry.event
    if (!logRecord(event.data)) return false
    const message = event.data.message
    return event.type === 'tool/result' && typeof event.seq === 'number' && event.seq > after
      && logRecord(message) && message.isError !== true && logRecord(message.source)
      && typeof message.source.callId === 'string' && !calls.has(message.source.callId)
  })
}

/** Project only human prompts and AI text, excluding injected context, reasoning and tool activity.
 * @param records Validated Host records.
 * @param id Session identifier.
 * @param after Last acknowledged sequence.
 * @returns Uploadable committed text messages in sequence order.
 */
export function captureConversationEvents(records: unknown[], id: string, after: number): CapturedConversationEvent[] {
  return records.flatMap((entry) => {
    if (!logRecord(entry) || entry.type !== 'event' || !logRecord(entry.event)) throw new Error('Invalid conversation record')
    const event = entry.event
    if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || typeof event.time !== 'number'
      || !Number.isFinite(event.time)) throw new Error('Invalid conversation event address')
    if (event.seq <= after || !['user/message', 'assistant/message'].includes(String(event.type))) return []
    if (!logRecord(event.data)) throw new Error('Invalid conversation message')
    const user = event.type === 'user/message'
    const message = user ? event.data : event.data.message
    if (!logRecord(message)) throw new Error('Invalid conversation message')
    if (user && (!logRecord(message.source) || message.source.kind !== 'user')) return []
    if (!Array.isArray(message.content)) throw new Error('Invalid conversation content')
    const text = message.content.flatMap((block: unknown) => {
      if (!logRecord(block) || typeof block.type !== 'string') throw new Error('Invalid conversation block')
      if (block.type !== 'text') return []
      if (typeof block.text !== 'string') throw new Error('Invalid conversation text')
      return [block.text]
    }).join('\n')
    if (!text) return []
    if (text.length > 2 * 1024 * 1024) throw new Error('Conversation message exceeds backend log limit')
    return [{ event_id: `${id}:${event.seq}`, thread_id: id,
      event_type: user ? 'user_message' as const : 'assistant_message' as const,
      content: text, timestamp: new Date(event.time).toISOString() }]
  })
}

/** Build a cold-safe source using the existing Session API and stream protocol.
 * @param origin Authenticated Host origin.
 * @param invoke Authenticated unary RPC caller.
 * @param cookies Native Host cookie reader.
 * @returns Passive conversation reader.
 */
export function conversationLogSource(origin: string, invoke: AccountInvoke, cookies: () => Promise<string>): ConversationLogSource {
  return {
    async list(signal) {
      signal.throwIfAborted()
      const value = await invoke({ namespace: 'session', method: 'list', args: { _request: {} } }, signal)
      signal.throwIfAborted()
      if (!logRecord(value) || !Array.isArray(value.items)) throw new Error('Conversation list is unavailable')
      return value.items.flatMap((item: unknown) => {
        if (!logRecord(item) || typeof item.sessionId !== 'string') throw new Error('Invalid conversation identity')
        return item.blank === true || item.origin === 'subagent' || item.parentSessionId !== undefined ? [] : [item.sessionId]
      })
    },
    async read(id, after, signal, filesAfter = after, mutationsAfter = filesAfter) {
      const cookie = await cookies()
      signal.throwIfAborted()
      const url = new URL(REMOTE_STREAM_MUX_PATH, origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const opening: unknown = await new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { headers: { cookie, origin }, maxPayload: 32 * 1024 * 1024 })
        const streamId = randomUUID()
        const abort = () => { socket.terminate(); reject(new Error('Conversation read cancelled', { cause: signal.reason })) }
        const finish = () => { signal.removeEventListener('abort', abort); socket.close() }
        signal.addEventListener('abort', abort, { once: true })
        socket.on('open', () => { socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/follow',
          payload: { args: { request: { address: { kind: 'session', sessionId: id }, maxMessages: 100 } } } })) })
        socket.on('message', (data) => {
          try {
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
            const frame = parseRemoteStreamServerMessage(bytes.toString('utf8'))
            if (frame.streamId !== streamId || frame.type !== 'item') throw new Error('Conversation snapshot failed')
            resolve(frame.value)
          } catch (error) { reject(new Error('Invalid conversation stream', { cause: error })) }
          finally { finish() }
        })
        socket.on('error', reject)
        socket.on('close', () => { signal.removeEventListener('abort', abort); reject(new Error('Conversation stream closed')) })
      })
      if (!logRecord(opening) || opening.type !== 'snapshot' || !logRecord(opening.header)
        || opening.header.id !== id || typeof opening.header.createdAt !== 'number'
        || typeof opening.cursor !== 'number' || !Array.isArray(opening.records)
        || typeof opening.hasMore !== 'boolean') throw new Error('Invalid conversation snapshot')
      const agentId = opening.header.agentPreset === undefined ? 'default' : opening.header.agentPreset
      if (typeof agentId !== 'string' || !agentId || agentId.length > 128) throw new Error('Invalid conversation preset')
      const presets = await invoke({ namespace: 'agentPresets', method: 'list', args: {} }, signal)
      signal.throwIfAborted()
      if (!logRecord(presets) || !Array.isArray(presets.presets)) throw new Error('Conversation agent names are unavailable')
      const preset: unknown = presets.presets.find((item: unknown) => logRecord(item) && item.id === agentId)
      const agentName = logRecord(preset) && typeof preset.name === 'string' && preset.name ? preset.name : agentId
      if (agentName.length > 200) throw new Error('Conversation agent name exceeds backend limit')
      let records: unknown[] = opening.records
      let hasMore = opening.hasMore
      let all: unknown[] = [...records]
      while (hasMore) {
        const first = records[0]
        if (!logRecord(first) || !logRecord(first.event) || typeof first.event.seq !== 'number') {
          throw new Error('Invalid conversation pagination')
        }
        if (first.event.seq <= Math.min(after, filesAfter, mutationsAfter) && !needsMutationCalls(all, mutationsAfter)) break
        const page = await invoke({ namespace: 'session', method: 'events', args: { request: {
          address: { kind: 'session', sessionId: id }, throughSeq: opening.cursor,
          beforeSeq: first.event.seq, maxMessages: 100,
        } } }, signal)
        signal.throwIfAborted()
        if (!logRecord(page) || !Array.isArray(page.records) || typeof page.hasMore !== 'boolean'
          || page.cursor !== opening.cursor) throw new Error('Invalid conversation page')
        records = page.records
        const earliest = records[0]
        if (records.length && (!logRecord(earliest) || !logRecord(earliest.event)
          || typeof earliest.event.seq !== 'number' || earliest.event.seq >= first.event.seq)) {
          throw new Error('Conversation pagination did not advance')
        }
        if (!records.length && page.hasMore) throw new Error('Conversation pagination did not advance')
        all = [...records, ...all]
        hasMore = page.hasMore
      }
      const cwd = opening.header.cwd
      if (cwd !== undefined && typeof cwd !== 'string') throw new Error('Invalid conversation directory')
      return { cursor: opening.cursor, agentId, agentName, createdAt: opening.header.createdAt,
        events: captureConversationEvents(all, id, after), files: captureConversationFiles(all, id, filesAfter, cwd, mutationsAfter) }
    },
  }
}
