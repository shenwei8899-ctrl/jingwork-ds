/** Knowledge selections preserve source identity and constrain session retrieval configuration. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { apply, parseKnowledgeCatalog } from '../src/mcp-knowledge.ts'
import { defaultWorkbench } from '../src/defaults.ts'
import { workbenchPresets } from '../src/presets.ts'
import { validateWorkbench } from '../src/validation.ts'

it('validates structured and text knowledge catalogs and rejects upstream errors', () => {
  const knowledge_bases = [{ kb_id: 'products', name: 'Products', description: 'Product documents' }]
  const expected = [{ id: 'products', name: 'Products', description: 'Product documents' }]
  expect(parseKnowledgeCatalog({ structuredContent: { databases: knowledge_bases, total: 1 } })).toEqual(expected)
  expect(parseKnowledgeCatalog({ structuredContent: { knowledge_bases } })).toEqual(expected)
  expect(parseKnowledgeCatalog({ content: [{ type: 'text', text: JSON.stringify({ data: { knowledge_bases } }) }] })).toEqual(expected)
  expect(() => parseKnowledgeCatalog({ isError: true, content: [{ type: 'text', text: 'Upstream 401' }] })).toThrow()
  expect(() => parseKnowledgeCatalog({ structuredContent: { knowledge_bases: [{ name: 'Missing id' }] } })).toThrow()
})

it('persists selected custom bases and composes only their scoped retrieval assignment', () => {
  const data = defaultWorkbench()
  data.connectors = [{ slug: 'know', name: 'Know', enabled: true, transport: 'streamable-http', url: 'https://mcp.example/mcp', command: '', args: [] }]
  data.experts[0]!.customKnowledgeBases = [{ connector: 'know', id: 'products', name: 'Products' }]
  const saved = validateWorkbench(JSON.parse(JSON.stringify(data)))
  expect(saved.experts[0]!.customKnowledgeBases).toEqual(data.experts[0]!.customKnowledgeBases)
  const preset = workbenchPresets(saved)[0]!
  expect(preset.plugins.find(plugin => plugin.id === 'knowledge-know')?.config).toEqual({
    serverName: 'know', url: 'https://mcp.example/mcp', timeoutMs: 15000, maxBytes: 262144, bases: [{ id: 'products', name: 'Products' }],
  })
  expect(preset.plugins.some(plugin => plugin.id === 'mcp-know')).toBe(false)
  data.connectors[0]!.enabled = false
  expect(() => validateWorkbench(data)).toThrow('enabled HTTP connector')
})

it('registers an allowlisted search tool and rejects an unassigned base before contacting MCP', async () => {
  const ctx = new Context()
  const register = vi.fn<Context['tools']['register']>()
  ctx.provide('tools', { register } as never)
  try {
    apply(ctx, { serverName: 'know', url: 'https://mcp.example/mcp', timeoutMs: 1000, maxBytes: 262144, bases: [{ id: 'products', name: 'Products' }] })
    const definition = register.mock.calls[0]?.[0]
    if (!definition?.execute) throw new Error('Missing knowledge search tool')
    expect(definition.name).toBe('knowledge_know_search')
    expect(definition.parameters).toMatchObject({ properties: { kb_id: { enum: ['products'] } } })
    await expect(definition.execute({ kb_id: 'forbidden', query: 'question' }, { signal: new AbortController().signal } as never)).rejects.toThrow('kb_id')
  } finally {
    await ctx.fiber.dispose()
  }
})
