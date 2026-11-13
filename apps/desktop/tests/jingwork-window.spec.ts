/** Remote login windows expose no native preload and retain the device attempt across transport recovery. */
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { JingworkDesktopAuth } from '../src/jingwork-auth.ts'
import { resolveDesktopLocale } from '../src/locale.ts'

const state = vi.hoisted(() => ({
  options: undefined as Electron.BrowserWindowConstructorOptions | undefined,
  closed: undefined as (() => void) | undefined,
  navigate: undefined as ((event: { preventDefault(): void }, target: string) => void) | undefined,
  load: vi.fn(async (_url: string) => {}), show: vi.fn(), close: vi.fn(),
  userAgent: vi.fn(), browser: vi.fn(async (_url: string) => {}),
  dialog: vi.fn(async () => ({ response: 1 })),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('..', import.meta.url)) },
  BrowserWindow: class {
    constructor(options: Electron.BrowserWindowConstructorOptions) { state.options = options }
    once(_event: string, listener: () => void) { state.closed = listener }
    webContents = {
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() },
      getUserAgent: () => 'Electron',
      setUserAgent: state.userAgent,
      setWindowOpenHandler: vi.fn(),
      on(_event: string, handler: typeof state.navigate) { state.navigate = handler },
    }
    loadURL = state.load
    show = state.show
    close = state.close
    isDestroyed() { return false }
  },
  dialog: { showMessageBox: state.dialog },
  shell: { openExternal: state.browser },
}))
const { openJingworkWelcome } = await import('../src/jingwork-window.ts')
const cipher = { encrypt: (value: string) => Buffer.from(value), decrypt: (value: Uint8Array) => Buffer.from(value).toString() }
function auth() {
  const client = new JingworkDesktopAuth({ url: 'http://127.0.0.1:45173', requestTimeoutMs: 1000 }, '/unused', cipher, fetch)
  const attempt = { url: 'http://127.0.0.1:45173/login', deviceCode: 'private', intervalMs: 2000,
    expiresAt: Date.now() + 600000 }
  const begin = vi.spyOn(client, 'begin').mockResolvedValue(attempt)
  const complete = vi.spyOn(client, 'complete')
  return { client, begin, complete, attempt }
}
it('opens system-browser sign-in and enters only after native authorization', async () => {
  const current = auth()
  const granted = Promise.withResolvers<undefined>()
  current.complete.mockReturnValue(granted.promise)
  const enter = vi.fn(async () => {})
  openJingworkWelcome(resolveDesktopLocale('zh'), current.client, enter)
  await vi.waitFor(() => { expect(current.complete).toHaveBeenCalledOnce() })
  expect(state.options?.webPreferences).toEqual({ nodeIntegration: false, contextIsolation: true,
    sandbox: true, webSecurity: true, partition: 'persist:jingwork-login' })
  expect(state.browser).toHaveBeenLastCalledWith(current.attempt.url)
  expect(state.load.mock.calls.at(-1)?.[0]).toMatch(/^data:text\/html/)
  expect(decodeURIComponent(state.load.mock.calls.at(-1)![0])).not.toContain(current.attempt.deviceCode)
  const page = decodeURIComponent(state.load.mock.calls.at(-1)![0])
  expect(page).toContain('data:image/png;base64,')
  expect(page).toContain('蓝鲸，你的工作好搭子')
  expect(page).toContain('企业统一登录')
  expect(page).toContain('-webkit-app-region: drag')
  expect(page.replace(/src="data:image\/png;base64,[^"]+"/, 'src="[bundled-logo]"')).toMatchSnapshot()
  expect(enter).not.toHaveBeenCalled()
  const event = { preventDefault: vi.fn() }
  state.navigate!(event, 'https://foreign.example/')
  expect(event.preventDefault).toHaveBeenCalledOnce()
  granted.resolve(undefined)
  await vi.waitFor(() => { expect(enter).toHaveBeenCalledOnce() })
})
it('suppresses workspace entry after the native login window closes', async () => {
  const current = auth()
  const granted = Promise.withResolvers<undefined>()
  current.complete.mockReturnValue(granted.promise)
  const enter = vi.fn(async () => {})
  openJingworkWelcome(resolveDesktopLocale('zh'), current.client, enter)
  await vi.waitFor(() => { expect(current.complete).toHaveBeenCalledOnce() })
  const signal = current.complete.mock.calls[0]![1]
  state.closed!()
  expect(signal.aborted).toBe(true)
  granted.resolve(undefined)
  await granted.promise
  expect(enter).not.toHaveBeenCalled()
})
it('retries the same device code after a transport failure', async () => {
  const current = auth()
  const enter = vi.fn(async () => {})
  current.complete.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined)
  state.dialog.mockResolvedValueOnce({ response: 0 })
  openJingworkWelcome(resolveDesktopLocale('zh'), current.client, enter)
  await vi.waitFor(() => { expect(enter).toHaveBeenCalledOnce() })
  expect(current.begin).toHaveBeenCalledOnce()
  expect(current.complete.mock.calls[0]![0]).toBe(current.complete.mock.calls[1]![0])
})

it.each(['darwin', 'win32', 'linux'] as const)('uses integrated login window chrome on %s', async (platform) => {
  vi.stubGlobal('process', { ...process, platform })
  try {
    const current = auth()
    current.complete.mockResolvedValue(undefined)
    openJingworkWelcome(resolveDesktopLocale('zh'), current.client, vi.fn(async () => {}))
    await vi.waitFor(() => { expect(current.complete).toHaveBeenCalledOnce() })
    if (platform === 'darwin') {
      expect(state.options).toMatchObject({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } })
    } else if (platform === 'win32') {
      expect(state.options).toMatchObject({ titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', height: 42 } })
    } else {
      expect(state.options).not.toHaveProperty('titleBarStyle')
    }
  } finally {
    vi.unstubAllGlobals()
  }
})
