import assert from 'node:assert/strict'
import test from 'node:test'
import { groupAgentConfigItems, createAgentConfigDraft } from '../../src/utils/agentEditorConfig.js'

test('enterprise sections cover all fields once and keep both Skill fields together', () => {
  const items = {
    prompt: { kind: 'prompt' },
    model: { kind: 'llm' },
    tools: { kind: 'tools' },
    kb: { kind: 'knowledges' },
    skills: { kind: 'skills' },
    preload: { kind: 'skills' },
    mcp: { kind: 'mcps' },
    children: { kind: 'subagents' },
    threshold: { type: 'int' },
    future: { kind: 'new-backend-setting' }
  }
  const groups = groupAgentConfigItems(items)
  const { tools, ...enterpriseGroups } = groups
  assert.deepEqual(groups.skills, ['skills', 'preload'])
  assert.deepEqual(groups.builtinTools, ['tools'])
  assert.deepEqual(tools, ['tools', 'kb', 'skills', 'preload', 'mcp', 'children'])
  assert.deepEqual(Object.values(enterpriseGroups).flat().sort(), Object.keys(items).sort())
  assert.deepEqual(groups.other, ['threshold', 'future'])
})

test('draft preserves all-resource null, empty selections and hidden ids; normalizes saved numbers', () => {
  const items = {
    skills: { supports_all: true, default: null },
    preload: { supports_all: true, default: [] },
    limit: { type: 'int', default: 300 },
    prompt: { default: 'default prompt' }
  }
  const saved = { skills: null, preload: [], limit: '27.9', prompt: null, legacy: ['hidden-id'] }
  const draft = createAgentConfigDraft(items, saved)
  assert.deepEqual(draft, {
    skills: null,
    preload: [],
    limit: 27,
    prompt: 'default prompt',
    legacy: ['hidden-id']
  })
  draft.legacy.push('new-id')
  assert.deepEqual(saved.legacy, ['hidden-id'])
  const first = createAgentConfigDraft(items)
  first.preload.push('test')
  assert.deepEqual(createAgentConfigDraft(items).preload, [])
})

test('refreshing MCP options preserves fixed selections and does not select newly enabled servers', () => {
  const schema = {
    mcps: { kind: 'mcps', type: 'list', default: [], options: [{ value: 'deepwiki' }, { value: 'new-server' }] }
  }
  const draft = createAgentConfigDraft(schema, { mcps: ['deepwiki'] })
  assert.deepEqual(groupAgentConfigItems(schema).mcp, ['mcps'])
  assert.deepEqual(draft.mcps, ['deepwiki'])
  assert.deepEqual(createAgentConfigDraft(schema).mcps, [])
})

test('editing an imported expert clones reactive defaults and nested selections without modifying the source', async () => {
  const { reactive } = await import('vue')
  const items = reactive({
    tools: { kind: 'tools', default: ['search'] },
    settings: { default: { nested: ['original'] } },
    skills: { kind: 'skills', supports_all: true, default: [] }
  })
  const saved = reactive({ skills: ['coding'], legacy: reactive({ selected: ['keep'] }) })
  const draft = createAgentConfigDraft(items, saved)
  assert.deepEqual(draft, {
    tools: ['search'], settings: { nested: ['original'] }, skills: ['coding'], legacy: { selected: ['keep'] }
  })
  draft.tools.push('new')
  draft.settings.nested.push('new')
  draft.legacy.selected.push('new')
  assert.deepEqual(items.tools.default, ['search'])
  assert.deepEqual(items.settings.default.nested, ['original'])
  assert.deepEqual(saved.legacy.selected, ['keep'])
})
