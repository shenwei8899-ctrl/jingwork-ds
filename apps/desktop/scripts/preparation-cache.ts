/** Reuse unsigned preparation only while its inputs and complete output trees match. */
import { createHash } from 'node:crypto'
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Inputs, outputs and target identity owned by one preparation stage. */
export interface PreparationCacheOptions {
  readonly record: string
  readonly identity: string
  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
}

function digest(paths: readonly string[]): string {
  const hash = createHash('sha256')
  const visit = (path: string, name: string): void => {
    const stat = lstatSync(path)
    hash.update(JSON.stringify([name, stat.mode]))
    if (stat.isSymbolicLink()) hash.update(JSON.stringify(readlinkSync(path)))
    else if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(join(path, entry), `${name}/${entry}`)
    } else if (stat.isFile()) hash.update(createHash('sha256').update(readFileSync(path)).digest())
    else throw new Error(`desktop preparation cache: unsupported file ${path}`)
  }
  for (const [index, path] of paths.entries()) visit(realpathSync(path), String(index))
  return hash.digest('hex')
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/**
 * Serialize one stage and reuse verified outputs, rebuilding absent, changed or invalid records.
 * A failed operation removes its record. A competing invocation fails before changing outputs.
 * @param options - Target-specific cache record and complete preparation inputs and outputs.
 * @param operation - Preparation that publishes every declared output before resolving.
 * @returns Whether the complete prepared output was reused.
 */
export async function reusePreparation(options: PreparationCacheOptions, operation: () => Promise<void>): Promise<boolean> {
  mkdirSync(dirname(options.record), { recursive: true })
  const lock = `${options.record}.lock`
  const descriptor = openSync(lock, 'wx')
  try {
    const input = createHash('sha256').update(options.identity).update(digest(options.inputs)).digest('hex')
    let cached: unknown
    try { cached = JSON.parse(readFileSync(options.record, 'utf8')) }
    catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error }
    if (typeof cached === 'object' && cached !== null && 'input' in cached && cached.input === input && 'output' in cached) {
      try { if (cached.output === digest(options.outputs)) return true }
      catch (error) { if (!missing(error)) throw error }
    }
    rmSync(options.record, { force: true })
    await operation()
    // Inputs changing during preparation must never publish a reusable record.
    const after = createHash('sha256').update(options.identity).update(digest(options.inputs)).digest('hex')
    if (input !== after) throw new Error('desktop preparation cache: inputs changed during preparation; retry with stable inputs')
    writeFileSync(`${options.record}.tmp`, `${JSON.stringify({ input, output: digest(options.outputs) })}\n`)
    renameSync(`${options.record}.tmp`, options.record)
    return false
  } finally {
    closeSync(descriptor)
    try { rmSync(`${options.record}.tmp`, { force: true }) }
    finally { rmSync(lock) }
  }
}
