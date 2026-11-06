/** Product presentation passed from the native owner into sandboxed renderers. */

import type { DesktopLocale } from './locale.ts'

/** Application identity shared by native startup and sandboxed presentation. */
export type DesktopProduct = 'harness' | 'jingwork'

/**
 * Resolve the installed product's proper name for native and renderer presentation.
 * @param product - Installed product identity.
 * @returns Product name shared by the application title and welcome page.
 */
export function desktopProductName(product: DesktopProduct): string {
  return product === 'jingwork' ? 'JingWork' : 'DeepSeek Harness'
}

/**
 * Resolve the native product marker supplied to a renderer process.
 * @param args - Electron renderer arguments, including the native owner's additional arguments.
 * @returns JingWork for its explicit marker, otherwise the Harness presentation.
 * @throws Error when a supplied product marker is unsupported.
 */
export function desktopPresentationProduct(args: readonly string[]): DesktopProduct {
  const prefix = '--dsh-desktop-product='
  const product = args.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
  if (product === undefined || product === 'harness') return 'harness'
  if (product === 'jingwork') return 'jingwork'
  throw new Error('desktop presentation: unsupported renderer product')
}

/**
 * Apply the installed product name to locale-owned native welcome messages.
 * @param locale - Selected Desktop language and messages.
 * @param product - Installed product whose name appears on the welcome surface.
 * @returns The original Harness locale, or JingWork welcome copy without mutating a dictionary.
 */
export function desktopWelcomeLocale(locale: DesktopLocale, product: DesktopProduct): DesktopLocale {
  if (product === 'harness') return locale
  const name = desktopProductName(product)
  return {
    ...locale,
    messages: {
      ...locale.messages,
      welcomeTitle: name,
      welcomeBrand: name,
      welcomeTaglineBrand: name,
      welcomeKeyDescription: locale.messages.welcomeKeyDescription.replaceAll('DeepSeek Harness', 'JingWork').replaceAll('Harness', 'JingWork'),
    },
  }
}
