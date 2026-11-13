/** Shared workbench factories follow the owning plugin's registration lifetime. */
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { Context, Service } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import type { WorkbenchData } from '../src/types.ts'

class RemoteStub extends Service {
  constructor(ctx: Context) {
    super(ctx, 'remote')
  }
  readonly $mount = vi.fn(async () => () => Promise.resolve())
  readonly $on = vi.fn(() => () => {})
}

describe('workbench reusable pages', () => {
  it('releases every factory on unload and registers fresh definitions on reload', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SlotRegistry).await()
      ctx.slots.register({ name: 'root', inject: () => ({}), children: {
        'conversation.input.dock': { kind: 'list', scope: 'session' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
      } }, (_props: PropsRenderSlots<'conversation.input.dock'>) => null)
      const form = stubConfigForm<WorkbenchData>()
      ctx.provide('configForms', {
        get: () => form.scope,
        developerTools: { enabled: createSnapshotStore(true) },
      } as never)
      new RemoteStub(ctx)
      ctx.provide('remote.workbenchConnectors', { test: vi.fn().mockResolvedValue({ ok: true, value: 'connected' }) } as never)
      ctx.provide('remote.credentials', { set: vi.fn().mockResolvedValue({ ok: true, value: undefined }) } as never)
      ctx.provide('remote.agentPresets', { list: vi.fn().mockResolvedValue({ ok: true, value: { presets: [] } }) } as never)
      ctx.provide('sessions', { scope: vi.fn() } as never)
      ctx.provide('conversation', { input: { for: vi.fn() } } as never)
      ctx.provide('remote.session', { modelCatalog: vi.fn().mockResolvedValue({ ok: true, value: { groups: [], failures: [] } }) } as never)
      ctx.provide('remote.workspaceFiles', { list: vi.fn(), stat: vi.fn(), readBytes: vi.fn() } as never)
      ctx.provide('uiWorkspace', { openSession: vi.fn(), startSession: vi.fn() } as never)
      ctx.provide('sidebarRight', { mounted: createSnapshotStore(undefined), openResource: vi.fn() } as never)
      ctx.provide('layout', {
        panelInfo: createSnapshotStore({ activePanelId: null }),
        beginNavigation: () => new AbortController().signal,
      } as never)
      await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
      const plugin = { inject, apply }
      const names = ['workbench.assistants', 'workbench.resources', 'workbench.library', 'workbench.knowledge'] as const
      for (let mount = 0; mount < 2; mount++) {
        const fiber = ctx.plugin(plugin)
        await fiber.await()
        expect(ctx.slots.snapshot('sidebar.panellist')).toMatchObject([{
          type: 'slot',
          occupants: [
            { id: 'workbench-assistants' },
            { id: 'workbench-capabilities' },
            { id: 'workbench-library' },
          ],
        }])
        for (const name of names) {
          expect(ctx.slots.snapshot(`factory:${name}`)).toMatchObject([{ type: 'factory', name }])
        }
        await fiber.dispose()
        for (const name of names) expect(ctx.slots.snapshot(`factory:${name}`)).toEqual([])
      }
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
