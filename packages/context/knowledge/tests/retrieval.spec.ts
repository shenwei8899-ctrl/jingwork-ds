/** Knowledge search remains scoped, read-only and constrained by the saved assignment. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import * as Native from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import * as Knowledge from '../src/index.ts'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
it('retrieves only selected bases, presents logged reference data and removes the tool on disposal', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(Tools)
    await ctx.plugin(Native)
    const fiber = await ctx.plugin(Knowledge, { content: '', retrieval: {
      bases: ['product'], urlEnv: 'TEST_KB_URL', tokenEnv: 'TEST_KB_TOKEN', timeoutMs: 1000, maxBytes: 1024,
    } })
    vi.stubEnv('TEST_KB_URL', 'http://127.0.0.1:12345')
    vi.stubEnv('TEST_KB_TOKEN', 'private-relay-token')
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ chunks: [{ text: 'Return within 30 days' }] }))
    vi.stubGlobal('fetch', send)
    const call = (base: string) => executeToolFixture(ctx, {
      callId: ToolCallId('knowledge-call'), name: 'knowledge_search', arguments: { knowledgeBase: base, query: 'returns' },
      signal: new AbortController().signal,
    })
    const result = await call('product')
    expect(result.isError).not.toBe(true)
    expect(JSON.stringify(result)).toContain('Return within 30 days')
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]?.[0]).toEqual(new URL('http://127.0.0.1:12345/retrieve?id=product&query=returns'))
    expect((await call('forbidden')).isError).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    send.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await call('product')).isError).toBe(true)
    send.mockResolvedValueOnce(new Response('x'.repeat(2048)))
    expect((await call('product')).isError).toBe(true)
    vi.stubEnv('TEST_KB_TOKEN', '')
    expect((await call('product')).isError).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.get('knowledge_search')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
  }
})
