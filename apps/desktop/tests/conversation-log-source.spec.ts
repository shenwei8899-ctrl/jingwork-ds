/** Backend capture includes committed human and AI text without internal context. */
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { captureConversationEvents, conversationLogSource, logRecord } from '../src/conversation-log-source.ts'

const at = 1793750400000
const entry = (seq: number, type: string, data: object) => ({ type: 'event', event: { seq, type, time: at, data } })
const text = (value: string) => ({ type: 'text', text: value })

describe('conversation log capture', () => {
  it('preserves text and stable source identities while excluding internal records', () => {
    expect(captureConversationEvents([
      entry(0, 'system/message', { content: [text('system')] }),
      entry(1, 'user/message', { source: { kind: 'time-context' }, content: [text('context')] }),
      entry(2, 'user/message', { source: { kind: 'user' }, content: [text('问题'), { type: 'image' }] }),
      entry(3, 'assistant/message', { message: { content: [{ type: 'reasoning', text: 'private' }, text('回答')] } }),
      entry(4, 'tool/result', { result: 'private tool result' }),
      entry(5, 'assistant/attempt', { message: { content: [text('failed response')] } }),
    ], 'session-one', -1)).toEqual([
      { event_id: 'session-one:2', thread_id: 'session-one', event_type: 'user_message', content: '问题', timestamp: new Date(at).toISOString() },
      { event_id: 'session-one:3', thread_id: 'session-one', event_type: 'assistant_message', content: '回答', timestamp: new Date(at).toISOString() },
    ])
  })
  it('honors acknowledged cursors and leaves text-free records out', () => {
    expect(captureConversationEvents([
      entry(2, 'user/message', { source: { kind: 'user' }, content: [text('old')] }),
      entry(3, 'assistant/message', { message: { content: [{ type: 'tool_use' }] } }),
    ], 'session-one', 2)).toEqual([])
  })
  it.each([
    { type: 'event', event: { seq: 0, time: 'invalid' } },
    entry(0, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 1 }] }),
    entry(0, 'assistant/message', { message: {} }),
    entry(0, 'assistant/message', { message: { content: [text('x'.repeat(2 * 1024 * 1024 + 1))] } }),
  ])('rejects malformed or oversized messages before upload', (record) => {
    expect(() => captureConversationEvents([record], 'session-one', -1)).toThrow()
  })
})

it('captures the shipped recorded conversation as backend log text', async () => {
  const { readFile } = await import('node:fs/promises')
  const fixture = new URL('../../../snapshots/web/deepseek-messages-chat/session.v4.jsonl', import.meta.url)
  const lines = (await readFile(fixture, 'utf8')).trim().split('\n').slice(1)
  const records = lines.map((line, seq) => {
    const value: unknown = JSON.parse(line)
    if (!logRecord(value)) throw new Error('Invalid recorded event')
    return { type: 'event', event: { ...value, seq, time: at } }
  })
  const captured = captureConversationEvents(records, 'recorded-session', -1)
  expect(captured.map(({ event_type, content }) => ({ event_type, content }))).toEqual([
    { event_type: 'user_message', content: '只回复 MESSAGES_WEB_READY，不调用工具。' },
    { event_type: 'assistant_message', content: 'MESSAGES_WEB_READY' },
  ])
})

it('reads an authenticated fixed-cut snapshot and older pages through the shipped transport', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  onTestFinished(async () => {
    for (const client of server.clients) client.terminate()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
  })
  await once(server, 'listening')
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('Missing test server address')
  server.on('connection', (socket, request) => {
    expect(request.headers.cookie).toBe('desktop=private-host-cookie')
    socket.on('message', (bytes) => {
      if (!Buffer.isBuffer(bytes)) throw new Error('Expected JSON frame')
      const frame: unknown = JSON.parse(bytes.toString())
      if (!logRecord(frame)) throw new Error('Invalid opening frame')
      expect(frame).toMatchObject({ type: 'open', endpoint: 'session/follow', payload: {
        args: { request: { address: { kind: 'session', sessionId: 'session-one' }, maxMessages: 100 } },
      } })
      socket.send(JSON.stringify({ type: 'item', streamId: frame.streamId, value: {
        type: 'snapshot', header: { id: 'session-one', createdAt: at, agentPreset: 'workbench-assistant' },
        cursor: 3, records: [entry(3, 'assistant/message', { message: { content: [text('回答')] } })], hasMore: true,
      } }))
    })
  })
  const invoke = vi.fn(async (request: { namespace: string; method: string; args: Record<string, unknown> }) => {
    if (request.namespace === 'agentPresets') return { presets: [{ id: 'workbench-assistant', name: '助理' }] }
    if (request.method === 'list') {
      expect(request.args).toEqual({ _request: {} })
      return { items: [
        { sessionId: 'session-one' }, { sessionId: 'child', origin: 'subagent' }, { sessionId: 'blank', blank: true },
      ] }
    }
    expect(request.args).toMatchObject({ request: { throughSeq: 3, beforeSeq: 3 } })
    return { cursor: 3, hasMore: false, records: [entry(2, 'user/message', { source: { kind: 'user' }, content: [text('问题')] })] }
  })
  const source = conversationLogSource(`http://127.0.0.1:${address.port}`, invoke, async () => 'desktop=private-host-cookie')
  const signal = AbortSignal.timeout(5000)
  expect(await source.list(signal)).toEqual(['session-one'])
  const captured = await source.read('session-one', -1, signal)
  expect(captured).toMatchObject({ cursor: 3, agentId: 'workbench-assistant', agentName: '助理' })
  expect(captured.events.map(event => event.content)).toEqual(['问题', '回答'])
})
