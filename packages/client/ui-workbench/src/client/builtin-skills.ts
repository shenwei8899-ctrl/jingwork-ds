/** Build-owned repository skill metadata; source imports do not evaluate the injected value. */
import type { BuiltinSkill } from '../types.ts'

declare const __DSH_WORKBENCH_BUILTIN_SKILLS__: readonly BuiltinSkill[]

/** Read the skill metadata embedded by this package's browser bundle.
 * @returns The immutable catalog captured from repository skill frontmatter at build time.
 */
export function builtinSkills(): readonly BuiltinSkill[] {
  return __DSH_WORKBENCH_BUILTIN_SKILLS__
}
