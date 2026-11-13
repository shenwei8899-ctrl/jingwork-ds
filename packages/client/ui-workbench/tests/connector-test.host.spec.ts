/** Real HTTP handshake tests use an atomically allocated loopback port and owned cleanup. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ConnectorController } from '../src/connector-controller.ts'
import { bearerHeaders, customConnectorHeaders } from '../src/custom-connector.ts'

it('negotiates MCP with a bearer key, rejects bad authentication and closes each test', async () => {
  const methods: string[] = []
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer fixture-key' || req.headers['x-linker-api-key'] !== 'sk_usr_fixture') {
      res.writeHead(401).end()
      return
    }
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let body = ''
    for await (const chunk of req) body += String(chunk)
    const request = JSON.parse(body)
    methods.push(request.method)
    if (request.id === undefined) { res.writeHead(202).end(); return }
    const result = request.method === 'initialize'
      ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { tools: [{ name: 'know_query_kb', description: 'Query the knowledge base', inputSchema: { type: 'object' } }] }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('credentials', { resolve: async () => ({ value: JSON.stringify({ authorization: 'Bearer fixture-key', linker_api_key: 'sk_usr_fixture' }) }) } as never)
  const controller = new ConnectorController(ctx, { timeoutMs: 2000 })
  const url = `http://127.0.0.1:${address.port}/mcp`
  expect(await controller.test(url, 'fixture-key', '', 'sk_usr_fixture')).toBe('connected')
  expect(await controller.test(url, 'Bearer fixture-key', '', 'sk_usr_fixture')).toBe('connected')
  expect(methods).toContain('initialize')
  expect(methods).toContain('tools/list')
  expect(await controller.listTools(url, 'fixture')).toEqual({ status: 'connected', tools: [{ name: 'know_query_kb', description: 'Query the knowledge base' }] })
  expect(await controller.test(url, 'bad-key', '')).toBe('failed')
  expect(await controller.test('file:///tmp/mcp', '', '')).toBe('invalid')
  expect(bearerHeaders('Bearer fixture-key')).toEqual({ Authorization: 'Bearer fixture-key' })
})

it('aborts a pending connection at the deployment timeout', async () => {
  const server = createServer((_req, _res) => {})
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  onTestFinished(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const controller = new ConnectorController(ctx, { timeoutMs: 50 })
  expect(await controller.test(`http://127.0.0.1:${address.port}/mcp`, '', '')).toBe('failed')
})

it.each([
  [{}, {}],
  [{ authorization: 'Bearer consumer' }, { Authorization: 'Bearer consumer' }],
  [{ linker_api_key: 'sk_usr_fixture' }, { 'X-Linker-Api-Key': 'sk_usr_fixture' }],
  [{ authorization: 'Bearer consumer', linker_api_key: 'sk_usr_fixture' }, { Authorization: 'Bearer consumer', 'X-Linker-Api-Key': 'sk_usr_fixture' }],
  [{ api_key: 'legacy-token' }, { Authorization: 'Bearer legacy-token' }],
])('loads optional authentication headers and legacy credentials %j', async (stored, expected) => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('credentials', { resolve: async () => ({ value: JSON.stringify(stored) }) } as never)
  expect(await customConnectorHeaders(ctx, 'fixture')).toEqual(expected)
})

it('updates either header while retaining the other saved header', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  let stored = JSON.stringify({ api_key: 'legacy-token' })
  ctx.provide('credentials', {
    resolve: async () => ({ value: stored }),
    set: async (_ref: string, value: string) => { stored = value },
  } as never)
  const controller = new ConnectorController(ctx, { timeoutMs: 1000 })
  expect(await controller.saveCredentials('fixture', '', 'sk_usr_fixture')).toBe(true)
  expect(JSON.parse(stored)).toEqual({ authorization: 'Bearer legacy-token', linker_api_key: 'sk_usr_fixture' })
  expect(await controller.saveCredentials('fixture', 'replacement', '')).toBe(true)
  expect(JSON.parse(stored)).toEqual({ authorization: 'Bearer replacement', linker_api_key: 'sk_usr_fixture' })
})

it('rejects saving custom authentication without a new or saved Authorization value', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const set = vi.fn()
  ctx.provide('credentials', { resolve: async () => undefined, set } as never)
  const controller = new ConnectorController(ctx, { timeoutMs: 1000 })
  expect(await controller.saveCredentials('fixture', '', 'sk_usr_fixture')).toBe(false)
  expect(set).not.toHaveBeenCalled()
})

it.each(['authorized', 'denied', 'malformed'] as const)(
  'tests Know catalog access after successful tool discovery (%s)',
  async (access) => {
    const methods: string[] = []
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST') { response.writeHead(405).end(); return }
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const rpc = JSON.parse(body) as { id?: number; method: string; params: { protocolVersion?: string } }
      methods.push(rpc.method)
      if (rpc.id === undefined) { response.writeHead(202).end(); return }
      let result: object
      if (rpc.method === 'initialize') {
        result = { protocolVersion: rpc.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Know', version: '1' } }
      } else if (rpc.method === 'tools/list') {
        result = { tools: [{ name: 'know_list_kb', inputSchema: { type: 'object' } }] }
      } else {
        result = {
          isError: access === 'denied',
          content: [{ type: 'text', text: access === 'authorized'
            ? JSON.stringify({ databases: [{ kb_id: 'kb-fixture', name: 'Fixture' }] })
            : 'Know API request failed (HTTP 401)' }],
        }
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
    })
    onTestFinished(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const controller = new ConnectorController(ctx, { timeoutMs: 2000 })
    expect(await controller.test(`http://127.0.0.1:${address.port}/mcp`, 'fixture', '')).toBe(
      access === 'authorized' ? 'connected' : 'failed',
    )
    expect(methods).toContain('tools/list')
    expect(methods).toContain('tools/call')
  },
)
