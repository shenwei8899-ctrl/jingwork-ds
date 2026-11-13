/** Loopback model relay authentication and streaming lifecycle. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startJingworkModels } from '../src/jingwork-models.ts'
import { JingworkDesktopAuth } from '../src/jingwork-auth.ts'

const relays: Awaited<ReturnType<typeof startJingworkModels>>[] = []
afterEach(async () => {
  await Promise.all(relays.splice(0).map(relay => relay.dispose()))
  vi.restoreAllMocks()
})

describe('enterprise model relay', () => {
  it('requires the private process token and preserves streamed model bytes', async () => {
    const complete = vi.spyOn(JingworkDesktopAuth.prototype, 'completeModel').mockResolvedValue(
      new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    )
    const auth = Object.create(JingworkDesktopAuth.prototype) as JingworkDesktopAuth
    const relay = await startJingworkModels(auth)
    relays.push(relay)
    const url = `${relay.baseURL}/chat/completions`
    expect((await fetch(url, { method: 'POST' })).status).toBe(401)
    expect(complete).not.toHaveBeenCalled()
    const response = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${relay.token}` }, body: '{"model":"company:chat"}',
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe('data: {"choices":[]}\n\ndata: [DONE]\n\n')
    expect(complete.mock.calls[0]?.[0]).toBe('{"model":"company:chat"}')
  })

  it('preserves authorization failures and contains upstream connection failures', async () => {
    const complete = vi.spyOn(JingworkDesktopAuth.prototype, 'completeModel')
      .mockResolvedValueOnce(new Response('{"detail":"denied"}', { status: 403 }))
      .mockRejectedValueOnce(new Error('private upstream details'))
    const relay = await startJingworkModels(Object.create(JingworkDesktopAuth.prototype) as JingworkDesktopAuth)
    relays.push(relay)
    const request = (): Promise<Response> => fetch(`${relay.baseURL}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${relay.token}` }, body: '{}',
    })
    expect((await request()).status).toBe(403)
    const failed = await request()
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('private upstream')
    expect(complete).toHaveBeenCalledTimes(2)
  })
})
