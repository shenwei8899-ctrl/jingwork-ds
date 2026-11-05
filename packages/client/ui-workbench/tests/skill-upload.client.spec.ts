/** Uploaded skill files preserve instructions and reject invalid persisted values. */
import { describe, expect, it } from 'vitest'
import { parseUploadedSkill } from '../src/client/skill-upload.ts'

describe('assistant skill uploads', () => {
  it('reads SKILL.md metadata and plain Markdown filenames', () => {
    expect(parseUploadedSkill('---\nname: meeting-notes\ndescription: Summarize meetings\n---\n\nWrite action items.', 'SKILL.md'))
      .toEqual({ slug: 'meeting-notes', name: 'meeting-notes', description: 'Summarize meetings', content: 'Write action items.' })
    expect(parseUploadedSkill('# Draft a report', 'report.md').slug).toBe('report')
    expect(parseUploadedSkill('\uFEFF---\r\nname: report\r\n---\r\nWrite a report.', 'SKILL.md').content).toBe('Write a report.')
  })
  it.each([
    ['---\nname: Invalid name\n---\nInstructions', 'SKILL.md'],
    ['---\nname: test\ndescription: []\n---\nInstructions', 'SKILL.md'],
    ['---\n- list\n---\nInstructions', 'SKILL.md'],
    ['---\nname: test', 'SKILL.md'],
    [' ', 'empty.md'],
    ['x'.repeat(65537), 'large.md'],
  ])('rejects an unusable upload', (source, filename) => {
    expect(() => parseUploadedSkill(source, filename)).toThrow()
  })
})
