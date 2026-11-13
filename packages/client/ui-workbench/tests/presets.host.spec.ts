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
    expect(parsed.experts[0]!.knowledge).toBe('')
    expect(resolveExpert(legacy)).toMatchObject({ category: 'personal', enabled: true, knowledge: '' })
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
  it('retains literal reference text and rejects invalid or oversized imported material', () => {
    const data = defaultWorkbench()
    const knowledge = '## Product facts\nThe reference code is {{literal}}.'
    data.experts[0]!.knowledge = knowledge
    expect(validateWorkbench(data).experts[0]!.knowledge).toBe(knowledge)
    expect(resolveExpert(data.experts[0]!).knowledge).toBe(knowledge)
    expect(() => validateWorkbench({ ...data, experts: [{ ...data.experts[0], knowledge: {} }] })).toThrow()
    expect(() => validateWorkbench({ ...data, experts: [{ ...data.experts[0], knowledge: 'x'.repeat(65537) }] })).toThrow()
  })
  it('mounts reference material separately for its expert and combines named team references', () => {
    const data = defaultWorkbench()
    const researcher = data.experts.find(expert => expert.slug === 'researcher')!
    const writer = data.experts.find(expert => expert.slug === 'writer')!
    researcher.knowledge = 'Research code {{literal}}.'
    writer.knowledge = '\nBrand terminology.\n'
    const definitions = workbenchPresets(validateWorkbench(data))
    const preset = (id: string) => definitions.find(row => row.id === `workbench-${id}`)!
    expect(preset('writer').plugins.find(row => row.id === 'knowledge')).toMatchObject({
      name: '@deepseek-ai/dsh-knowledge',
      config: { content: writer.knowledge },
    })
    expect(JSON.stringify(preset('writer').plugins.find(row => row.id === 'persona'))).not.toContain('Brand terminology.')
    expect(preset('assistant').plugins.some(row => row.id === 'knowledge')).toBe(false)
    expect(preset('content-team').plugins.find(row => row.id === 'knowledge')?.config).toEqual({
      content: `### ${researcher.name}\n${researcher.knowledge}\n\n### ${writer.name}\n${writer.knowledge}`,
    })
    writer.enabled = false
    expect(workbenchPresets(data).some(row => row.id === 'workbench-content-team')).toBe(false)
    expect(workbenchPresets(data).some(row => row.id === 'workbench-writer')).toBe(false)
  })
  it('omits empty and whitespace-only reference material from a preset', () => {
    const data = defaultWorkbench()
    data.experts[0]!.knowledge = ' \n\t'
    expect(workbenchPresets(validateWorkbench(data))[0]!.plugins.some(row => row.id === 'knowledge')).toBe(false)
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
    expect(preset.plugins.filter(row => row.name === '@deepseek-ai/dsh-client-ui-workbench/custom-connector').map(row => row.id)).toEqual([
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


describe('Jingwork-style assistant preferences', () => {
  it('preserves legacy tool access and applies explicit tool and delegation choices', () => {
    const data = validateWorkbench(defaultWorkbench())
    const legacy = data.experts[0]!
    expect(legacy.tools).toBeUndefined()
    expect(legacy.subagents).toBeUndefined()
    expect(workbenchPresets(data)[0]!.plugins.map(row => row.id)).toContain('tool-fs')
    legacy.tools = ['web']
    legacy.subagents = ['writer']
    let plugins = workbenchPresets(validateWorkbench(data))[0]!.plugins
    expect(plugins.map(row => row.id)).not.toContain('tool-fs')
    expect(plugins.map(row => row.id)).not.toContain('tool-bash')
    expect(plugins.map(row => row.id)).toContain('tool-web')
    expect(plugins.find(row => row.id === 'tool-subagent')?.config).toMatchObject({ allowedAgentPresets: ['workbench-writer'] })
    legacy.subagents = []
    plugins = workbenchPresets(validateWorkbench(data))[0]!.plugins
    expect(plugins.map(row => row.id)).not.toContain('tool-subagent')
  })

  it('round-trips presentation and model preferences through JSON configuration', () => {
    const data = defaultWorkbench()
    Object.assign(data.experts[0]!, {
      avatar: 'data:image/png;base64,aGVsbG8=', color: '#6C757D',
      welcomeMessage: 'Welcome', model: { provider: 'mock', model: 'mock' },
      quickPrompts: [{ id: 'weekly', title: 'Weekly report', description: 'A summary', prompt: 'Help me write a report' }],
    })
    const parsed = validateWorkbench(JSON.parse(JSON.stringify(data)))
    expect(parsed.experts[0]).toMatchObject(data.experts[0]!)
  })

  it.each([
    { avatar: 'https://example.com/avatar.svg' },
    { color: 'red' },
    { model: { provider: 'mock' } },
    { quickPrompts: [{ id: 'a', title: '', description: '', prompt: 'hello' }] },
    { quickPrompts: [{ id: 'a', title: 'Hi', description: '', prompt: '' }] },
    { tools: ['unknown'] },
    { tools: ['web', 'web'] },
    { subagents: ['missing'] },
    { subagents: ['assistant'] },
  ])('rejects invalid assistant preferences %j', (patch) => {
    const data = defaultWorkbench()
    Object.assign(data.experts[0]!, patch)
    expect(() => validateWorkbench(data)).toThrow()
  })
})

it('preserves selected backend knowledge identifiers through validation and team composition', () => {
  const data = defaultWorkbench()
  data.experts[0]!.knowledgeBases = ['product']
  const parsed = validateWorkbench(data)
  expect(parsed.experts[0]!.knowledgeBases).toEqual(['product'])
  const definitions = workbenchPresets(parsed, { timeoutMs: 5000, maxBytes: 4096 })
  expect(definitions[0]!.plugins.find(plugin => plugin.id === 'knowledge')?.config).toMatchObject({
    retrieval: { bases: ['product'], timeoutMs: 5000, maxBytes: 4096 },
  })
  expect(() => validateWorkbench({ ...data, experts: [{ ...data.experts[0], knowledgeBases: [''] }] })).toThrow()
})
