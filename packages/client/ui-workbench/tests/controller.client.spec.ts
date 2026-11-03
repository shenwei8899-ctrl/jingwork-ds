/** Revision-fenced edits, atomic imports and workspace navigation. */
import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defaultWorkbench } from '../src/defaults.ts'
import type { WorkbenchData } from '../src/types.ts'
import { WorkbenchController, type WorkbenchPorts } from '../src/client/controller.ts'

function fixture() {
  const snapshot: ConfigFormSnapshot<WorkbenchData> = {
    status: 'ready',
    value: defaultWorkbench(),
    base: {},
    user: {},
    revision: 7,
    writable: true,
  }
  const mutate = vi.fn().mockResolvedValue(true)
  const list = vi.fn().mockResolvedValue({ ok: true, value: { path: '', entries: [], truncated: false } })
  const openSession = vi.fn()
  const openResource = vi.fn()
  const ports: WorkbenchPorts = {
    form: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      mutate,
      set: async () => true,
      unset: async () => true,
    },
    listPresets: async () => ({ ok: true, value: { presets: [] } }),
    listFiles: list,
    statFile: async () => ({ ok: true, value: { absolutePath: '/workspace/report.md', version: 'v1' } }),
    readFileBytes: async () => {
      throw new Error('Unexpected file read')
    },
    openSession,
    openResource,
    beginNavigation: () => new AbortController().signal,
  }
  return { controller: new WorkbenchController(ports), snapshot, mutate, list, openSession, openResource }
}

describe('workbench editor and library commands', () => {
  it('keeps expert ordering and uses the revision read when editing began', async () => {
    const { controller, snapshot, mutate } = fixture()
    const expert = { ...defaultWorkbench().experts[0]!, name: 'My assistant' }
    expect(await controller.save('experts', expert, expert.slug, 5)).toBeNull()
    const ops = mutate.mock.calls[0]?.[0] as SettingsPathOpView[] | undefined
    const first = ops?.[0]
    if (first?.op !== 'set' || !Array.isArray(first.value)) throw new Error('Expected expert write')
    const experts = first.value as WorkbenchData['experts']
    expect(experts[0]?.name).toBe('My assistant')
    expect(experts.map(row => row.slug)).toEqual(snapshot.value?.experts.map(row => row.slug))
    expect(mutate.mock.calls[0]?.[1]).toBe(5)
    controller.dispose()
  })
  it('refuses duplicate keys and deleting a team member without writing', async () => {
    const { controller, mutate } = fixture()
    expect(await controller.save('experts', defaultWorkbench().experts[0]!, undefined, 7)).toBe('duplicate')
    expect(await controller.remove('experts', 'writer')).toBe('expertInTeam')
    expect(mutate).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('keeps all collections unchanged when imported references are invalid', async () => {
    const { controller, mutate } = fixture()
    const data = defaultWorkbench()
    data.teams[0]!.members = ['missing']
    expect(await controller.import(JSON.stringify(data))).toBe('importError')
    expect(mutate).not.toHaveBeenCalled()
    expect(await controller.import(JSON.stringify(defaultWorkbench()))).toBeNull()
    expect(mutate.mock.calls[0]?.[0]).toHaveLength(4)
    controller.dispose()
  })
  it('returns save failure when another window refuses the revision', async () => {
    const { controller, mutate } = fixture()
    mutate.mockResolvedValue(false)
    const expert = { ...defaultWorkbench().experts[0]!, slug: 'new-expert' }
    expect(await controller.save('experts', expert, undefined, 7)).toBe('saveError')
    controller.dispose()
  })
  it('persists activation with the observed revision and retains assistant fields', async () => {
    const { controller, mutate } = fixture()
    expect(await controller.setEnabled('assistant', false, 6)).toBeNull()
    const ops = mutate.mock.calls[0]?.[0] as SettingsPathOpView[] | undefined
    const first = ops?.[0]
    if (first?.op !== 'set' || !Array.isArray(first.value)) throw new Error('Expected activation write')
    const experts = first.value as WorkbenchData['experts']
    expect(first.path).toEqual(['experts'])
    expect(experts.find(expert => expert.slug === 'assistant'))
      .toMatchObject({ category: 'builtin', enabled: false })
    expect(mutate.mock.calls[0]?.[1]).toBe(6)
    expect(await controller.setEnabled('missing', false, 6)).toBe('saveError')
    controller.dispose()
  })
  it('preserves the default assistant and default teams when an action would remove their preset', async () => {
    const { controller, mutate } = fixture()
    controller.source.set({
      ...controller.source.getSnapshot(),
      roster: [{ id: 'workbench-assistant', isDefault: true }],
    })
    expect(await controller.setEnabled('assistant', false, 7)).toBe('defaultInUse')
    expect(await controller.remove('experts', 'assistant')).toBe('defaultInUse')
    expect(await controller.save('experts', { ...defaultWorkbench().experts[0]!, slug: 'renamed' }, 'assistant', 7))
      .toBe('defaultInUse')
    controller.source.set({
      ...controller.source.getSnapshot(),
      roster: [{ id: 'workbench-content-team', isDefault: true }],
    })
    expect(await controller.setEnabled('writer', false, 7)).toBe('defaultInUse')
    expect(await controller.remove('teams', 'content-team')).toBe('defaultInUse')
    expect(mutate).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('uses a nonempty root path and opens files in the existing preview system', async () => {
    const { controller, list, openSession, openResource } = fixture()
    const id = 'session-test' as SessionId
    await controller.files(id, '')
    expect(list).toHaveBeenCalledWith(id, '.', expect.any(AbortSignal))
    expect(controller.source.getSnapshot().files?.path).toBe('')
    await controller.preview(id, 'report.md')
    expect(openSession).toHaveBeenCalledWith(id)
    expect(openResource).not.toHaveBeenCalled()
    const pending = controller.source.getSnapshot().pendingPreview
    if (pending === null) throw new Error('Expected staged preview')
    controller.completePreview(pending)
    controller.completePreview(pending)
    expect(openResource).toHaveBeenCalledTimes(1)
    expect(openResource).toHaveBeenCalledWith(expect.stringContaining('report.md'))
    controller.dispose()
  })
  it('does not open a preview after another navigation cancels it', async () => {
    const { controller, openResource } = fixture()
    await controller.preview('session-test' as SessionId, 'report.md')
    const pending = controller.source.getSnapshot().pendingPreview
    if (pending === null) throw new Error('Expected staged preview')
    controller.cancelPreview()
    controller.completePreview(pending)
    expect(openResource).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('does not publish a cancelled directory read', async () => {
    const { controller, list } = fixture()
    let complete: (value: object) => void = () => {}
    list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const pending = controller.files('session-test' as SessionId, '')
    controller.dispose()
    complete({ ok: true, value: { path: '', entries: [{ name: 'stale', type: 'file' }], truncated: false } })
    await pending
    expect(controller.source.getSnapshot().files).toBeNull()
  })
})
