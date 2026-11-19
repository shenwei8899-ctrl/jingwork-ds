/** Durable delivery retries preserve user ownership and stable backend event identities. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { JingworkDesktopAuth } from '../src/jingwork-auth.ts'
import { startJingworkConversationSync } from '../src/jingwork-conversation-sync.ts'
import { logRecord, type ConversationLogSource } from '../src/conversation-log-source.ts'

const origin = 'http://127.0.0.1:45173'
const issued = { device_code: 'device-code', user_code: 'ABCD', verification_uri: origin + '/auth/cli/authorize', expires_in: 300, interval: 1 }
const granted = { secret: 'yxkey_test', user: { id: 1, uid: 'owner-one', username: 'Owner' } }

it.each([null, -2, 1.5, '1', false])('refuses an invalid persisted mutation cursor %s before scanning', async (mutationsAfter) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-mutation-cursor-'))
  const releases: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    await Promise.all(releases.map(release => release()))
    await rm(directory, { recursive: true, force: true })
  })
  const auth = new JingworkDesktopAuth({ url: origin, requestTimeoutMs: 1000 }, directory, {
    encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value).toString(),
  }, vi.fn<typeof fetch>())
  await mkdir(join(directory, 'jingwork'))
  const ledger = join(directory, 'jingwork', createHash('sha256').update(origin).digest('hex') + '-conversation-sync.json')
  const original = JSON.stringify({ deviceId: 'stable-device', sessions: {
    s: { uid: 'owner-one', after: 9, filesAfter: 9, since: 0, mutationsAfter },
  } })
  await writeFile(ledger, original)
  const list = vi.fn<ConversationLogSource['list']>()
  const source: ConversationLogSource = { list, read: vi.fn() }
  const reported = Promise.withResolvers<string | undefined>()
  const stop = startJingworkConversationSync(auth, source, directory, 1, 1000, (failed, reason) => {
    if (failed) reported.resolve(reason)
  })
  releases.push(stop)
  expect(await reported.promise).toBe('Conversation mutation synchronization cursor is invalid')
  await stop()
  expect(list).not.toHaveBeenCalled()
  expect(await readFile(ledger, 'utf8')).toBe(original)
})

it('backfills history, retries an uncertain batch, persists receipts and isolates a different account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-conversation-sync-'))
  const releases: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    await Promise.all(releases.map(release => release()))
    await rm(directory, { recursive: true, force: true })
  })
  const deliveries: object[] = []
  const acknowledged = Promise.withResolvers<undefined>()
  const send = vi.fn<typeof fetch>(async (url, init) => {
    if (typeof url !== 'string') throw new Error('Expected URL string')
    if (url.endsWith('/api/auth/iam/logout')) return Response.json({ ok: true })
    if (url.endsWith('/api/auth/cli/sessions')) return Response.json(issued)
    if (url.endsWith('/token')) return Response.json(granted)
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body')
    const body: unknown = JSON.parse(init.body)
    if (!logRecord(body)) throw new Error('Invalid upload')
    deliveries.push(body)
    if (deliveries.length === 1) throw new Error('connection lost after backend commit')
    acknowledged.resolve(undefined)
    return Response.json({ received: 1, inserted: 0 })
  })
  const auth = new JingworkDesktopAuth({ url: origin, requestTimeoutMs: 1000 }, directory, {
    encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value).toString(),
  }, send)
  await auth.complete(await auth.begin(new AbortController().signal), new AbortController().signal)
  const source: ConversationLogSource = {
    list: async () => ['historical-session'],
    read: async (_id, after) => ({ cursor: 1, agentId: 'workbench-assistant', agentName: '助理', createdAt: 1,
      events: after < 1 ? [{ event_id: 'historical-session:1', thread_id: 'historical-session',
        event_type: 'user_message', content: '历史问题', timestamp: '2026-01-01T00:00:00.000Z' }] : [] }),
  }
  const report = vi.fn()
  const stop = startJingworkConversationSync(auth, source, directory, 1, 1000, report)
  releases.push(stop)
  await acknowledged.promise
  await stop()
  expect(deliveries).toHaveLength(2)
  expect(deliveries[1]).toEqual(deliveries[0])
  const path = join(directory, 'jingwork', createHash('sha256').update(origin).digest('hex') + '-conversation-sync.json')
  const state: unknown = JSON.parse(await readFile(path, 'utf8'))
  expect(state).toMatchObject({ sessions: { 'historical-session': { uid: 'owner-one', after: 1 } } })
  expect(report).toHaveBeenCalledWith(true, 'connection lost after backend commit')
  await auth.signOut()
  send.mockResolvedValueOnce(Response.json(issued)).mockResolvedValueOnce(Response.json({ ...granted, user: { ...granted.user, uid: 'owner-two' } }))
  await auth.complete(await auth.begin(new AbortController().signal), new AbortController().signal)
  const scanned = Promise.withResolvers<undefined>()
  const read = vi.fn((id: string, after: number, signal: AbortSignal) => source.read(id, after, signal))
  const stopOther = startJingworkConversationSync(auth, {
    ...source, read, list: async () => { scanned.resolve(undefined); return ['historical-session'] },
  }, directory, 1, 1000, report)
  releases.push(stopOther)
  await scanned.promise
  await stopOther()
  expect(read).not.toHaveBeenCalled()
  expect(deliveries).toHaveLength(2)
})

it.each([undefined, 9])('backfills mutations behind text and explicit-file cursor %s and retries missing files', async (filesAfter) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-conversation-files-'))
  const releases: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    await Promise.all(releases.map(release => release()))
    await rm(directory, { recursive: true, force: true })
  })
  const reportPath = join(directory, '报告.txt')
  const missingPath = join(directory, '稍后生成.txt')
  await writeFile(reportPath, 'generated report')
  const missing = Promise.withResolvers<undefined>()
  const goodReceived = Promise.withResolvers<undefined>()
  const received = Promise.withResolvers<undefined>()
  const textBatches: object[] = []
  const fileBodies: string[] = []
  const send = vi.fn<typeof fetch>(async (url, init) => {
    if (typeof url !== 'string') throw new Error('Expected URL string')
    if (url.endsWith('/api/auth/cli/sessions')) return Response.json(issued)
    if (url.endsWith('/token')) return Response.json(granted)
    if (url.endsWith('/files/sync')) {
      if (!(init?.body instanceof FormData)) throw new Error('Expected multipart delivery')
      const metadata = init.body.get('metadata')
      const file = init.body.get('file')
      if (typeof metadata !== 'string' || !(file instanceof Blob)) throw new Error('Missing delivery fields')
      const fields: unknown = JSON.parse(metadata)
      expect(fields).toMatchObject({ device_id: 'stable-device', thread_id: 'historical-session' })
      const bytes = new Uint8Array(await file.arrayBuffer())
      fileBodies.push(new TextDecoder().decode(bytes))
      if (fileBodies.at(-1) === 'generated report') goodReceived.resolve(undefined)
      if (fileBodies.at(-1) === 'recovered file') received.resolve(undefined)
      return Response.json({ id: 'stored-file', size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') })
    }
    if (typeof init?.body !== 'string') throw new Error('Expected text batch')
    const batch: unknown = JSON.parse(init.body)
    if (!logRecord(batch)) throw new Error('Expected text batch object')
    textBatches.push(batch)
    return Response.json({ received: 1, inserted: 1 })
  })
  const auth = new JingworkDesktopAuth({ url: origin, requestTimeoutMs: 1000 }, directory, {
    encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value).toString(),
  }, send)
  await auth.complete(await auth.begin(new AbortController().signal), new AbortController().signal)
  const ledger = join(directory, 'jingwork', createHash('sha256').update(origin).digest('hex') + '-conversation-sync.json')
  await writeFile(ledger, JSON.stringify({ deviceId: 'stable-device',
    sessions: { 'historical-session': { uid: 'owner-one', after: 9, filesAfter, since: 0 } } }))
  const reads: number[] = []
  const source: ConversationLogSource = {
    list: async () => ['historical-session'],
    read: async (_id, after, _signal, deliveredAfter, mutationsAfter) => {
      reads.push(after)
      expect(deliveredAfter).toBe(filesAfter ?? -1)
      expect(mutationsAfter).toBe(-1)
      return { cursor: 10, agentId: 'expert', agentName: '专家', createdAt: 1,
        events: after < 10 ? [{ event_id: 'historical-session:10', thread_id: 'historical-session',
          event_type: 'assistant_message', content: '文件已交付', timestamp: '2026-01-01T00:00:00Z' }] : [],
        files: [missingPath, reportPath].map((path, index) => ({ path, seq: 3, mutation: true,
          source_id: `historical-session:3:mutation:${index}`, thread_id: 'historical-session', timestamp: '2026-01-01T00:00:00Z' })) }
    },
  }
  const stop = startJingworkConversationSync(auth, source, directory, 1, 1000, (failed) => {
    if (failed) missing.resolve(undefined)
  })
  releases.push(stop)
  await missing.promise
  await goodReceived.promise
  await stop()
  expect(JSON.parse(await readFile(ledger, 'utf8'))).toMatchObject({
    sessions: { 'historical-session': { after: 10, uploadedFiles: ['historical-session:3:mutation:1'] } },
  })
  await writeFile(reportPath, 'changed after acknowledgement')
  await writeFile(missingPath, 'recovered file')
  const resumed = startJingworkConversationSync(auth, source, directory, 1, 1000, () => {})
  releases.push(resumed)
  await received.promise
  await resumed()
  expect(textBatches).toHaveLength(1)
  expect(reads[0]).toBe(9)
  expect(reads.at(-1)).toBe(10)
  expect(fileBodies).toEqual(['generated report', 'recovered file'])
  expect(JSON.parse(await readFile(ledger, 'utf8'))).toMatchObject({
    sessions: { 'historical-session': { after: 10, filesAfter: 10, mutationsAfter: 10 } },
  })
})
