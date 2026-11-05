/** Durable delivery retries preserve user ownership and stable backend event identities. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { JingworkDesktopAuth } from '../src/jingwork-auth.ts'
import { startJingworkConversationSync } from '../src/jingwork-conversation-sync.ts'
import { logRecord, type ConversationLogSource } from '../src/conversation-log-source.ts'

const origin = 'http://127.0.0.1:45173'
const issued = { device_code: 'device-code', user_code: 'ABCD', verification_uri: origin + '/auth/cli/authorize', expires_in: 300, interval: 1 }
const granted = { secret: 'yxkey_test', user: { id: 1, uid: 'owner-one', username: 'Owner' } }

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
