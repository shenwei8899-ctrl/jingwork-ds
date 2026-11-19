import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDesktopAutoUpdateConfig, resolveDesktopInternalUpdate } from '../scripts/desktop-auto-update-environment.mjs'
import { desktopArtifactOutput, desktopTargetBuildPaths } from '../scripts/desktop-build-paths.mjs'
import { localWindowsPackageEnvironment, validateDesktopPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'
import { parseDesktopPackageInvocation } from '../scripts/package-target.ts'

const environment = {
  DSH_DESKTOP_APP_ID: 'com.jingwork.desktop',
  DSH_DESKTOP_PRODUCT: 'jingwork',
  DSH_DESKTOP_UNSIGNED: '1',
  DSH_DESKTOP_INTERNAL_UPDATE: '1',
  DSH_DESKTOP_AUTO_UPDATE_ENV: 'production',
  DOWNLOAD_PROD_ORIGIN: 'https://updates.example.com',
}

describe('Windows internal update distribution', () => {
  it('retains update metadata without Windows signing credentials in an isolated output and HTTPS feed', () => {
    const invocation = parseDesktopPackageInvocation(['win-x64', '--internal-update'], 'win32', 'x64')
    expect(invocation).toMatchObject({ unsigned: true, internalUpdate: true, prepareOnly: false })
    validateDesktopPackageEnvironment(environment, invocation.target, invocation)
    const config = createElectronBuilderConfig(environment, 'win32', 'x64')
    expect(config.win.forceCodeSigning).toBe(false)
    expect(config.win.verifyUpdateCodeSignature).toBe(false)
    expect(config.win.signtoolOptions.sign).toBeUndefined()
    expect(config.win.signtoolOptions.publisherName).toBeUndefined()
    expect(config.extraMetadata).toMatchObject({ dshDesktopProduct: 'jingwork', dshDesktopInternalUpdate: true })
    expect(config.publish).toEqual([{ provider: 'generic', channel: 'nightly',
      url: 'https://updates.example.com/jingwork/internal/feeds/win-x64/' }])
    expect(config.directories.output).toContain(join('win-x64', 'internal-artifacts'))
    expect(config.artifactName).toBe('deepseek-harness-${version}-${os}-${arch}-internal.${ext}')
    expect(desktopArtifactOutput(desktopTargetBuildPaths('win-x64'), invocation).directory).toBe(config.directories.output)
  })

  it('keeps ordinary unsigned development packages offline even with inherited internal settings', () => {
    const local = localWindowsPackageEnvironment(environment)
    expect(local.DSH_DESKTOP_INTERNAL_UPDATE).toBeUndefined()
    const config = createElectronBuilderConfig(local, 'win32', 'x64')
    expect(config.publish).toBeNull()
    expect(config.win.verifyUpdateCodeSignature).toBeUndefined()
    expect(config.extraMetadata).not.toHaveProperty('dshDesktopInternalUpdate')
  })

  it.each([
    ['mac-arm64', []], ['win-arm64', []], ['win-x64', ['--unsigned']],
    ['win-x64', ['--prepare-only']], ['win-x64', ['--skip-notarization']],
  ])('rejects internal mode for %s with %j', (target, options) => {
    expect(() => parseDesktopPackageInvocation([target, '--internal-update', ...options], 'win32', 'x64'))
      .toThrow('--internal-update')
  })

  it('rejects missing or insecure destinations, other products, and ambiguous signing modes', () => {
    for (const origin of [undefined, 'http://updates.example.com', 'https://updates.example.com/path']) {
      expect(() => resolveDesktopAutoUpdateConfig({ ...environment, DOWNLOAD_PROD_ORIGIN: origin }, 'win32', 'x64')).toThrow()
    }
    expect(() => resolveDesktopInternalUpdate({ ...environment, DSH_DESKTOP_PRODUCT: 'dsh' }, 'win32', 'x64')).toThrow('JingWork')
    expect(() => resolveDesktopInternalUpdate({ DSH_DESKTOP_INTERNAL_UPDATE: 'yes' }, 'win32', 'x64')).toThrow('0 or 1')
    expect(() => createElectronBuilderConfig({ ...environment, DSH_DESKTOP_UNSIGNED: '0' }, 'win32', 'x64')).toThrow('unsigned')
    expect(() => { validateDesktopPackageEnvironment(environment, { platform: 'win32', arch: 'x64' }, {}) }).toThrow('unsigned')
  })
})
