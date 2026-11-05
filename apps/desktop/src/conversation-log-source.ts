/** Passive native reads of committed conversation events through the authenticated Host. */
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { parseRemoteStreamServerMessage, REMOTE_STREAM_MUX_PATH } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import type { AccountInvoke } from './account-backend.ts'

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
/** A passive source remains usable across account changes but belongs to one Host generation. */
export interface ConversationLogSource {
  /** @param signal Owner cancellation. @returns Top-level Session identifiers. */
  list(signal: AbortSignal): Promise<string[]>
  /** @param id Session identifier. @param after Last acknowledged sequence. @param signal Owner cancellation.
   * @returns Fixed-cut committed messages and the Session's preset identifier.
   */
  read(id: string, after: number, signal: AbortSignal): Promise<{
    cursor: number
    agentId: string
    agentName: string
    createdAt: number
    events: CapturedConversationEvent[]
  }>
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
    async read(id, after, signal) {
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
        if (first.event.seq <= after) break
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
      return { cursor: opening.cursor, agentId, agentName, createdAt: opening.header.createdAt,
        events: captureConversationEvents(all, id, after) }
    },
  }
}
