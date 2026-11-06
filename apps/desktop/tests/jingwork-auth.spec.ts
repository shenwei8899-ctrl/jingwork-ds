/** Native authorization preserves Jingwork's server-issued identity and device-code lifetime. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { startJingworkKnowledge } from '../src/jingwork-knowledge.ts'
import { JingworkDesktopAuth, jingworkOrigin, readJingworkLoginConfig } from '../src/jingwork-auth.ts'

const origin = 'http://127.0.0.1:45173'
const issued = { device_code: 'private-device-code', user_code: 'ABCD-EFGH',
  verification_uri: '/auth/cli/authorize', expires_in: 600, interval: 2 }
const granted = { secret: 'yxkey_test-only-credential', user: { id: 10, uid: 'test-user' } }
const cipher = {
  encrypt: (value: string) => Buffer.from(Buffer.from(value).toString('base64')),
  decrypt: (value: Uint8Array) => Buffer.from(Buffer.from(value).toString(), 'base64').toString(),
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'harness-jingwork-auth-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const send = vi.fn<typeof fetch>()
  const auth = new JingworkDesktopAuth({ url: origin, requestTimeoutMs: 1000 }, directory, cipher, send)
  const signal = new AbortController().signal
  return { directory, send, auth, signal }
}
async function persist(context: Awaited<ReturnType<typeof fixture>>) {
  context.send.mockResolvedValueOnce(Response.json(issued)).mockResolvedValueOnce(Response.json(granted))
  await context.auth.complete(await context.auth.begin(context.signal), context.signal)
  const directory = join(context.directory, 'jingwork')
  const [file] = await readdir(directory)
  if (file === undefined) throw new Error('Missing credential file')
  return join(directory, file)
}

it.each(['https://example.com/path', 'https://user:secret@example.com', 'http://example.com', 'file:///tmp/a',
  'https://example.com/?secret=value'])('rejects an unsafe login deployment %s', (value) => {
  expect(() => jingworkOrigin(value)).toThrow()
})
it('canonicalizes supported local and TLS origins', () => {
  expect(jingworkOrigin('http://localhost:45173')).toBe('http://localhost:45173')
  expect(jingworkOrigin('https://example.com/')).toBe('https://example.com')
})
it('opens the original login page with only the public verification code in its redirect', async () => {
  const { auth, send, signal } = await fixture()
  send.mockResolvedValueOnce(Response.json(issued))
  const attempt = await auth.begin(signal)
  const url = new URL(attempt.url)
  expect(url.pathname).toBe('/login')
  expect(url.searchParams.get('redirect')).toBe('/auth/cli/authorize?user_code=ABCD-EFGH')
  expect(attempt.url).not.toContain(issued.device_code)
  expect(send.mock.calls[0]![1]).toMatchObject({ redirect: 'error', credentials: 'omit' })
  expect(send.mock.calls[0]![1]?.body).toBe(JSON.stringify({ key_name: 'DeepSeek Harness' }))
})
it.each(['https://other.example/auth/cli/authorize', '/other-path'])('refuses a foreign verification address %s', async (path) => {
  const { auth, send, signal } = await fixture()
  send.mockResolvedValueOnce(Response.json({ ...issued, verification_uri: path }))
  await expect(auth.begin(signal)).rejects.toThrow('invalid login address')
})
it('persists through the native cipher and validates the saved credential on restart', async () => {
  const context = await fixture()
  const path = await persist(context)
  expect((await readFile(path)).toString()).not.toContain(granted.secret)
  context.send.mockResolvedValueOnce(Response.json(granted.user))
  expect(await context.auth.restore()).toBe(true)
  expect(context.send.mock.calls.at(-1)![1]?.headers).toEqual({ Authorization: `Bearer ${granted.secret}` })
})
it('starts a fresh login when no credential is stored', async () => {
  const { auth, send } = await fixture()
  expect(await auth.restore()).toBe(false)
  expect(send).not.toHaveBeenCalled()
})
it('drops a revoked credential and requests a fresh login', async () => {
  const context = await fixture()
  const path = await persist(context)
  context.send.mockResolvedValueOnce(new Response(null, { status: 401 }))
  expect(await context.auth.restore()).toBe(false)
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('retains the cached credential when the backend is temporarily unavailable', async () => {
  const context = await fixture()
  const path = await persist(context)
  const before = await readFile(path)
  context.send.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(context.auth.restore()).rejects.toThrow('validation failed')
  expect(await readFile(path)).toEqual(before)
})
it('does not expose malformed cached data in diagnostics', async () => {
  const context = await fixture()
  const path = await persist(context)
  await writeFile(path, 'invalid encrypted data')
  expect(await context.auth.restore()).toBe(false)
})
it('cancels pending authorization with the native window lifetime', async () => {
  const { auth, send, signal } = await fixture()
  send.mockResolvedValueOnce(Response.json(issued))
  const attempt = await auth.begin(signal)
  send.mockResolvedValueOnce(Response.json({ detail: { error: 'authorization_pending' } }, { status: 400 }))
  const lifetime = new AbortController()
  const done = auth.complete(attempt, lifetime.signal)
  lifetime.abort()
  await expect(done).rejects.toThrow()
})
it('rejects an expired or refused server authorization', async () => {
  const { auth, send, signal } = await fixture()
  send.mockResolvedValueOnce(Response.json(issued))
  const attempt = await auth.begin(signal)
  send.mockResolvedValueOnce(Response.json({ detail: { error: 'expired_token' } }, { status: 400 }))
  await expect(auth.complete(attempt, signal)).rejects.toThrow('refused or expired')
})
it('does not persist a malformed authorization response', async () => {
  const { auth, send, signal } = await fixture()
  send.mockResolvedValueOnce(Response.json(issued))
  const attempt = await auth.begin(signal)
  send.mockResolvedValueOnce(Response.json({ secret: 'wrong-protocol', user: granted.user }))
  await expect(auth.complete(attempt, signal)).rejects.toThrow('invalid authorization')
})


it('reads an opt-in Jingwork deployment and leaves other installations unconfigured', async () => {
  const { directory } = await fixture()
  expect(readJingworkLoginConfig(directory)).toBeUndefined()
  await mkdir(join(directory, 'desktop'))
  await writeFile(join(directory, 'desktop', 'jingwork.json'), JSON.stringify({ url: origin }))
  expect(readJingworkLoginConfig(directory)).toEqual({ url: origin, requestTimeoutMs: 15000 })
})
it('uses packaged Jingwork deployment settings for a fresh user directory', async () => {
  const { directory } = await fixture()
  const defaults = join(directory, 'packaged-login.json')
  await writeFile(defaults, JSON.stringify({ url: 'https://jingwork.example', conversationLogIntervalMs: 7000 }))
  expect(readJingworkLoginConfig(join(directory, 'fresh-user-data'), defaults)).toEqual({
    url: 'https://jingwork.example', requestTimeoutMs: 15000, conversationLogIntervalMs: 7000,
  })
  expect(await readdir(directory)).toEqual(['packaged-login.json'])
})
it('selects a user-owned deployment before reading packaged defaults', async () => {
  const { directory } = await fixture()
  await mkdir(join(directory, 'desktop'))
  await writeFile(join(directory, 'desktop', 'jingwork.json'), JSON.stringify({ url: origin, requestTimeoutMs: 2000 }))
  expect(readJingworkLoginConfig(directory, join(directory, 'missing-packaged-login.json')))
    .toEqual({ url: origin, requestTimeoutMs: 2000 })
})
it('reports a required missing or unreadable packaged deployment', async () => {
  const { directory } = await fixture()
  expect(() => readJingworkLoginConfig(directory, join(directory, 'missing-login.json')))
    .toThrow('packaged authentication configuration cannot be read')
  expect(() => readJingworkLoginConfig(directory, directory)).toThrow('packaged authentication configuration cannot be read')
})
it.each(['{', '{}', '{"url":"http://remote.example"}', '{"url":"https://example.com/path"}',
  '{"url":"https://example.com","requestTimeoutMs":0}'])('refuses invalid packaged account configuration %s', async (raw) => {
  const { directory } = await fixture()
  const defaults = join(directory, 'packaged-login.json')
  await writeFile(defaults, raw)
  expect(() => readJingworkLoginConfig(directory, defaults)).toThrow('authentication configuration requires')
})
it('reports invalid or unreadable user configuration without using a packaged deployment', async () => {
  const { directory } = await fixture()
  const defaults = join(directory, 'packaged-login.json')
  const override = join(directory, 'desktop', 'jingwork.json')
  await writeFile(defaults, JSON.stringify({ url: 'https://jingwork.example' }))
  await mkdir(join(directory, 'desktop'))
  await writeFile(override, '{}')
  expect(() => readJingworkLoginConfig(directory, defaults)).toThrow('authentication configuration requires')
  await rm(override)
  await mkdir(override)
  expect(() => readJingworkLoginConfig(directory, defaults)).toThrow('authentication configuration cannot be read')
})
it.each(['{', '{}', '{"url":"http://remote.example"}', '{"url":"https://example.com/path"}',
  '{"url":"https://example.com","requestTimeoutMs":0}'])('refuses invalid account configuration %s', async (raw) => {
  const { directory } = await fixture()
  await mkdir(join(directory, 'desktop'))
  await writeFile(join(directory, 'desktop', 'jingwork.json'), raw)
  expect(() => readJingworkLoginConfig(directory)).toThrow('authentication configuration requires')
})

it('forgets the native account and cached credential on local sign-out', async () => {
  const context = await fixture()
  await persist(context)
  expect(context.auth.name).toBe(granted.user.uid)
  await context.auth.signOut()
  expect(context.auth.name).toBeUndefined()
  expect(await context.auth.restore()).toBe(false)
})

it('reads the authorized enterprise catalog and exposes only public display fields', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(Response.json({ agents: [
    { id: 12, slug: 'enterprise-writer', name: 'Writer', description: null, config_json: { private: true } },
  ] }))
  expect(await context.auth.agents()).toEqual([{ id: 'enterprise-writer', name: 'Writer', description: '' }])
  expect(context.send.mock.calls.at(-1)![0]).toBe(origin + '/api/agent')
  expect(context.send.mock.calls.at(-1)![1]?.headers).toEqual({ Authorization: `Bearer ${granted.secret}` })
})
it('reports backend permission failures and malformed catalogs', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(new Response('', { status: 403 }))
  await expect(context.auth.agents()).rejects.toThrow('unavailable')
  context.send.mockResolvedValueOnce(Response.json({ agents: [{ id: 1, name: 'Missing slug' }] }))
  await expect(context.auth.agents()).rejects.toThrow('invalid agent')
  await context.auth.signOut()
  await expect(context.auth.agents()).rejects.toThrow('login is required')
})

it('reads only the latest backend role fields for Harness execution', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(Response.json({ agent: {
    slug: 'deep-research', name: 'Research', description: 'Research role',
    config_json: { context: { system_prompt: 'Check every source.', model: 'backend-model', skills: ['backend-skill'] } },
  } }))
  const role = await context.auth.role('deep-research')
  expect(role).toMatchObject({ category: 'enterprise', name: 'Research', instructions: 'Check every source.',
    knowledge: '', skills: [], connectors: [] })
  expect(role.slug).toMatch(/^jw-[a-f0-9]{24}$/)
  expect(role).not.toHaveProperty('model')
  expect(context.send.mock.calls.at(-1)![0]).toBe(origin + '/api/agent/deep-research')
})
it('rejects a mismatched backend role and inaccessible configuration', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(Response.json({ agent: { slug: 'other', name: 'Other', config_json: {} } }))
  await expect(context.auth.role('requested')).rejects.toThrow('invalid role')
  context.send.mockResolvedValueOnce(new Response('', { status: 403 }))
  await expect(context.auth.role('requested')).rejects.toThrow('unavailable')
})

it('lists authorized knowledge bases and keeps retrieval credentials native', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(Response.json({ databases: [
    { kb_id: 'product-kb', name: 'Product', description: 'Product reference', kb_type: 'milvus' },
  ] }))
  expect(await context.auth.knowledgeBases()).toEqual([{ id: 'product-kb', name: 'Product', description: 'Product reference' }])
  context.send.mockResolvedValueOnce(Response.json({ chunks: [{ text: 'Reference result' }] }))
  expect(await context.auth.retrieveKnowledge('product-kb', 'return policy')).toEqual({ chunks: [{ text: 'Reference result' }] })
  expect(context.send.mock.calls.at(-1)).toEqual([
    `${origin}/api/knowledge/databases/external/product-kb/retrieve`,
    expect.objectContaining({ method: 'POST',
      body: JSON.stringify({ query: 'return policy' }), redirect: 'error' }),
  ])
  expect(new Headers(context.send.mock.calls.at(-1)![1]?.headers).get('Authorization')).toBe(`Bearer ${granted.secret}`)
  await context.auth.signOut()
  await expect(context.auth.knowledgeBases()).rejects.toThrow('login is required')
  await expect(context.auth.retrieveKnowledge('product-kb', 'query')).rejects.toThrow('login is required')
})
it('rejects malformed and forbidden knowledge catalogs', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(Response.json({ databases: [{ kb_id: 12 }] }))
  await expect(context.auth.knowledgeBases()).rejects.toThrow('Invalid knowledge base')
  context.send.mockResolvedValueOnce(new Response(null, { status: 403 }))
  await expect(context.auth.retrieveKnowledge('private', 'query')).rejects.toThrow('unavailable')
})

it('authenticates the private retrieval relay and rechecks account access after sign-out', async () => {
  const context = await fixture()
  await persist(context)
  const relay = await startJingworkKnowledge(context.auth, 1000)
  onTestFinished(relay.dispose)
  const endpoint = new URL('/retrieve?id=product-kb&query=policy', relay.environment.DSH_KNOWLEDGE_URL)
  expect((await fetch(endpoint)).status).toBe(401)
  const headers = { Authorization: `Bearer ${relay.environment.DSH_KNOWLEDGE_TOKEN}` }
  expect((await fetch(new URL('/other', relay.environment.DSH_KNOWLEDGE_URL), { headers })).status).toBe(400)
  context.send.mockResolvedValueOnce(Response.json({ chunks: [{ text: 'Policy' }] }))
  expect(await (await fetch(endpoint, { headers })).json()).toEqual({ chunks: [{ text: 'Policy' }] })
  await context.auth.signOut()
  expect((await fetch(endpoint, { headers })).status).toBe(502)
})

it('cancels in-flight backend retrieval before disposing the relay', async () => {
  const context = await fixture()
  await persist(context)
  const relay = await startJingworkKnowledge(context.auth, 1000)
  onTestFinished(relay.dispose)
  const captured: { signal?: AbortSignal | null } = {}
  context.send.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    captured.signal = init?.signal ?? null
    captured.signal?.addEventListener('abort', () => { reject(new Error('cancelled')) }, { once: true })
  }))
  const pending = fetch(new URL('/retrieve?id=product&query=policy', relay.environment.DSH_KNOWLEDGE_URL), {
    headers: { Authorization: `Bearer ${relay.environment.DSH_KNOWLEDGE_TOKEN}` },
  }).catch((error: unknown) => error)
  await vi.waitFor(() => { expect(captured.signal).toBeDefined() })
  await relay.dispose()
  await pending
  expect(captured.signal?.aborted).toBe(true)
})

it('delivers conversation logs with native credentials and validates durable acknowledgements', async () => {
  const context = await fixture()
  await persist(context)
  const batch = { device_id: 'device-one', agent_id: 'agent-one', agent_name: '助理', events: [{
    event_id: 'session:1', thread_id: 'session', event_type: 'user_message' as const,
    content: '问题', timestamp: '2026-11-04T00:00:00.000Z',
  }] }
  context.send.mockResolvedValueOnce(Response.json({ received: 1, inserted: 1 }))
  await context.auth.syncConversationLogs(granted.user.uid, batch, context.signal)
  expect(context.send.mock.calls.at(-1)?.[0]).toBe(origin + '/api/system/conversation-logs/sync')
  const request = context.send.mock.calls.at(-1)?.[1]
  expect(request?.headers).toMatchObject({ Authorization: `Bearer ${granted.secret}` })
  expect(request?.body).toBe(JSON.stringify(batch))
  context.send.mockResolvedValueOnce(Response.json({ received: 1, inserted: 0 }))
  await context.auth.syncConversationLogs(granted.user.uid, batch, context.signal)
  context.send.mockResolvedValueOnce(Response.json({ received: 0, inserted: 0 }))
  await expect(context.auth.syncConversationLogs(granted.user.uid, batch, context.signal)).rejects.toThrow('acknowledgement')
  const calls = context.send.mock.calls.length
  await expect(context.auth.syncConversationLogs('another-user', batch, context.signal)).rejects.toThrow('account changed')
  expect(context.send.mock.calls).toHaveLength(calls)
  await context.auth.signOut()
  await expect(context.auth.syncConversationLogs(granted.user.uid, batch, context.signal)).rejects.toThrow('account changed')
})

it('uploads account-bound operation and runtime logs and requires a persisted receipt', async () => {
  const context = await fixture()
  await persist(context)
  context.send.mockResolvedValueOnce(Response.json({ id: 12 }))
  await context.auth.sendClientLog(granted.user.uid, { kind: 'operation', event: {
    operation: 'agent_save', outcome: 'success', correlation_id: 'operation-one',
  } }, context.signal)
  expect(context.send.mock.calls.at(-1)?.[0]).toBe(origin + '/api/system/operation-logs')
  context.send.mockResolvedValueOnce(Response.json({ id: 13 }))
  await context.auth.sendClientLog(granted.user.uid, { kind: 'runtime', event: { source: 'desktop',
    operation: 'renderer', error_code: 'renderer_console_error',
    message: 'Desktop operation failed. Check the local diagnostic report.', correlation_id: 'runtime-one', actions: ['agent_save'],
  } }, context.signal)
  expect(context.send.mock.calls.at(-1)?.[0]).toBe(origin + '/api/system/runtime-logs')
  context.send.mockResolvedValueOnce(Response.json({ id: 0 }))
  await expect(context.auth.sendClientLog(granted.user.uid, { kind: 'operation', event: {
    operation: 'launch', outcome: 'success', correlation_id: 'bad-receipt',
  } }, context.signal)).rejects.toThrow('acknowledgement')
})
