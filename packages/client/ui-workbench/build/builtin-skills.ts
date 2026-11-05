/** Package repository skill definitions for the workbench catalog and assistant editor. */
import { readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { BuiltinSkill } from '../src/types.ts'

/** Parse one skill's frontmatter and retain its instruction body.
 * @param raw Complete SKILL.md source text.
 * @param path Repository-relative path used by the display catalog and diagnostics.
 * @returns Validated display metadata, instructions and invocation flags.
 * @throws When frontmatter, required metadata or invocation flags are invalid.
 */
export function parseBuiltinSkill(raw: string, path: string): BuiltinSkill {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (frontmatter?.[1] === undefined) throw new Error(`workbench skill ${path}: YAML frontmatter is required`)
  const metadata: unknown = parseYaml(frontmatter[1])
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error(`workbench skill ${path}: frontmatter must be an object`)
  }
  const name = 'name' in metadata ? metadata.name : undefined
  const description = 'description' in metadata ? metadata.description : undefined
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    throw new Error(`workbench skill ${path}: name must be a kebab-case identifier`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`workbench skill ${path}: description is required`)
  }
  const modelDisabled = 'disable-model-invocation' in metadata ? metadata['disable-model-invocation'] : false
  const userInvocable = 'user-invocable' in metadata ? metadata['user-invocable'] : true
  if (typeof modelDisabled !== 'boolean' || typeof userInvocable !== 'boolean') {
    throw new Error(`workbench skill ${path}: invocation flags must be boolean`)
  }
  return {
    content: raw.slice(frontmatter[0].length).trim(),
    name,
    description: description.trim(),
    path,
    userInvocable,
    modelInvocable: !modelDisabled,
  }
}

/**
 * Build a stable catalog from every immediate directory-bundle skill.
 * @param directory Local source directory; this path never reaches browser output.
 * @param localizedSlugs Skill identifiers covered by the owning UI dictionaries.
 * @returns Sorted, uniquely named definitions with portable repository-relative paths.
 * @throws When a skill is unreadable, malformed, duplicated or lacks localization.
 */
export function readBuiltinSkillCatalog(directory: string, localizedSlugs: readonly string[]): readonly BuiltinSkill[] {
  const skills = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => parseBuiltinSkill(
      readFileSync(join(directory, entry.name, 'SKILL.md'), 'utf8'),
      posix.join('.agents/skills', entry.name, 'SKILL.md'),
    ))
    .sort((left, right) => left.name.localeCompare(right.name))
  const seen = new Set<string>()
  for (const skill of skills) {
    if (seen.has(skill.name)) throw new Error(`workbench skill ${skill.path}: duplicate name ${skill.name}`)
    if (!localizedSlugs.includes(skill.name)) throw new Error(`workbench skill ${skill.path}: localized display copy is missing`)
    seen.add(skill.name)
  }
  return skills
}
