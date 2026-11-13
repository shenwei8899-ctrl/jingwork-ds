/** Native sign-in status window owning system-browser authorization and cancellation. */
import { app, BrowserWindow, dialog, shell } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
    backgroundColor: '#ffffff',
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
  const lifetime = new AbortController()
  window.once('closed', () => { lifetime.abort() })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guard = (event: Electron.Event, target: string): void => {
    event.preventDefault()
    if (target === attempt?.url) {
      void shell.openExternal(target).catch(() => {
        if (!cancelled()) void dialog.showMessageBox(window, {
          type: 'error', message: locale.messages.jingworkLoginFailed,
        })
      })
    }
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
        const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
        const logoPath = app.isPackaged ? join(process.resourcesPath, 'icon.png')
          : join(app.getAppPath(), 'resources', 'icon-jingwork.png')
        const logo = readFileSync(logoPath).toString('base64')
        const page = `<!doctype html><html><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
          <title>${escape(locale.messages.jingworkLoginTitle)}</title>
          <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; min-height: 100%; }
          body { background: #fff; color: #171719; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
          .titlebar { position: fixed; inset: 0 0 auto; height: 56px; -webkit-app-region: drag; }
          main { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 80px 32px; }
          .welcome { width: 100%; max-width: 640px; text-align: center; transform: translateY(-24px); }
          .logo { display: block; width: 144px; height: 144px; object-fit: contain; margin: 0 auto 32px; }
          h1 { margin: 0; font-size: 32px; line-height: 1.4; font-weight: 500; letter-spacing: -.8px; text-wrap: balance; }
          .login { display: inline-flex; align-items: center; justify-content: center; min-width: 224px;
            min-height: 48px; margin-top: 36px; padding: 12px 28px; border-radius: 999px; background: #19191b;
            color: #fff; font-size: 15px; font-weight: 500; line-height: 24px; text-decoration: none;
            -webkit-app-region: no-drag; transition: background .15s, transform .15s; }
          .login:hover { background: #353538; }
          .login:active { transform: translateY(1px); }
          .login:focus-visible { outline: 3px solid #6258ff; outline-offset: 4px; }
          .hint { max-width: 400px; margin: 20px auto 0; color: #77777f; font-size: 13px; line-height: 1.7; text-wrap: balance; }
          @media (max-width: 640px), (max-height: 640px) {
            main { padding: 72px 24px 40px; }
            .welcome { transform: none; }
            .logo { width: 112px; height: 112px; margin-bottom: 24px; }
            h1 { font-size: 27px; }
            .login { margin-top: 28px; }
          }
          @media (prefers-reduced-motion: reduce) { .login { transition: none; } }
          </style></head><body><div class="titlebar" aria-hidden="true"></div><main>
          <section class="welcome" aria-labelledby="welcome-title">
            <img class="logo" src="data:image/png;base64,${logo}" alt="JingWork">
            <h1 id="welcome-title">${escape(locale.messages.jingworkWelcomeTitle)}</h1>
            <a class="login" href="${escape(attempt.url)}">${escape(locale.messages.jingworkLoginBrowser)}</a>
            <p class="hint">${escape(locale.messages.jingworkLoginBrowserHint)}</p>
          </section></main></body></html>`
        await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page))
        if (!window.isDestroyed()) window.show()
        await shell.openExternal(attempt.url)
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
