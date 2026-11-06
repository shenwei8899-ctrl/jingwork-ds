// @vitest-environment jsdom
/** JingWork setup retains its page across Models settings and saves only explicit completion. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { JingworkSetupSettings } from '../src/onboarding-config.ts'
import { JingworkSetupGuide, type JingworkSetupGuideProps } from '../src/client/JingworkSetupGuide.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { ModelsSettingsState, ProviderRow } from '../src/client/store.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
type AttentionSnapshot = Parameters<Parameters<JingworkSetupGuideProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: JingworkSetupGuideProps['useSessionStatus'] = selector => selector(noAttention)

const keylessProvider: ProviderRow = {
  entry: { provider: 'local', displayName: 'Local', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'local'], active: true },
  configured: true,
  removable: true,
  apiKeyEnv: undefined,
  credential: undefined,
}

afterEach(() => {
  cleanup()
  document.getElementById('root')?.remove()
})

function mount(options: {
  completed?: boolean
  explicit?: boolean
  copy?: typeof en | typeof zh
  progress?: Partial<ConfigFormSnapshot<JingworkSetupSettings>>
  models?: Partial<ModelsSettingsState>
  settings?: Partial<SettingsMirrorSnapshot>
} = {}) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  const progress = createSnapshotStore<ConfigFormSnapshot<JingworkSetupSettings>>({
    status: 'ready',
    value: { jingworkSetupComplete: options.completed ?? false },
    base: {}, user: {}, revision: 0, writable: true,
    ...options.progress,
  })
  const models = createSnapshotStore<ModelsSettingsState>({
    status: 'ready', error: null, credentialError: null, writable: true, rows: [], namespaces: new Map(),
    ...options.models,
  })
  const settings = createSnapshotStore<SettingsMirrorSnapshot>({
    status: 'ready', view: { namespaces: [], writable: true, hasDocument: true }, error: null,
    ...options.settings,
  })
  const refreshModels = vi.fn(async () => {})
  const retrySettings = vi.fn(async () => {})
  const saveCompletion = vi.fn(async () => {
    progress.update((value) => { value.value = { jingworkSetupComplete: true } })
    return true
  })
  const complete = vi.fn()
  const openSection = vi.fn()
  const copy = options.copy ?? en
  const unusedHook = (() => { throw new Error('unused standard hook') }) as never
  let props: JingworkSetupGuideProps = {
    stepId: 'jingwork-setup', settingsOpen: false,
    ...(options.explicit === undefined ? {} : { explicit: options.explicit }),
    complete, openSection,
    refreshModels, retrySettings, saveCompletion,
    useProgress: bindSnapshotSelector(progress),
    useModels: bindSnapshotSelector(models),
    useSettings: bindSnapshotSelector(settings),
    useSessions: unusedHook, useWorkspaces: unusedHook,
    useSessionStatus, usePanelInfo, useSessionRetainInfo: () => undefined, useResource,
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    t: key => copy[key],
  }
  const rendered = render(<JingworkSetupGuide {...props} />)
  return {
    ...rendered, progress, models, settings, complete, openSection, refreshModels, retrySettings, saveCompletion, root,
    setSettingsOpen(settingsOpen: boolean) {
      props = { ...props, settingsOpen }
      rendered.rerender(<JingworkSetupGuide {...props} />)
    },
  }
}

function openSetup(copy = en): void {
  fireEvent.click(screen.getByRole('button', { name: copy.jingworkGetStarted }))
}

describe('JingworkSetupGuide', () => {
  it('starts with the branded welcome and leaves progress unfinished when opening Models', () => {
    const h = mount()
    expect(screen.getByRole('dialog', { name: en.jingworkWelcomeTitle })).toBeTruthy()
    expect(h.root.inert).toBe(true)
    openSetup()
    expect(screen.getByRole('dialog', { name: en.jingworkModelsTitle })).toBeTruthy()
    expect(h.refreshModels).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkConfigureModels }))
    expect(h.openSection).toHaveBeenCalledWith('models')
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.saveCompletion).not.toHaveBeenCalled()
    expect(h.progress.getSnapshot().value?.jingworkSetupComplete).toBe(false)
  })

  it('releases modal ownership in Settings and resumes the setup page when Settings closes', () => {
    const h = mount()
    openSetup()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkConfigureModels }))
    h.setSettingsOpen(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.root.inert).not.toBe(true)
    act(() => { h.models.update((value) => { value.rows = [keylessProvider] }) })
    h.setSettingsOpen(false)
    expect(screen.getByRole('dialog', { name: en.jingworkModelsTitle })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.jingworkStart })).toBeTruthy()
    expect(h.refreshModels).toHaveBeenCalledTimes(2)
    expect(h.saveCompletion).not.toHaveBeenCalled()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('accepts an active keyless provider and saves completion when starting', async () => {
    const h = mount({ models: { rows: [keylessProvider] } })
    openSetup()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkStart }))
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(h.saveCompletion).toHaveBeenCalledOnce()
    expect(h.progress.getSnapshot().value?.jingworkSetupComplete).toBe(true)
  })

  it('allows an explicit skip without any configured model', async () => {
    const h = mount()
    openSetup()
    expect(screen.queryByRole('button', { name: en.jingworkStart })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkLater }))
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(h.saveCompletion).toHaveBeenCalledOnce()
  })

  it.each(['refused', 'rejected'] as const)('keeps the guide open after a %s completion write and retries', async (failure) => {
    const h = mount({ models: { rows: [keylessProvider] } })
    if (failure === 'refused') h.saveCompletion.mockResolvedValueOnce(false)
    else h.saveCompletion.mockRejectedValueOnce(new Error('test-only transport failure'))
    openSetup()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkLater }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.jingworkSaveError)
    expect(screen.queryByRole('button', { name: en.jingworkStart })).toBeNull()
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.progress.getSnapshot().value?.jingworkSetupComplete).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: en.jingworkRetrySave }))
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(h.saveCompletion).toHaveBeenCalledTimes(2)
  })

  it('waits for a pending completion write and ignores its settlement after unmount', async () => {
    const pending = Promise.withResolvers<boolean>()
    const h = mount()
    h.saveCompletion.mockReturnValueOnce(pending.promise)
    openSetup()
    const action = screen.getByRole<HTMLButtonElement>('button', { name: en.jingworkLater })
    fireEvent.click(action)
    expect(action.disabled).toBe(true)
    h.unmount()
    await act(async () => { pending.resolve(true); await pending.promise })
    expect(h.complete).not.toHaveBeenCalled()
  })

  it.each([
    { credentialError: 'test-only credential failure' },
    { status: 'error' as const, error: 'test-only provider failure' },
  ])('does not report retained provider rows as ready after a failed read', (failedRead) => {
    const h = mount({ models: { rows: [keylessProvider], ...failedRead } })
    openSetup()
    expect(screen.queryByRole('button', { name: en.jingworkStart })).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(h.refreshModels).toHaveBeenCalledTimes(2)
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('reports a rejected model refresh and retries through the shared Models reader', async () => {
    const h = mount({ models: { rows: [keylessProvider] } })
    h.refreshModels.mockRejectedValueOnce(new Error('test-only model transport failure'))
    openSetup()
    expect((await screen.findByRole('alert')).textContent).toBe(en.jingworkModelsError)
    expect(screen.queryByRole('button', { name: en.jingworkStart })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(screen.getByRole('button', { name: en.jingworkStart })).toBeTruthy()
    expect(h.refreshModels).toHaveBeenCalledTimes(2)
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('recovers a rejected model read after configuring a provider and closing Settings', async () => {
    const h = mount()
    h.refreshModels.mockRejectedValueOnce(new Error('test-only model transport failure'))
    openSetup()
    expect((await screen.findByRole('alert')).textContent).toBe(en.jingworkModelsError)
    fireEvent.click(screen.getByRole('button', { name: en.jingworkConfigureModels }))
    expect(h.openSection).toHaveBeenCalledWith('models')
    h.setSettingsOpen(true)
    act(() => { h.models.update((value) => { value.rows = [keylessProvider] }) })
    h.setSettingsOpen(false)
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.jingworkModelsReady) })
    expect(screen.getByRole('button', { name: en.jingworkStart })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(h.refreshModels).toHaveBeenCalledTimes(2)
    expect(h.saveCompletion).not.toHaveBeenCalled()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)('preserves a completion error when a pending model refresh settles with %s', async (outcome) => {
    const pending = Promise.withResolvers<undefined>()
    const h = mount({ models: { rows: [keylessProvider] } })
    h.refreshModels.mockReturnValueOnce(pending.promise)
    h.saveCompletion.mockResolvedValueOnce(false)
    openSetup()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkLater }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.jingworkSaveError)
    await act(async () => {
      if (outcome === 'success') pending.resolve(undefined)
      else pending.reject(new Error('test-only concurrent model failure'))
      await Promise.resolve()
    })
    expect(screen.getByRole('alert').textContent).toBe(en.jingworkSaveError)
    expect(screen.getByRole('button', { name: en.jingworkRetrySave })).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.jingworkStart })).toBeNull()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('ignores a model refresh rejection after Settings takes ownership', async () => {
    const pending = Promise.withResolvers<undefined>()
    const h = mount()
    h.refreshModels.mockReturnValueOnce(pending.promise)
    openSetup()
    h.setSettingsOpen(true)
    await act(async () => { pending.reject(new Error('test-only stale model read')); await Promise.resolve() })
    h.setSettingsOpen(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(h.refreshModels).toHaveBeenCalledTimes(2)
  })

  it('waits without blocking while the completion setting is loading', () => {
    const h = mount({ progress: { status: 'loading', value: undefined } })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.root.inert).not.toBe(true)
    expect(h.complete).not.toHaveBeenCalled()
    expect(h.refreshModels).not.toHaveBeenCalled()
  })

  it('reports an initial settings read failure and retries the shared settings read', () => {
    const h = mount({
      progress: { status: 'loading', value: undefined },
      settings: { status: 'idle', view: undefined, error: 'test-only settings failure' },
    })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(h.retrySettings).toHaveBeenCalledOnce()
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('retains a rejected settings retry until a later read succeeds', async () => {
    const h = mount({
      progress: { status: 'loading', value: undefined },
      settings: { status: 'idle', view: undefined, error: 'test-only settings failure' },
    })
    h.retrySettings.mockRejectedValueOnce(new Error('test-only settings transport failure'))
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await act(async () => { await Promise.resolve() })
    act(() => { h.settings.update((value) => { value.error = null }) })
    expect(screen.getByRole('alert').textContent).toBe(en.jingworkSettingsError)
    h.retrySettings.mockImplementationOnce(async () => {
      h.progress.update((value) => { value.status = 'ready'; value.value = { jingworkSetupComplete: false } })
    })
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(h.retrySettings).toHaveBeenCalledTimes(2)
    expect(h.complete).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'unavailable' as const, value: undefined },
    { writable: false },
  ])('leaves the workspace accessible when automatic completion settings are unavailable or read-only', async (progress) => {
    const h = mount({ progress })
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.root.inert).not.toBe(true)
    expect(h.saveCompletion).not.toHaveBeenCalled()
  })

  it.each([
    { status: 'unavailable' as const, value: undefined },
    { writable: false },
  ])('lets an explicitly opened guide close while completion settings are unavailable or read-only', (progress) => {
    const h = mount({ progress, explicit: true })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(h.complete).toHaveBeenCalledOnce()
    expect(h.saveCompletion).not.toHaveBeenCalled()
  })

  it('skips an automatically selected guide after completion was saved', async () => {
    const h = mount({ completed: true })
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.saveCompletion).not.toHaveBeenCalled()
  })

  it('allows explicit reopening after completion was saved', async () => {
    const h = mount({ completed: true, explicit: true })
    expect(screen.getByRole('dialog', { name: en.jingworkWelcomeTitle })).toBeTruthy()
    expect(h.complete).not.toHaveBeenCalled()
    openSetup()
    fireEvent.click(screen.getByRole('button', { name: en.jingworkLater }))
    await waitFor(() => { expect(h.complete).toHaveBeenCalledOnce() })
    expect(h.saveCompletion).toHaveBeenCalledOnce()
  })

  for (const [locale, copy] of [['en', en], ['zh', zh]] as const) {
    it(`keeps the ${locale} welcome and model instructions in owner-local snapshots`, async () => {
      mount({ copy })
      const welcome = screen.getByRole('dialog', { name: copy.jingworkWelcomeTitle })
      await expect(`${welcome.textContent}\n`).toMatchFileSnapshot(`./expected/jingwork-setup-welcome-${locale}.txt`)
      openSetup(copy)
      const setup = screen.getByRole('dialog', { name: copy.jingworkModelsTitle })
      await expect(`${setup.textContent}\n`).toMatchFileSnapshot(`./expected/jingwork-setup-models-${locale}.txt`)
    })
  }
})
