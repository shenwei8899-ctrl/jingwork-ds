import { expect, it } from 'vitest'
import { desktopInternalUpdate, desktopUpdateChannel } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', dshDesktopUpdateChannel: 'stable' })).toBe('stable')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'latest' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel({ dshDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})

it('authorizes background downloads only through the installed internal Windows manifest', () => {
  const manifest = { dshDesktopProduct: 'jingwork', dshDesktopInternalUpdate: true }
  expect(desktopInternalUpdate(manifest, 'win32')).toBe(true)
  expect(desktopInternalUpdate({}, 'win32')).toBe(false)
  expect(desktopInternalUpdate({ dshDesktopInternalUpdate: false }, 'darwin')).toBe(false)
  expect(() => desktopInternalUpdate(manifest, 'darwin')).toThrow('JingWork Windows')
  expect(() => desktopInternalUpdate({ dshDesktopInternalUpdate: true }, 'win32')).toThrow('JingWork Windows')
  expect(() => desktopInternalUpdate({ dshDesktopInternalUpdate: 'true' }, 'win32')).toThrow('flag')
  expect(() => desktopInternalUpdate(null, 'win32')).toThrow('manifest')
})
