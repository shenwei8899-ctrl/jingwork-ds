/** Built-in skill cards are generated from source metadata and localized completely. */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseBuiltinSkill, readBuiltinSkillCatalog } from '../build/builtin-skills.ts'
import { BUILTIN_SKILL_COPY } from '../src/client/builtin-skill-copy.ts'
import { zh, en } from '../src/client/locales.ts'

const roots: string[] = []
function root(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-workbench-skills-'))
  roots.push(directory)
  return directory
}
function skill(directory: string, name: string, raw: string): void {
  mkdirSync(join(directory, name))
  writeFileSync(join(directory, name, 'SKILL.md'), raw)
}
afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true })
})
const source = (name: string, extra = '') => `---\nname: ${name}\ndescription: Describe ${name}.\n${extra}---\n\nDo not copy this instruction body.\n`

describe('workbench built-in skill metadata', () => {
  it('retains source descriptions, portable paths and explicit invocation restrictions', () => {
    expect(parseBuiltinSkill(source('skill-one'), '.agents/skills/skill-one/SKILL.md')).toEqual({
      content: 'Do not copy this instruction body.',
      name: 'skill-one',
      description: 'Describe skill-one.',
      path: '.agents/skills/skill-one/SKILL.md',
      userInvocable: true,
      modelInvocable: true,
    })
    const restricted = parseBuiltinSkill(source('skill-two', 'disable-model-invocation: true\nuser-invocable: false\n').replaceAll('\n', '\r\n'), '.agents/skills/skill-two/SKILL.md')
    expect(restricted.userInvocable).toBe(false)
    expect(restricted.modelInvocable).toBe(false)
    expect(restricted.content).toContain('instruction body')
  })
  it.each([
    'no frontmatter',
    '---\n- wrong\n---\n',
    '---\nname: Wrong Name\ndescription: Description\n---\n',
    '---\nname: valid\n---\n',
    '---\nname: valid\ndescription: ""\n---\n',
    '---\nname: valid\ndescription: Description\nuser-invocable: never\n---\n',
    '---\nname: valid\ndescription: Description\ndisable-model-invocation: 1\n---\n',
  ])('rejects invalid skill metadata: %s', (raw) => {
    expect(() => parseBuiltinSkill(raw, '.agents/skills/invalid/SKILL.md')).toThrow('workbench skill')
  })
  it('sorts every directory skill and rejects missing translations and duplicate names', () => {
    const directory = root()
    skill(directory, 'second', source('second'))
    skill(directory, 'first', source('first'))
    writeFileSync(join(directory, '.gitignore'), 'second/\n')
    expect(readBuiltinSkillCatalog(directory, ['first', 'second']).map(item => item.name)).toEqual(['first', 'second'])
    expect(() => readBuiltinSkillCatalog(directory, ['first'])).toThrow('localized display copy is missing')
    writeFileSync(join(directory, 'second', 'SKILL.md'), source('first'))
    expect(() => readBuiltinSkillCatalog(directory, ['first', 'second'])).toThrow('duplicate name first')
  })
  it('covers every current source skill with Chinese title and description keys', () => {
    const directory = join(import.meta.dirname, '../../../../.agents/skills')
    const catalog = readBuiltinSkillCatalog(directory, Object.keys(BUILTIN_SKILL_COPY))
    const expected = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => parseBuiltinSkill(readFileSync(join(directory, entry.name, 'SKILL.md'), 'utf8'), `.agents/skills/${entry.name}/SKILL.md`).name)
      .sort()
    expect(catalog.map(item => item.name).sort()).toEqual(expected)
    for (const item of catalog) {
      const copy = BUILTIN_SKILL_COPY[item.name]
      if (copy === undefined) throw new Error(`Missing localized skill ${item.name}`)
      expect(zh[copy.nameKey]).toMatch(/[\u3400-\u9fff]/u)
      expect(zh[copy.descriptionKey]).toMatch(/[\u3400-\u9fff]/u)
      expect(en[copy.nameKey].length).toBeGreaterThan(0)
      expect(en[copy.descriptionKey].length).toBeGreaterThan(0)
      expect(item.path.startsWith('.agents/skills/')).toBe(true)
      expect(item.path).not.toContain('\\')
    }
  })
})
