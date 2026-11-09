import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { reusePreparation } from '../scripts/preparation-cache.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-preparation-cache-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const input = join(root, 'input'), output = join(root, 'output')
  mkdirSync(input); mkdirSync(output)
  writeFileSync(join(input, 'source'), 'first')
  const options = { record: join(root, 'cache.json'), identity: 'mac-arm64', inputs: [input], outputs: [output] }
  const prepare = vi.fn(async () => { writeFileSync(join(output, 'result'), readFileSync(join(input, 'source'))) })
  return { root, input, output, options, prepare }
}

it('reuses complete outputs while source bytes, target and output bytes match', async () => {
  const f = fixture()
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
  expect(await reusePreparation(f.options, f.prepare)).toBe(true)
  expect(f.prepare).toHaveBeenCalledOnce()
  writeFileSync(join(f.input, 'source'), 'other')
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
  expect(await reusePreparation({ ...f.options, identity: 'mac-x64' }, f.prepare)).toBe(false)
  writeFileSync(join(f.output, 'result'), 'wrong')
  expect(await reusePreparation({ ...f.options, identity: 'mac-x64' }, f.prepare)).toBe(false)
  rmSync(join(f.output, 'result'))
  expect(await reusePreparation({ ...f.options, identity: 'mac-x64' }, f.prepare)).toBe(false)
})

it('rebuilds corrupt records and never publishes success after preparation fails', async () => {
  const f = fixture()
  writeFileSync(f.options.record, '{invalid')
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
  writeFileSync(join(f.input, 'source'), 'other')
  await expect(reusePreparation(f.options, async () => { throw new Error('failed') })).rejects.toThrow('failed')
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
})

it('rejects concurrent preparation and changing inputs, then releases ownership', async () => {
  const f = fixture(), pending = Promise.withResolvers<undefined>()
  const first = reusePreparation(f.options, () => pending.promise)
  await expect(reusePreparation(f.options, f.prepare)).rejects.toThrow()
  writeFileSync(join(f.input, 'source'), 'other')
  pending.resolve(undefined)
  await expect(first).rejects.toThrow('inputs changed')
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
})

it.skipIf(process.platform === 'win32')('invalidates a changed symbolic link', async () => {
  const f = fixture()
  symlinkSync('result', join(f.output, 'link'))
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
  rmSync(join(f.output, 'link'))
  symlinkSync('different', join(f.output, 'link'))
  expect(await reusePreparation(f.options, f.prepare)).toBe(false)
})

it.skipIf(process.platform === 'win32')('hashes the content of linked input roots', async () => {
  const f = fixture(), link = join(f.root, 'linked-input')
  symlinkSync(f.input, link)
  const options = { ...f.options, inputs: [link] }
  expect(await reusePreparation(options, f.prepare)).toBe(false)
  writeFileSync(join(f.input, 'source'), 'other')
  expect(await reusePreparation(options, f.prepare)).toBe(false)
  expect(f.prepare).toHaveBeenCalledTimes(2)
})
