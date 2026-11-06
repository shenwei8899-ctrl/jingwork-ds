import { afterEach, expect, it, vi } from 'vitest'
import type { WelcomeApi } from '../src/welcome-api.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn() },
}))
vi.mock('electron', () => electron)
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules() })

it.each(['harness', 'jingwork'] as const)('exposes localized %s welcome identity without requiring account configuration', async (product) => {
  vi.stubGlobal('process', { ...process, argv: ['electron', '--dsh-welcome-locale=zh-CN', `--dsh-desktop-product=${product}`] })
  await import('../src/preload-welcome.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'dshWelcome')?.[1] as WelcomeApi
  expect(api.product).toBe(product)
  expect(api.messages.welcomeBrand).toBe(product === 'jingwork' ? 'JingWork' : 'DeepSeek Harness')
  expect(api.messages.welcomeSignIn).toBe('登录')
})
