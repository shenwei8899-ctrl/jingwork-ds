/** Package terminal launch scripts that reuse the installed Electron runtime. */

import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Copy the platform launcher into the application's public command directory.
 * @param destination - Physical runtime/cli directory prepared for the application.
 * @param platform - Target Desktop operating system.
 * @param product - Application whose command name and data directories the launcher uses.
 * @throws Error when a JingWork launcher is requested for Windows.
 */
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32', product: 'harness' | 'jingwork' = 'harness'): void {
  if (product === 'jingwork' && platform !== 'darwin') throw new Error('desktop CLI: JingWork requires macOS')
  const commandName = product === 'jingwork' ? 'jingwork' : 'dsh'
  const name = platform === 'win32' ? 'dsh.cmd' : commandName
  const command = join(destination, 'bin', name)
  mkdirSync(join(destination, 'bin'), { recursive: true })
  copyFileSync(join(import.meta.dirname, '..', 'cli', name), command)
  writeFileSync(join(destination, 'command-name'), commandName + '\n')
  if (platform === 'darwin') chmodSync(command, 0o755)
}
