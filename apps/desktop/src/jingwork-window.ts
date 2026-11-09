/** Sandboxed native window showing Jingwork's original login and authorization pages. */
import { BrowserWindow, dialog } from 'electron'
import type { DesktopLocale } from './locale.ts'
import { JingworkLoginRefused, type JingworkDesktopAuth, type JingworkLoginAttempt } from './jingwork-auth.ts'

/** Open Jingwork and enter Harness after native token exchange and encrypted persistence.
 * @param locale Shell-owned copy for native connection errors.
 * @param auth Same-origin Jingwork authentication client.
 * @param enterWorkspace Called after successful authorization.
 * @returns The owned native login window.
 */
export function openJingworkWelcome(
  locale: DesktopLocale, auth: JingworkDesktopAuth, enterWorkspace: () => Promise<void>,
): BrowserWindow {
  const window = new BrowserWindow({
    width: 1040, height: 780, minWidth: 600, minHeight: 640, show: false,
    title: locale.messages.jingworkLoginTitle, autoHideMenuBar: true,
    backgroundColor: '#edf3fb',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 16, y: 18 },
    } : {}),
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: { color: '#00000000', height: 42 },
    } : {}),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      partition: 'persist:jingwork-login' },
  })
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} JingworkDesktop/1`)
  const lifetime = new AbortController()
  window.once('closed', () => { lifetime.abort() })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guard = (event: Electron.Event, target: string): void => {
    if (new URL(target).origin !== auth.origin) event.preventDefault()
  }
  window.webContents.on('will-navigate', guard)
  window.webContents.on('will-redirect', guard)

  const cancelled = (): boolean => lifetime.signal.aborted || window.isDestroyed()
  let attempt: JingworkLoginAttempt | undefined
  const authorize = async (): Promise<void> => {
    try {
      if (attempt === undefined || attempt.expiresAt <= Date.now()) {
        attempt = await auth.begin(lifetime.signal)
        lifetime.signal.throwIfAborted()
        await window.loadURL(attempt.url)
        if (!window.isDestroyed()) window.show()
      }
      await auth.complete(attempt, lifetime.signal)
      if (!cancelled()) await enterWorkspace()
    } catch (error: unknown) {
      if (error instanceof JingworkLoginRefused) attempt = undefined
      if (cancelled()) return
      const result = await dialog.showMessageBox(window, {
        type: 'error', title: locale.messages.jingworkLoginTitle,
        message: locale.messages.jingworkLoginFailed,
        buttons: [locale.messages.jingworkLoginRetry, locale.messages.cancel], cancelId: 1,
      })
      if (cancelled()) return
      if (result.response === 0) await authorize()
      else window.close()
    }
  }
  void authorize().catch((_closedDialog: unknown) => {
    // A native dialog can be rejected while the application is closing.
    if (!window.isDestroyed()) window.close()
  })
  return window
}
