import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { configureDesktopProductIdentity, readDesktopProduct } from '../src/product-identity.ts'

async function fixture(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-product-'))
  try { await action(directory) }
  finally { await rm(directory, { recursive: true, force: true }) }
}

describe('Desktop product identity', () => {
  it('uses fresh JingWork roots independently of inherited Harness roots', async () => {
    await fixture(async (directory) => {
      const original = join(directory, 'harness-data')
      await writeFile(original, 'existing Harness data')
      const environment = { DSH_HOME: original, DSH_AGENTS_HOME: original }
      const application = { getPath: () => join(directory, 'app-data'), setPath: vi.fn(), setName: vi.fn() }
      configureDesktopProductIdentity(application, 'jingwork', environment, directory)
      expect(environment).toEqual({ DSH_HOME: join(directory, '.jingwork'), DSH_AGENTS_HOME: join(directory, '.jingwork/agents') })
      expect(application.setName).toHaveBeenCalledWith('JingWork')
      expect(application.setPath.mock.calls).toEqual([
        ['userData', join(directory, 'app-data/JingWork')], ['sessionData', join(directory, 'app-data/JingWork')],
      ])
      expect(await readdir(join(directory, 'app-data/JingWork'))).toEqual([])
      expect(await readdir(join(directory, '.jingwork'))).toEqual(['agents'])
      expect(await readFile(original, 'utf8')).toBe('existing Harness data')
    })
  })

  it('preserves Harness and qualification paths without creating product data', async () => {
    await fixture(async (directory) => {
      const environment = { DSH_HOME: 'qualification-home', DSH_AGENTS_HOME: 'configured-agents' }
      const application = { getPath: vi.fn(() => directory), setPath: vi.fn(), setName: vi.fn() }
      configureDesktopProductIdentity(application, 'harness', environment, directory)
      expect(application.getPath).not.toHaveBeenCalled()
      expect(application.setPath).not.toHaveBeenCalled()
      expect(application.setName).not.toHaveBeenCalled()
      expect(environment).toEqual({ DSH_HOME: 'qualification-home', DSH_AGENTS_HOME: 'configured-agents' })
      expect(await readdir(directory)).toEqual([])
    })
  })

  it('stops before changing Electron paths or the environment when storage is blocked', async () => {
    await fixture(async (directory) => {
      const blocked = join(directory, '.jingwork')
      await writeFile(blocked, 'occupied')
      const environment = { DSH_HOME: 'existing' }
      const application = { getPath: () => join(directory, 'app-data'), setPath: vi.fn(), setName: vi.fn() }
      expect(() => { configureDesktopProductIdentity(application, 'jingwork', environment, directory) }).toThrow()
      expect(application.setPath).not.toHaveBeenCalled()
      expect(application.setName).not.toHaveBeenCalled()
      expect(environment).toEqual({ DSH_HOME: 'existing' })
    })
  })

  it.each([
    [{ name: '@deepseek-ai/dsh-desktop' }, 'harness'],
    [{ dshDesktopProduct: 'jingwork', dshDesktopAppId: 'com.jingwork.desktop' }, 'jingwork'],
  ])('reads an installed product marker %j', async (metadata, expected) => {
    await fixture(async (directory) => {
      await writeFile(join(directory, 'package.json'), JSON.stringify(metadata))
      expect(readDesktopProduct(directory)).toBe(expected)
    })
  })

  it.each([null, [], 'jingwork', { dshDesktopProduct: 'other' },
    { dshDesktopProduct: 'jingwork', dshDesktopAppId: 'com.deepseek.dsh' }])('rejects invalid installed identity %j', async (metadata) => {
    await fixture(async (directory) => {
      await writeFile(join(directory, 'package.json'), JSON.stringify(metadata))
      expect(() => readDesktopProduct(directory)).toThrow('desktop identity')
    })
  })
})
