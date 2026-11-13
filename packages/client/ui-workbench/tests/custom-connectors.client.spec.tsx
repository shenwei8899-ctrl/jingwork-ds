// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Connectors } from '../src/client/Connectors.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

it('tests draft authentication, clears stale feedback and saves secrets separately', async () => {
  const dictionary: Record<string, string> = zh
  const save = vi.fn().mockResolvedValue(null)
  const saveCredentials = vi.fn().mockResolvedValue(null)
  const testConnection = vi.fn().mockResolvedValue('connectorTestConnected')
  render(<Connectors listTools={vi.fn().mockResolvedValue({ status: 'connected', tools: [] })} t={key => dictionary[key] ?? key} data={[]} query="" writable revision={1}
    save={save} saveCredentials={saveCredentials} testConnection={testConnection}
    editCustom={vi.fn()} notify={vi.fn()} remove={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorConfigure }))
  expect(screen.getByLabelText<HTMLInputElement>(zh.connectorAddress).value).toBe('https://aim.hnjing.com/know/mcp')
  fireEvent.change(screen.getByLabelText(zh.connectorName), { target: { value: 'Test connector' } })
  fireEvent.change(screen.getByLabelText(zh.connectorAddress), { target: { value: 'https://mcp.example/mcp' } })
  fireEvent.change(screen.getByLabelText(zh.connectorAuthorization), { target: { value: 'Bearer fixture-key' } })
  fireEvent.change(screen.getByLabelText(zh.connectorLinkerApiKey), { target: { value: 'sk_usr_fixture' } })
  fireEvent.click(screen.getByRole('button', { name: zh.connectorTest }))
  await screen.findByText(zh.connectorTestConnected)
  expect(testConnection).toHaveBeenCalledWith('https://mcp.example/mcp', 'fixture-key', '', 'sk_usr_fixture')
  expect(saveCredentials).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(zh.connectorAddress), { target: { value: 'https://mcp.example/new' } })
  expect(screen.queryByText(zh.connectorTestConnected)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await waitFor(() => expect(save).toHaveBeenCalled())
  expect(saveCredentials).toHaveBeenCalledWith(expect.stringMatching(/^custom-/), { authorization: 'fixture-key', linker_api_key: 'sk_usr_fixture' })
  expect(save.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ name: 'Test connector', url: 'https://mcp.example/new', enabled: true }))
  expect(JSON.stringify(save.mock.calls)).not.toContain('fixture-key')
})

it('reports invalid endpoints and unsuccessful MCP tests', async () => {
  const dictionary: Record<string, string> = zh
  const testConnection = vi.fn().mockResolvedValue('connectorTestFailed')
  render(<Connectors listTools={vi.fn().mockResolvedValue({ status: 'connected', tools: [] })} t={key => dictionary[key] ?? key} data={[]} query="" writable revision={1}
    save={vi.fn()} saveCredentials={vi.fn()} testConnection={testConnection}
    editCustom={vi.fn()} notify={vi.fn()} remove={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorConfigure }))
  fireEvent.click(screen.getByRole('button', { name: zh.connectorTest }))
  expect(screen.getByText(zh.connectorInvalid)).toBeTruthy()
  expect(testConnection).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(zh.connectorName), { target: { value: 'Example' } })
  fireEvent.change(screen.getByLabelText(zh.connectorAddress), { target: { value: 'http://localhost:12345/mcp' } })
  fireEvent.change(screen.getByLabelText(zh.connectorAuthorization), { target: { value: 'fixture-key' } })
  fireEvent.click(screen.getByRole('button', { name: zh.connectorTest }))
  await screen.findByText(zh.connectorTestFailed)
})

it('reuses a saved key when editing and retains the form after a rejected settings save', async () => {
  const dictionary: Record<string, string> = zh
  const save = vi.fn().mockResolvedValue('saveError')
  const saveCredentials = vi.fn().mockResolvedValue(null)
  const testConnection = vi.fn().mockResolvedValue('connectorTestConnected')
  render(<Connectors listTools={vi.fn().mockResolvedValue({ status: 'connected', tools: [] })} t={key => dictionary[key] ?? key} data={[{
    slug: 'existing', name: 'Existing', transport: 'streamable-http', url: 'https://mcp.example/mcp',
    command: '', args: [], enabled: true,
  }]} query="" writable revision={1} save={save} saveCredentials={saveCredentials}
  testConnection={testConnection} editCustom={vi.fn()} notify={vi.fn()} remove={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorEnabled }))
  fireEvent.click(screen.getByRole('button', { name: zh.edit }))
  expect(screen.getByLabelText<HTMLInputElement>(zh.connectorAuthorization).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: zh.connectorTest }))
  await screen.findByText(zh.connectorTestConnected)
  expect(testConnection).toHaveBeenCalledWith('https://mcp.example/mcp', '', 'existing', '')
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  await screen.findByRole('alert')
  expect(saveCredentials).toHaveBeenCalledWith('existing', { authorization: '', linker_api_key: '' })
  expect(screen.getByLabelText<HTMLInputElement>(zh.connectorName).value).toBe('Existing')
})

it('shows the discovered tool count and opens server-owned names and descriptions', async () => {
  const dictionary: Record<string, string> = zh
  const listTools = vi.fn().mockResolvedValue({ status: 'connected', tools: [
    { name: 'know_query_kb', description: '查询知识库' },
    { name: 'know_list_docs', description: '列出文档' },
  ] })
  render(<Connectors listTools={listTools} t={key => dictionary[key] ?? key} data={[{
    slug: 'knowledge', name: '竞网知识库', transport: 'streamable-http', url: 'https://mcp.example/mcp',
    command: '', args: [], enabled: true,
  }]} query="" writable revision={1} save={vi.fn()} saveCredentials={vi.fn()}
  testConnection={vi.fn()} editCustom={vi.fn()} notify={vi.fn()} remove={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorEnabled }))
  fireEvent.click(await screen.findByRole('button', { name: '2 个工具 · 查看列表' }))
  expect(screen.getByText('know_query_kb')).toBeTruthy()
  expect(screen.getByText('查询知识库')).toBeTruthy()
  expect(screen.getByText('know_list_docs')).toBeTruthy()
  expect(screen.getByText('列出文档')).toBeTruthy()
  expect(listTools).toHaveBeenCalledWith('https://mcp.example/mcp', 'knowledge', expect.any(AbortSignal))
})

it('reports a tool catalog failure and retries from the connector card', async () => {
  const dictionary: Record<string, string> = zh
  const listTools = vi.fn().mockResolvedValueOnce({ status: 'failed', tools: [] })
    .mockResolvedValue({ status: 'connected', tools: [] })
  render(<Connectors listTools={listTools} t={key => dictionary[key] ?? key} data={[{
    slug: 'knowledge', name: 'Knowledge', transport: 'streamable-http', url: 'https://mcp.example/mcp',
    command: '', args: [], enabled: true,
  }]} query="" writable revision={1} save={vi.fn()} saveCredentials={vi.fn()}
  testConnection={vi.fn()} editCustom={vi.fn()} notify={vi.fn()} remove={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorEnabled }))
  await screen.findByText(zh.connectorToolsFailed)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorToolsRetry }))
  fireEvent.click(await screen.findByRole('button', { name: '0 个工具 · 查看列表' }))
  expect(screen.getByText(zh.connectorToolsEmpty)).toBeTruthy()
})

it('requires Authorization before testing or saving a new connector', async () => {
  const dictionary: Record<string, string> = zh
  const save = vi.fn()
  const saveCredentials = vi.fn()
  const testConnection = vi.fn()
  render(<Connectors listTools={vi.fn()} t={key => dictionary[key] ?? key} data={[]} query="" writable revision={1}
    save={save} saveCredentials={saveCredentials} testConnection={testConnection}
    editCustom={vi.fn()} notify={vi.fn()} remove={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.connectorConfigure }))
  fireEvent.change(screen.getByLabelText(zh.connectorName), { target: { value: 'Knowledge' } })
  fireEvent.click(screen.getByRole('button', { name: zh.save }))
  expect(screen.getByRole('alert').textContent).toBe(zh.connectorAuthorizationRequired)
  expect(save).not.toHaveBeenCalled()
  expect(saveCredentials).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.connectorTest }))
  expect(testConnection).not.toHaveBeenCalled()
})
