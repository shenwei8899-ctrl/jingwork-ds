// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CustomKnowledge } from '../src/client/CustomKnowledge.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const connector = { slug: 'know', name: 'MCP knowledge', enabled: true, transport: 'streamable-http' as const, url: 'https://mcp.example/mcp', command: '', args: [] }
const dictionary: Record<string, string> = zh

it('shows service-owned knowledge bases under the custom divider and selects the connector-qualified id', async () => {
  const list = vi.fn().mockResolvedValue({
    status: 'ready', bases: [{ id: 'products', name: 'Product knowledge', description: 'Product documents' }],
  })
  const onChange = vi.fn()
  render(<CustomKnowledge
    t={key => dictionary[key] ?? key}
    connectors={[connector]}
    selected={[]}
    revision={1}
    list={list}
    onChange={onChange}
  />)
  expect(screen.getByRole('heading', { name: zh.customKnowledge })).toBeTruthy()
  fireEvent.click(await screen.findByRole('checkbox'))
  expect(onChange).toHaveBeenCalledWith([{ connector: 'know', id: 'products', name: 'Product knowledge' }])
})

it('keeps saved selections removable and distinguishes an upstream tool failure', async () => {
  const list = vi.fn().mockResolvedValue({ status: 'upstream-error', bases: [] })
  const onChange = vi.fn()
  render(<CustomKnowledge t={key => dictionary[key] ?? key} connectors={[connector]} selected={[{ connector: 'know', id: 'products', name: 'Product knowledge' }]} revision={1} list={list} onChange={onChange} />)
  expect((await screen.findByRole('alert')).textContent).toContain(zh.customKnowledgeUpstreamFailed)
  expect(screen.getByText('Product knowledge')).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(onChange).toHaveBeenCalledWith([])
})
