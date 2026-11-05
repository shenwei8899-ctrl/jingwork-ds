/** Assistant model defaults apply once before a new Session starts. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import * as plugin from '../src/index.ts'
import { defaultWorkbench } from '../src/defaults.ts'

it('records the selected assistant model for fresh Sessions and preserves existing choices', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('agentPresets', {
    register: async () => async () => {},
    composedPreset: () => 'workbench-assistant',
  } as never)
  ctx.provide('skills', { registerProvider: vi.fn() } as never)
  const data = defaultWorkbench()
  data.experts[0]!.model = { provider: 'selected', model: 'selected-model' }
  await liveConfig(ctx, plugin, data)
  const select = vi.fn()
  const agent = { ctx, session: { header: {}, seq: 0 }, model: { select } }
  await ctx.serial('agent/created', { agent: agent as never, source: 'startup' })
  expect(select).toHaveBeenCalledWith({ provider: 'selected', model: 'selected-model' })
  select.mockClear()
  agent.session.seq = 1
  await ctx.serial('agent/created', { agent: agent as never, source: 'resume' })
  expect(select).not.toHaveBeenCalled()
})
