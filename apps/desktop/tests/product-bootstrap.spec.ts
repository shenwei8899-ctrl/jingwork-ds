import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.doUnmock('electron')
  vi.doUnmock('../src/main.ts')
  vi.resetModules()
})

describe('Desktop product bootstrap', () => {
  it.each(['harness', 'jingwork'] as const)('configures %s before importing services and claiming their instance', async (product) => {
    const directory = await mkdtemp(join(tmpdir(), 'desktop-bootstrap-'))
    vi.stubEnv('HOME', directory)
    vi.stubEnv('DSH_HOME', join(directory, 'existing-home'))
    vi.stubEnv('DSH_AGENTS_HOME', join(directory, 'existing-agents'))
    const events: string[] = []
    const paths = { userData: join(directory, 'existing-user-data'), sessionData: join(directory, 'existing-user-data') }
    const app = { isPackaged: true, getAppPath: () => directory, getPath: () => directory,
      setName: vi.fn(), setPath: (name: 'userData' | 'sessionData', value: string) => { paths[name] = value },
      getLocale: () => 'en', getName: () => 'Desktop', exit: vi.fn() }
    vi.doMock('electron', () => ({ app, dialog: { showErrorBox: vi.fn() } }))
    vi.doMock('../src/main.ts', () => {
      events.push('services-imported')
      expect(paths.userData).toBe(join(directory, product === 'jingwork' ? 'JingWork' : 'existing-user-data'))
      expect(process.env.DSH_HOME).toBe(join(directory, product === 'jingwork' ? '.jingwork' : 'existing-home'))
      expect(process.env.DSH_AGENTS_HOME).toBe(join(directory, product === 'jingwork' ? '.jingwork/agents' : 'existing-agents'))
      return { startDesktop: (selected: string) => { events.push(`instance:${selected}`) } }
    })
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify(product === 'jingwork'
        ? { dshDesktopProduct: 'jingwork', dshDesktopAppId: 'com.jingwork.desktop' } : {}))
      await import('../src/bootstrap.ts')
      expect(events).toEqual(['services-imported', `instance:${product}`])
      expect(app.exit).not.toHaveBeenCalled()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('reports an invalid product before importing services or creating private storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desktop-bootstrap-invalid-'))
    const app = { isPackaged: true, getAppPath: () => directory, getLocale: () => 'zh-CN',
      getName: () => 'JingWork', exit: vi.fn() }
    const dialog = { showErrorBox: vi.fn() }
    const imported = vi.fn()
    vi.doMock('electron', () => ({ app, dialog }))
    vi.doMock('../src/main.ts', () => { imported(); return { startDesktop: vi.fn() } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({ dshDesktopProduct: 'jingwork', dshDesktopAppId: 'com.deepseek.dsh' }))
      await import('../src/bootstrap.ts')
      expect(imported).not.toHaveBeenCalled()
      expect(app.exit).toHaveBeenCalledWith(1)
      expect(dialog.showErrorBox).toHaveBeenCalledWith('JingWork', expect.stringContaining('应用无法启动'))
      expect(await readdir(directory)).toEqual(['package.json'])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
