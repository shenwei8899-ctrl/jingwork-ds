/** Backend capture includes committed human and AI text without internal context. */
import { once } from 'node:events'
import { basename } from 'node:path'
import { WebSocketServer } from 'ws'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { captureConversationEvents, captureConversationFiles, conversationLogSource, logRecord } from '../src/conversation-log-source.ts'

const at = 1793750400000
const entry = (seq: number, type: string, data: object) => ({ type: 'event', event: { seq, type, time: at, data } })
const text = (value: string) => ({ type: 'text', text: value })

describe('conversation log capture', () => {
  it('captures successful writes and edits using the same paths as desktop file cards', () => {
    const call = (seq: number, callId: string, name: string, args: object) => entry(seq, 'tool/call', {
      callId, name, arguments: JSON.stringify(args),
    })
    const result = (seq: number, callId: string, isError = false, meta?: object) => entry(seq, 'tool/result', {
      message: { source: { kind: 'tool', callId }, isError }, meta,
    })
    const records = [
      call(1, 'write', 'write', { file_path: '同步测试.txt', content: 'generated' }),
      result(2, 'write', false, { operation: 'create', path: '/workspace/同步测试.txt' }),
      call(3, 'read', 'read', { file_path: '/private/input.txt' }), result(4, 'read'),
      call(5, 'failed', 'write', { file_path: '/workspace/failed.txt', content: 'x' }), result(6, 'failed', true),
      call(7, 'invalid', 'write', { file_path: '/private/incomplete.txt' }), result(8, 'invalid'),
      call(9, 'edit', 'edit', { file_path: 'notes.txt', old_string: 'old', new_string: 'new' }), result(10, 'edit'),
      call(11, 'editor', 'str_replace_editor', { command: 'create', path: 'report.txt', file_text: 'report' }), result(12, 'editor'),
    ]
    expect(captureConversationFiles(records, 's', 12, '/workspace', -1)).toEqual([
      { source_id: 's:2:mutation:0', thread_id: 's', path: '/workspace/同步测试.txt', seq: 2, timestamp: new Date(at).toISOString(), mutation: true },
      { source_id: 's:10:mutation:0', thread_id: 's', path: '/workspace/notes.txt', seq: 10, timestamp: new Date(at).toISOString(), mutation: true },
      { source_id: 's:12:mutation:0', thread_id: 's', path: '/workspace/report.txt', seq: 12, timestamp: new Date(at).toISOString(), mutation: true },
    ])
    expect(captureConversationFiles(records, 's', 12, '/workspace', 12)).toEqual([])
  })
  it('captures explicit file deliveries with stable identities and excludes user attachments and tool paths', () => {
    const records = [
      entry(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'attachment', path: '/private/input.pdf' }] }),
      entry(2, 'tool/result', { path: '/private/internal.txt' }),
      entry(3, 'deliverables/presented', { files: [{ path: '/outputs/报告.pdf' }, { path: '/outputs/表格.xlsx' }] }),
    ]
    expect(captureConversationFiles(records, 'session-one', -1, undefined)).toEqual([
      { source_id: 'session-one:3:file:0', thread_id: 'session-one', path: '/outputs/报告.pdf', seq: 3, timestamp: new Date(at).toISOString() },
      { source_id: 'session-one:3:file:1', thread_id: 'session-one', path: '/outputs/表格.xlsx', seq: 3, timestamp: new Date(at).toISOString() },
    ])
    expect(captureConversationFiles(records, 'session-one', 3, undefined)).toEqual([])
    expect(() => captureConversationFiles([entry(3, 'deliverables/presented', { files: [{ path: '../file.pdf' }] })],
      's', -1, undefined)).toThrow('directory')
  })
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

it('captures shipped recorded file deliveries for the backend conversation', async () => {
  const { readFile } = await import('node:fs/promises')
  const fixture = new URL('../../../snapshots/web/present/session.v4.jsonl', import.meta.url)
  const records = (await readFile(fixture, 'utf8')).trim().split('\n').slice(1).map((line, seq) => {
    const event: unknown = JSON.parse(line)
    if (!logRecord(event)) throw new Error('Invalid recorded event')
    return { type: 'event', event: { ...event, seq, time: at } }
  })
  expect(captureConversationFiles(records, 'recorded-session', -1, '/recorded-workspace')
    .map(file => ({ source_id: file.source_id, filename: basename(file.path) }))).toMatchInlineSnapshot(`
      [
        {
          "filename": "report.txt",
          "source_id": "recorded-session:24:file:0",
        },
        {
          "filename": "说明.txt",
          "source_id": "recorded-session:24:file:1",
        },
      ]
    `)
})

it('backfills mutations from the recorded changed-files turn independently of explicit deliveries', async () => {
  const { readFile } = await import('node:fs/promises')
  const fixture = new URL('../../../snapshots/web/changed-files-turn/session.v4.jsonl', import.meta.url)
  const records = (await readFile(fixture, 'utf8')).trim().split('\n').slice(1).map((line, seq) => {
    const event: unknown = JSON.parse(line.replaceAll('{{cwd}}', '/recorded-workspace'))
    if (!logRecord(event)) throw new Error('Invalid recorded event')
    return { type: 'event', event: { ...event, seq, time: at } }
  })
  expect(captureConversationFiles(records, 'recorded-session', records.length, '/recorded-workspace', -1)
    .map(file => ({ source_id: file.source_id, path: file.path }))).toMatchInlineSnapshot(`
      [
        {
          "path": "/recorded-workspace/intro.md",
          "source_id": "recorded-session:26:mutation:0",
        },
        {
          "path": "/recorded-workspace/src/util.ts",
          "source_id": "recorded-session:28:mutation:0",
        },
        {
          "path": "/recorded-workspace/app.local",
          "source_id": "recorded-session:30:mutation:0",
        },
      ]
    `)
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
        cursor: 4, records: [
          entry(3, 'tool/result', { message: { source: { kind: 'tool', callId: 'write' }, isError: false }, meta: { path: '/workspace/report.txt' } }),
          entry(4, 'assistant/message', { message: { content: [text('回答')] } }),
        ], hasMore: true,
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
    expect(request.args).toMatchObject({ request: { throughSeq: 4 } })
    const pageRequest = request.args.request
    if (!logRecord(pageRequest)) throw new Error('Missing page request')
    return pageRequest.beforeSeq === 3
      ? { cursor: 4, hasMore: true, records: [entry(2, 'user/message', { source: { kind: 'user' }, content: [text('问题')] })] }
      : { cursor: 4, hasMore: false, records: [entry(1, 'tool/call', { callId: 'write', name: 'write',
        arguments: JSON.stringify({ file_path: '/workspace/report.txt', content: 'generated' }) })] }
  })
  const source = conversationLogSource(`http://127.0.0.1:${address.port}`, invoke, async () => 'desktop=private-host-cookie')
  const signal = AbortSignal.timeout(5000)
  expect(await source.list(signal)).toEqual(['session-one'])
  const captured = await source.read('session-one', -1, signal)
  expect(captured).toMatchObject({ cursor: 4, agentId: 'workbench-assistant', agentName: '助理' })
  expect(captured.events.map(event => event.content)).toEqual(['问题', '回答'])
  expect(captured.files).toHaveLength(1)
  const incremental = await source.read('session-one', 2, signal, 2, 2)
  expect(incremental.files).toEqual(captured.files)
})
