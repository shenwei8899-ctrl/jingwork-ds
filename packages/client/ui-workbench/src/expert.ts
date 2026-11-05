/** Resolve legacy profile assistants before display or preset composition. */
import type { Expert, ExpertCategory } from './types.ts'

/** Assistant definition with ownership and activation resolved explicitly. */
export type ResolvedExpert = Expert & { category: ExpertCategory; enabled: boolean; knowledge: string }

/** Resolve optional fields retained for existing profile configuration.
 * @param expert Saved or built-in assistant definition.
 * @returns The definition with personal ownership, enabled activation and empty reference material when unspecified.
 */
export function resolveExpert(expert: Expert): ResolvedExpert {
  return {
    ...expert,
    category: expert.category ?? 'personal',
    enabled: expert.enabled ?? true,
    knowledge: expert.knowledge ?? '',
  }
}
