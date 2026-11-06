/** The packaged macOS worker derives fixed command paths from its staged product identity. */

import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ commandName: 'dsh', inspect: vi.fn() }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) =>
    String(args[0]).endsWith('command-name') ? state.commandName + '\n' : actual.readFileSync(...args) }
})

vi.mock('../src/command-installation.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/command-installation.ts')>(),
  inspectFileCommand: state.inspect,
}))

describe.skipIf(process.platform !== 'darwin')('packaged macOS command worker', () => {
  const originalArgv = process.argv

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    state.commandName = 'dsh'
    state.inspect.mockResolvedValue({ managed: false })
    process.argv = [process.execPath, 'command-manager.js', 'inspect']
    vi.spyOn(process, 'umask').mockReturnValue(0o022)
  })

  afterEach(() => {
    process.argv = originalArgv
    vi.restoreAllMocks()
  })

  it.each(['dsh', 'jingwork'])('inspects only the staged %s command', async (commandName) => {
    state.commandName = commandName
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await import('../src/command-manager-entry.ts')
    const resources = resolve(import.meta.dirname, '../..')
    expect(state.inspect).toHaveBeenCalledWith({ destination: `/usr/local/bin/${commandName}`,
      launcher: join(resources, 'runtime', 'cli', 'bin', commandName),
      linkHelper: join(resources, 'runtime', 'cli', 'link-entry') })
    expect(output).toHaveBeenCalledWith(JSON.stringify({ ok: true, state: { managed: false } }) + '\n')
  })

  it('rejects an unknown packaged command before reading installation state', async () => {
    state.commandName = '../other-command'
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    await import('../src/command-manager-entry.ts')
    expect(state.inspect).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith(JSON.stringify({ ok: false, code: 'EINVAL', message: 'Invalid packaged command name.' }) + '\n')
  })
})
