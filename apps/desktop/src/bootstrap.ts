/** Initialize packaged product storage before loading Desktop services and their instance locks. */

import { app, dialog } from 'electron'
import { configureDesktopProductIdentity, readDesktopProduct } from './product-identity.ts'
import { resolveDesktopLocale } from './locale.ts'

try {
  const product = app.isPackaged ? readDesktopProduct(app.getAppPath()) : 'harness'
  configureDesktopProductIdentity(app, product)
  const { startDesktop } = await import('./main.ts')
  startDesktop(product)
} catch (error) {
  console.error(error)
  const messages = resolveDesktopLocale(app.getLocale()).messages
  dialog.showErrorBox(app.getName(), [messages.fatalSummary,
    error instanceof Error ? error.message : String(error), messages.startupReinstallAdvice].join('\n\n'))
  app.exit(1)
}
