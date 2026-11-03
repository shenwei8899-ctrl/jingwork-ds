/** Compositions retain expert instructions and only mount explicitly assigned connectors. */
import { describe, expect, it } from 'vitest'
import { defaultWorkbench } from '../src/defaults.ts'
import { workbenchPresets } from '../src/presets.ts'
import { validateWorkbench } from '../src/validation.ts'
import { resolveExpert } from '../src/expert.ts'

describe('workbench configuration', () => {
  it('provides independent default experts and a team with real delegation tools', () => {
    const data = validateWorkbench(defaultWorkbench())
    const definitions = workbenchPresets(data)
    expect(definitions).toHaveLength(7)
    const team = definitions.find(row => row.id === 'workbench-content-team')!
    expect(team.plugins.find(row => row.id === 'tool-subagent')?.config).toMatchObject({ provider: 'spawn' })
    expect(team.plugins.find(row => row.id === 'persona')?.config).toHaveProperty('prefix')
    data.experts[0]!.name = 'Changed'
    expect(defaultWorkbench().experts[0]!.name).not.toBe('Changed')
  })
  it('keeps legacy assistants personal and enabled while marking shipped defaults as built-in', () => {
    const legacy = { ...defaultWorkbench().experts[0]! }
    delete legacy.category
    delete legacy.enabled
    const data = defaultWorkbench()
    data.experts[0] = legacy
    const parsed = validateWorkbench(data)
    expect(resolveExpert(parsed.experts[0]!)).toMatchObject({ category: 'personal', enabled: true })
    expect(defaultWorkbench().experts.every(expert => expert.category === 'builtin' && expert.enabled)).toBe(true)
    expect(workbenchPresets(parsed)).toHaveLength(7)
  })
  it('removes disabled assistants and their teams from the new-session roster without deleting configuration', () => {
    const data = defaultWorkbench()
    data.experts.find(expert => expert.slug === 'writer')!.enabled = false
    const ids = workbenchPresets(validateWorkbench(data)).map(preset => preset.id)
    expect(ids).not.toContain('workbench-writer')
    expect(ids).not.toContain('workbench-content-team')
    expect(ids).toContain('workbench-assistant')
    expect(data.teams[0]!.members).toContain('writer')
    data.experts.find(expert => expert.slug === 'writer')!.enabled = true
    expect(workbenchPresets(data)).toHaveLength(7)
  })
  it('rejects unknown assistant ownership and activation values in imported configuration', () => {
    const data = defaultWorkbench()
    expect(() => validateWorkbench({ ...data, experts: [{ ...data.experts[0], category: 'market' }] })).toThrow()
    expect(() => validateWorkbench({ ...data, experts: [{ ...data.experts[0], enabled: 'false' }] })).toThrow()
  })
  it('includes selected skill contents and assigned enabled MCP servers only', () => {
    const data = defaultWorkbench()
    data.skills = [{ slug: 'editing', name: 'Editing', description: 'Edit prose', content: 'Check every fact.' }]
    data.connectors = ['assigned', 'disabled', 'unassigned'].map(slug => ({
      slug,
      name: slug,
      transport: 'streamable-http',
      url: 'http://localhost:8999/mcp',
      command: '',
      args: [],
      enabled: slug !== 'disabled',
    }))
    data.experts[0]!.skills = ['editing']
    data.experts[0]!.connectors = ['assigned', 'disabled']
    const preset = workbenchPresets(validateWorkbench(data))[0]!
    expect(preset.plugins.filter(row => row.name === '@deepseek-ai/dsh-mcp-client').map(row => row.id)).toEqual([
      'mcp-assigned',
    ])
    expect(JSON.stringify(preset.plugins[0]!.config)).toContain('Check every fact.')
  })
  it.each(['experts', 'teams', 'skills', 'connectors'] as const)('rejects malformed imported %s', (kind) => {
    expect(() => validateWorkbench({ ...defaultWorkbench(), [kind]: [{ slug: 'bad key' }] })).toThrow()
  })
  it('rejects duplicate expert/team keys and unresolved team members', () => {
    const data = defaultWorkbench()
    data.teams[0]!.slug = data.experts[0]!.slug
    expect(() => validateWorkbench(data)).toThrow('Duplicate')
    data.teams[0]!.slug = 'team'
    data.teams[0]!.members = ['missing']
    expect(() => validateWorkbench(data)).toThrow('reference')
    expect(() => workbenchPresets(data)).toThrow('missing')
  })
  it('rejects missing skill and connector references', () => {
    const data = defaultWorkbench()
    data.experts[0]!.skills = ['missing']
    expect(() => validateWorkbench(data)).toThrow('reference')
    data.experts[0]!.skills = []
    data.experts[0]!.connectors = ['missing']
    expect(() => validateWorkbench(data)).toThrow('reference')
  })
  it('rejects non-HTTP endpoints and missing local commands', () => {
    const data = defaultWorkbench()
    data.connectors = [
      {
        slug: 'local',
        name: 'Local',
        transport: 'streamable-http',
        url: 'file:///secret',
        command: '',
        args: [],
        enabled: false,
      },
    ]
    expect(() => validateWorkbench(data)).toThrow('HTTP')
    data.connectors[0]!.transport = 'stdio'
    expect(() => validateWorkbench(data)).toThrow('command')
  })
})
