/** Resolve the update channel sealed into the installed application manifest. */
import type { DesktopUpdatePreferences } from './settings-file.ts'

/** Installer-owned channel, independent of release version and upload environment. */
export type DesktopUpdateChannel = DesktopUpdatePreferences['channel']

/**
 * Read the packaged channel; older manifests retain their existing nightly behavior.
 * @param manifest Parsed application manifest.
 * @returns Validated channel. Invalid explicit values reject instead of changing feeds.
 */
export function desktopUpdateChannel(manifest: unknown): DesktopUpdateChannel {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopUpdateChannel' in manifest)) return 'nightly'
  const channel = manifest.dshDesktopUpdateChannel
  if (channel !== 'nightly' && channel !== 'stable') throw new Error('desktop update: invalid packaged channel')
  return channel
}

/**
 * Read background-download authorization sealed into an internal Windows installer.
 * @param manifest Parsed installed application manifest; an absent flag preserves manual downloads.
 * @param platform Current desktop platform.
 * @returns Whether the installed JingWork Windows package authorizes background downloads.
 */
export function desktopInternalUpdate(manifest: unknown, platform: NodeJS.Platform): boolean {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('desktop update: invalid application manifest')
  if (!('dshDesktopInternalUpdate' in manifest)) return false
  if (typeof manifest.dshDesktopInternalUpdate !== 'boolean') throw new Error('desktop update: invalid internal update flag')
  if (!manifest.dshDesktopInternalUpdate) return false
  if (platform !== 'win32' || !('dshDesktopProduct' in manifest) || manifest.dshDesktopProduct !== 'jingwork') {
    throw new Error('desktop update: internal updates require a JingWork Windows installer')
  }
  return true
}
