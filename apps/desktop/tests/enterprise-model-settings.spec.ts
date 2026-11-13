/** Enterprise catalog synchronization uses the existing settings and credential APIs. */
import { expect, it, vi } from 'vitest'
import { connectDesktopWelcome } from '../src/welcome-backend.ts'

type Rpc = { rpcId: string; method: string; payload: { args: unknown } }

it('updates only the enterprise route and saves the new-session default', async () => {
  const send = vi.fn<Parameters<typeof connectDesktopWelcome>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const request = JSON.parse(init.body as string) as Rpc
    const value = request.method === 'settings/describe' ? { namespaces: [
      { ns: 'llm-pi-ai', revision: 4, value: { providers: { personal: { api: 'openai-completions' }, 'jingwork-enterprise': { models: [{ id: 'company:disabled', name: 'Disabled' }] } } } },
      { ns: 'agent-default-model', value: { provider: 'jingwork-enterprise', model: 'company:chat' } },
    ] } : undefined
    return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value } })
  })
  const backend = await connectDesktopWelcome('http://127.0.0.1:19387/?token=fixture', send)
  expect(await backend.syncModels({ models: [{ id: 'company:chat', name: 'Chat', provider: 'company', input: ['text', 'image'] }], defaultModel: 'company:chat' }, { baseURL: 'http://127.0.0.1:1234/v1', token: 'private-process-token' })).toBe('company:chat')
  const calls = send.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init?.body as string) as Rpc)
  expect(calls.find(call => call.method === 'credentials/set')?.payload.args).toEqual({ ref: 'JINGWORK_ENTERPRISE_MODEL_TOKEN', value: 'private-process-token' })
  expect(calls.find(call => call.method === 'settings/mutate')?.payload.args).toMatchObject({ ns: 'llm-pi-ai', expectedRevision: 4, ops: [{ op: 'set', path: ['providers', 'jingwork-enterprise'], value: { models: [{ id: 'company:chat', name: 'Chat', input: ['text', 'image'] }] } }] })
  await backend.setEnterpriseModel('company:chat')
  expect((JSON.parse(send.mock.calls.at(-1)?.[1]?.body as string) as Rpc).payload.args).toEqual({ ns: 'agent-default-model', ops: [
    { op: 'set', path: ['provider'], value: 'jingwork-enterprise' }, { op: 'set', path: ['model'], value: 'company:chat' }, { op: 'unset', path: ['reasoningEffort'] },
  ] })
})
