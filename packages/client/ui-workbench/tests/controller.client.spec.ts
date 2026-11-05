/** Revision-fenced edits, atomic imports and workspace navigation. */
import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { defaultWorkbench } from '../src/defaults.ts'
import type { WorkbenchData } from '../src/types.ts'
import { WorkbenchController, type WorkbenchPorts } from '../src/client/controller.ts'

function fixture(overrides: Partial<WorkbenchPorts> = {}) {
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
    restoreDefault: vi.fn().mockResolvedValue('defaultInUse'),
    listSessions: async () => ({ ok: true, value: { items: [] } }),
    readSessionProjections: async () => ({ ok: true, value: { kind: 'sequenced', asOfSeq: -1, values: {} } }),
    listPresets: async () => ({ ok: true, value: { presets: [] } }),
    listFiles: list,
    statFile: async () => ({ ok: true, value: { absolutePath: '/workspace/report.md', version: 'v1' } }),
    readFileBytes: async () => {
      throw new Error('Unexpected file read')
    },
    openSession,
    openResource,
    beginNavigation: () => new AbortController().signal,
    ...overrides,
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
  it('commits selected skill definitions and the assistant in one revision-fenced mutation', async () => {
    const { controller, mutate } = fixture()
    const skill = { slug: 'dsh-official-plugin-artwork', name: 'Artwork', description: 'Draw artwork', content: 'Draw an icon.' }
    const expert = { ...defaultWorkbench().experts[0]!, skills: [skill.slug] }
    expect(await controller.save('experts', expert, expert.slug, 5, [skill])).toBeNull()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]?.[0]).toEqual([
      { op: 'set', path: ['experts'], value: expect.arrayContaining([expert]) },
      { op: 'set', path: ['skills'], value: [skill] },
    ])
    expect(mutate.mock.calls[0]?.[1]).toBe(5)
    controller.dispose()
  })
  it('rejects conflicting staged skills without changing the saved configuration', async () => {
    const { controller, snapshot, mutate } = fixture()
    const skill = { slug: 'existing', name: 'Existing', description: '', content: 'Original' }
    snapshot.value!.skills.push(skill)
    const expert = { ...defaultWorkbench().experts[0]!, skills: [skill.slug] }
    expect(await controller.save('experts', expert, expert.slug, 5, [{ ...skill, content: 'Replacement' }])).toBe('duplicate')
    expect(mutate).not.toHaveBeenCalled()
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
  it('restores the system default before deleting the selected assistant', async () => {
    const restoreDefault = vi.fn().mockResolvedValue(null)
    const { controller, mutate } = fixture({ restoreDefault })
    controller.source.set({ ...controller.source.getSnapshot(), roster: [{ id: 'workbench-assistant', isDefault: true }] })
    expect(await controller.remove('experts', 'assistant')).toBeNull()
    expect(restoreDefault).toHaveBeenCalledWith('workbench-assistant')
    expect(restoreDefault.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0]!)
    expect(mutate.mock.calls[0]?.[0]).toEqual([
      { op: 'set', path: ['experts'], value: defaultWorkbench().experts.filter(row => row.slug !== 'assistant') },
    ])
    controller.dispose()
  })
  it('retains the assistant when restoring the default fails', async () => {
    const restoreDefault = vi.fn().mockRejectedValue(new Error('Offline'))
    const { controller, mutate } = fixture({ restoreDefault })
    controller.source.set({ ...controller.source.getSnapshot(), roster: [{ id: 'workbench-assistant', isDefault: true }] })
    expect(await controller.remove('experts', 'assistant')).toBe('saveError')
    expect(mutate).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('reports the restored default when deletion is refused', async () => {
    const { controller, mutate } = fixture({ restoreDefault: vi.fn().mockResolvedValue(null) })
    controller.source.set({ ...controller.source.getSnapshot(), roster: [{ id: 'workbench-assistant', isDefault: true }] })
    mutate.mockResolvedValue(false)
    expect(await controller.remove('experts', 'assistant')).toBe('agentDeleteFailedDefaultRestored')
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


it('refreshes the enterprise catalog without writing remote agents into personal settings', async () => {
  const expert = { ...defaultWorkbench().experts[0]!, slug: 'jingwork-enterprise:writer', category: 'enterprise' as const }
  const listEnterprise = vi.fn().mockResolvedValue([expert])
  const { controller, mutate } = fixture({ listEnterprise })
  await controller.load()
  expect(controller.source.getSnapshot().enterprise).toEqual([expert])
  expect(mutate).not.toHaveBeenCalled()
  listEnterprise.mockResolvedValue([])
  await controller.load()
  expect(controller.source.getSnapshot().enterprise).toEqual([])
  listEnterprise.mockRejectedValue(new Error('denied'))
  await controller.load()
  expect(controller.source.getSnapshot().error).toBe('loadError')
})

it('refreshes authorized knowledge bases without copying backend content into profile settings', async () => {
  const listKnowledgeBases = vi.fn().mockResolvedValue([{ id: 'product', name: 'Product', description: 'Reference' }])
  const { controller, mutate } = fixture({ listKnowledgeBases })
  await controller.load()
  expect(controller.source.getSnapshot().knowledgeBases).toEqual([{ id: 'product', name: 'Product', description: 'Reference' }])
  expect(mutate).not.toHaveBeenCalled()
  listKnowledgeBases.mockResolvedValueOnce([])
  await controller.load()
  expect(controller.source.getSnapshot().knowledgeBases).toEqual([])
  controller.dispose()
})


it('lists unopened historical workspace Sessions with summarized file attribution', async () => {
  const id = 'historical' as SessionId
  const { controller } = fixture({ listSessions: async () => ({ ok: true, value: { items: [{
    sessionId: id, cwd: '/workspace', updatedAt: 1, running: false, blank: false, agentAvailable: false,
    projections: { kind: 'cached', asOfSeq: 1, values: {
      title: 'Historical report', deliverableFiles: ['/workspace/report.md'],
    } },
  }] } }) })
  await controller.loadLibrary()
  expect(controller.source.getSnapshot().librarySessions).toEqual([{
    id, cwd: '/workspace', displayTitle: 'Historical report', deliverableFiles: ['/workspace/report.md'],
  }])
  expect(controller.source.getSnapshot().libraryLoading).toBe(false)
  controller.dispose()
})

it('reads exact file attribution when an older summary has no deliverable projection', async () => {
  const id = 'historical' as SessionId
  const readSessionProjections = vi.fn<WorkbenchPorts['readSessionProjections']>().mockResolvedValue({
    ok: true,
    value: { kind: 'sequenced', asOfSeq: 9, values: { deliverableFiles: ['report.md'] } },
  })
  const { controller } = fixture({
    readSessionProjections,
    listSessions: async () => ({ ok: true, value: { items: [{
      sessionId: id, cwd: '/workspace', updatedAt: 1, running: false, blank: false, agentAvailable: false,
      projections: { kind: 'cached', asOfSeq: 1, values: { title: 'Historical report' } },
    }] } }),
  })
  await controller.loadLibrary()
  expect(readSessionProjections).toHaveBeenCalledWith({ sessionId: id }, expect.any(AbortSignal))
  expect(controller.source.getSnapshot()).toMatchObject({
    libraryAttributionIncomplete: false,
    librarySessions: [{ id, deliverableFiles: ['report.md'] }],
  })
  controller.dispose()
})

it('retains the catalog and marks incomplete attribution when one exact read fails', async () => {
  const id = 'historical' as SessionId
  const { controller } = fixture({
    readSessionProjections: async () => { throw new Error('offline') },
    listSessions: async () => ({ ok: true, value: { items: [{
      sessionId: id, cwd: '/workspace', updatedAt: 1, running: false, blank: false, agentAvailable: false,
    }] } }),
  })
  await controller.loadLibrary()
  expect(controller.source.getSnapshot()).toMatchObject({
    libraryAttributionIncomplete: true,
    librarySessions: [{ id, deliverableFiles: [] }],
  })
  controller.dispose()
})

it('keeps the library catalog and reports a failed refresh', async () => {
  const listSessions = vi.fn<WorkbenchPorts['listSessions']>()
    .mockResolvedValueOnce({ ok: true, value: { items: [] } })
    .mockRejectedValueOnce(new Error('offline'))
  const { controller } = fixture({ listSessions })
  await controller.loadLibrary()
  const rows = controller.source.getSnapshot().librarySessions
  await controller.loadLibrary()
  expect(controller.source.getSnapshot()).toMatchObject({ librarySessions: rows, libraryLoading: false, error: 'loadError' })
  controller.dispose()
})

it('ignores an older library refresh after a newer result arrives', async () => {
  const older = Promise.withResolvers<Awaited<ReturnType<WorkbenchPorts['listSessions']>>>()
  const newer = Promise.withResolvers<Awaited<ReturnType<WorkbenchPorts['listSessions']>>>()
  const listSessions = vi.fn<WorkbenchPorts['listSessions']>()
    .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  const { controller } = fixture({ listSessions })
  const first = controller.loadLibrary()
  const second = controller.loadLibrary()
  newer.resolve({ ok: true, value: { items: [] } })
  await second
  older.reject(new Error('stale failure'))
  await first
  expect(controller.source.getSnapshot().error).toBeNull()
  expect(controller.source.getSnapshot().libraryLoading).toBe(false)
  controller.dispose()
})

it('does not publish a library read after controller disposal', async () => {
  const response = Promise.withResolvers<Awaited<ReturnType<WorkbenchPorts['listSessions']>>>()
  const { controller } = fixture({ listSessions: () => response.promise })
  const loading = controller.loadLibrary()
  controller.dispose()
  const snapshot = controller.source.getSnapshot()
  response.resolve({ ok: true, value: { items: [] } })
  await loading
  expect(controller.source.getSnapshot()).toBe(snapshot)
})
