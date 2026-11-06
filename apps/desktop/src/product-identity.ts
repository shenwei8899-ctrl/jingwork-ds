/** Product-owned storage selected before Desktop services or instance locks initialize. */

import { mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DesktopProduct } from './product-presentation.ts'

/** Electron operations available before application readiness. */
export interface DesktopProductApplication {
  getPath(name: 'appData'): string
  setName(name: string): void
  setPath(name: 'userData' | 'sessionData', path: string): void
}

/**
 * Read the packaged product marker and reject an inconsistent JingWork application identifier.
 * @param applicationPath - Directory containing the installed application manifest.
 * @returns The product whose private directories and external protocol apply.
 * @throws Error when the manifest or its product identity is invalid.
 */
export function readDesktopProduct(applicationPath: string): DesktopProduct {
  const metadata: unknown = JSON.parse(readFileSync(join(applicationPath, 'package.json'), 'utf8'))
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('desktop identity: the application manifest must contain an object; reinstall the application')
  }
  if (!('dshDesktopProduct' in metadata)) return 'harness'
  if (metadata.dshDesktopProduct !== 'jingwork'
    || !('dshDesktopAppId' in metadata) || metadata.dshDesktopAppId !== 'com.jingwork.desktop') {
    throw new Error('desktop identity: the JingWork product marker requires com.jingwork.desktop; reinstall the application')
  }
  return 'jingwork'
}

/**
 * Create JingWork's private directories before importing Desktop services or claiming an instance.
 * @param application - Electron path operations before readiness.
 * @param product - Validated installed product identity.
 * @param environment - Process environment inherited by the Host and plugin subprocesses.
 * @param homeDirectory - User home containing the independent JingWork data root.
 * @throws Error when a private directory cannot be created. Empty directories may remain after failure.
 */
export function configureDesktopProductIdentity(
  application: DesktopProductApplication,
  product: DesktopProduct,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): void {
  if (product === 'harness') return
  const userData = join(application.getPath('appData'), 'JingWork')
  const home = join(homeDirectory, '.jingwork')
  const agents = join(home, 'agents')
  for (const directory of [userData, home, agents]) mkdirSync(directory, { recursive: true, mode: 0o700 })
  application.setName('JingWork')
  application.setPath('userData', userData)
  application.setPath('sessionData', userData)
  environment.DSH_HOME = home
  environment.DSH_AGENTS_HOME = agents
}
