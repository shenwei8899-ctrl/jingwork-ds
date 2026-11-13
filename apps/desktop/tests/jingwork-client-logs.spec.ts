/** Desktop audit delivery keeps stable identities, private ownership and persistent retries. */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { JingworkDesktopAuth } from '../src/jingwork-auth.ts'
import { JingworkClientLogs } from '../src/jingwork-client-logs.ts'
import { logRecord } from '../src/conversation-log-source.ts'

it('retries identical operation identities and uploads classified runtime errors without business text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-client-logs-'))
  const releases: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    for (const release of releases) await release()
    await rm(directory, { recursive: true, force: true })
  })
  const uploads: Record<string, unknown>[] = []
  const done = Promise.withResolvers<undefined>()
  const send = vi.fn<typeof fetch>(async (url, init) => {
    if (typeof url !== 'string') throw new Error('Expected URL')
    if (url.endsWith('/api/auth/iam/logout')) return Response.json({ ok: true })
    if (url.endsWith('/sessions')) return Response.json({ device_code: 'private', user_code: 'ABCD',
      verification_uri: 'http://127.0.0.1:45173/auth/cli/authorize', expires_in: 300, interval: 1 })
    if (url.endsWith('/token')) return Response.json({ secret: 'yxkey_private', user: { id: 1, uid: 'owner', username: 'Owner' } })
    if (typeof init?.body !== 'string') throw new Error('Expected JSON')
    const body: unknown = JSON.parse(init.body)
    if (!logRecord(body)) throw new Error('Invalid upload')
    uploads.push(body)
    if (uploads.length === 1) throw new Error('lost acknowledgement')
    if (uploads.length === 3) done.resolve(undefined)
    return Response.json({ id: uploads.length })
  })
  const auth = new JingworkDesktopAuth({ url: 'http://127.0.0.1:45173', requestTimeoutMs: 1000 }, directory,
    { encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value).toString() }, send)
  const signal = new AbortController().signal
  await auth.complete(await auth.begin(signal), signal)
  const logs = await JingworkClientLogs.open(auth, directory, 1, 1000)
  releases.push(() => logs.close())
  logs.operation('agent_save')
  logs.runtime('renderer', 'renderer_console_error')
  await done.promise
  await logs.close()
  expect(uploads[0]).toEqual(uploads[1])
  expect(uploads[2]).toMatchObject({ source: 'desktop', operation: 'renderer', error_code: 'renderer_console_error', actions: ['agent_save'] })
  expect(JSON.stringify(uploads)).not.toContain('yxkey_private')
  const file = (await readdir(join(directory, 'jingwork'))).find(name => name.endsWith('-client-logs.json'))
  if (file === undefined) throw new Error('Missing outbox')
  expect(JSON.parse(await readFile(join(directory, 'jingwork', file), 'utf8'))).toEqual([])
})

it('retains offline records across restart without sending them as a different account', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-client-log-owner-'))
  const releases: (() => Promise<void>)[] = []
  onTestFinished(async () => {
    for (const release of releases) await release()
    await rm(directory, { recursive: true, force: true })
  })
  let uid = 'first-owner'
  const send = vi.fn<typeof fetch>(async (url) => {
    if (typeof url !== 'string') throw new Error('Expected URL')
    if (url.endsWith('/api/auth/iam/logout')) return Response.json({ ok: true })
    if (url.endsWith('/sessions')) return Response.json({ device_code: 'private', user_code: 'ABCD',
      verification_uri: 'http://127.0.0.1:45173/auth/cli/authorize', expires_in: 300, interval: 1 })
    if (url.endsWith('/token')) return Response.json({ secret: 'yxkey_private', user: { id: 1, uid, username: 'Owner' } })
    throw new Error('Unexpected upload from another account')
  })
  const auth = new JingworkDesktopAuth({ url: 'http://127.0.0.1:45173', requestTimeoutMs: 1000 }, directory,
    { encrypt: value => Buffer.from(value), decrypt: value => Buffer.from(value).toString() }, send)
  const signal = new AbortController().signal
  await auth.complete(await auth.begin(signal), signal)
  const first = await JingworkClientLogs.open(auth, directory, 60000, 1000)
  releases.push(() => first.close())
  first.operation('sign_out')
  await first.close()
  await auth.signOut()
  uid = 'second-owner'
  await auth.complete(await auth.begin(signal), signal)
  const before = send.mock.calls.length
  const second = await JingworkClientLogs.open(auth, directory, 60000, 1000)
  releases.push(() => second.close())
  await second.close()
  expect(send.mock.calls).toHaveLength(before)
  const file = (await readdir(join(directory, 'jingwork'))).find(name => name.endsWith('-client-logs.json'))
  if (file === undefined) throw new Error('Missing outbox')
  expect(JSON.parse(await readFile(join(directory, 'jingwork', file), 'utf8'))).toMatchObject([
    { uid: 'first-owner', log: { kind: 'operation', event: { operation: 'sign_out' } } },
  ])
})
