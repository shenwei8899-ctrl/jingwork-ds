/** Build Desktop installers sequentially through the existing target packager. */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '../../..')
const targets = ['mac-arm64', 'mac-x64', 'win-x64', 'win-arm64']
const { values, positionals } = parseArgs({
  args: process.argv.slice(2).filter(argument => argument !== '--'),
  allowPositionals: true,
  options: {
    signed: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'build-version': { type: 'string' },
    help: { type: 'boolean', default: false },
  },
})
if (values.help) {
  console.log('Usage: node apps/desktop/scripts/package-installers.mjs [host|mac|mac-arm64|mac-x64|win-x64|win-arm64] [--signed] [--build-version VERSION] [--dry-run]')
  console.log('Default: unsigned installers for this host. Apple Silicon builds both Mac architectures. Windows requires the matching native host. Intel Mac builds x64 only.')
  process.exit(0)
}
if (positionals.length > 1) throw new Error('Expected one target or target group')
const selection = positionals[0] ?? 'host'
const hostTargets = process.platform === 'darwin'
  ? process.arch === 'arm64' ? ['mac-arm64', 'mac-x64'] : ['mac-x64']
  : [`win-${process.arch}`]
const selected = selection === 'host' ? hostTargets : selection === 'mac' ? ['mac-arm64', 'mac-x64'] : [selection]
for (const target of selected) {
  if (!targets.includes(target)) throw new Error(`Unsupported target ${target}. Expected ${targets.join(', ')}, mac or host`)
  if (selection === 'host' && !['darwin', 'win32'].includes(process.platform)) throw new Error('Packaging requires macOS or Windows')
  if (!values['dry-run'] && !hostTargets.includes(target)) throw new Error(`${target} requires a compatible native build host. Use the Desktop installers workflow for all four targets`)
  if (values.signed && target === 'win-arm64') throw new Error('Windows ARM64 currently supports unsigned installers only')
}
if (values['build-version'] !== undefined && !values['build-version'].trim()) throw new Error('--build-version requires a nonempty version')
for (const target of selected) {
  const args = ['--filter', '@deepseek-ai/dsh-desktop', 'exec', 'tsx', 'scripts/package-target.ts', target,
    ...(values.signed ? [] : ['--unsigned']),
    ...(values['build-version'] === undefined ? [] : ['--build-version', values['build-version']])]
  console.log(`pnpm ${args.join(' ')}`)
  if (values['dry-run']) continue
  const pnpmEntry = resolve(import.meta.dirname, '../node_modules/pnpm/bin/pnpm.cjs')
  const result = spawnSync(process.execPath, [pnpmEntry, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Packaging ${target} failed (${result.signal ?? result.status})`)
  console.log(`Installer output: apps/desktop/.desktop-build/targets/${target}/${values.signed ? 'artifacts' : 'unsigned-artifacts'}`)
}
