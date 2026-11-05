/** Parse uploaded Markdown skills before adding them to a profile draft. */
import { parse } from 'yaml'
import type { WorkbenchSkill } from '../types.ts'

/** Read optional SKILL.md frontmatter and validate the persisted instruction fields.
 * @param raw Uploaded Markdown text.
 * @param filename Original filename, used as the identifier for plain Markdown.
 * @returns A skill ready for the assistant editor's staged selection.
 * @throws When metadata, identifiers or instruction text cannot be saved.
 */
export function parseUploadedSkill(raw: string, filename: string): WorkbenchSkill {
  const source = raw.replace(/^\uFEFF/u, '')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)
  const header = frontmatter?.[1]
  const metadata: unknown = header === undefined ? {} : parse(header)
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('Skill metadata must be an object')
  }
  if (/^---\r?\n/u.test(source) && !frontmatter) throw new Error('Unclosed skill metadata')
  const slug = 'name' in metadata ? metadata.name : filename.replace(/\.md$/iu, '')
  const description = 'description' in metadata ? metadata.description : ''
  const content = (frontmatter ? source.slice(frontmatter[0].length) : source).trim()
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/u.test(slug) ||
      typeof description !== 'string' || description.length > 65536 || !content || content.length > 65536) {
    throw new Error('Invalid skill metadata or instructions')
  }
  return { slug, name: slug, description, content }
}
