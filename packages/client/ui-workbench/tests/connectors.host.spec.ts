/** Native connector requests preserve vendor parameters and contain credential failures. */
import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { callConnectorGateway } from '../src/connector-gateway.ts'
import { builtinConnector, CONNECTOR_CATALOG, connectorCredentialRef } from '../src/connector-catalog.ts'
import { CONNECTOR_TOOL_SCHEMAS } from '../src/connector-tool-schemas.ts'
import { defaultWorkbench } from '../src/defaults.ts'
import { validateWorkbench } from '../src/validation.ts'
import { workbenchPresets } from '../src/presets.ts'

function requestBody(request: RequestInit): unknown {
  return JSON.parse(z.string().parse(request.body))
}

const policy = { timeoutMs: 1000, maxResponseBytes: 4096 }
const signal = new AbortController().signal
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Jingwork built-in connectors', () => {
  it('covers the nine pictured connectors with localized metadata and collision-free credential references', () => {
    expect(CONNECTOR_CATALOG).toHaveLength(9)
    for (const entry of CONNECTOR_CATALOG) {
      expect(new URL(entry.authorizationUrl).protocol).toBe('https:')
    }
    expect(connectorCredentialRef('docs-a')).not.toBe(connectorCredentialRef('docs_a'))
    expect(connectorCredentialRef('docs-a')).toMatch(/^[A-Z_][A-Z0-9_]*$/)
    expect(builtinConnector('invented')).toBeUndefined()
  })
  it('retains old custom configurations and emits secret-free built-in presets', () => {
    const data = defaultWorkbench()
    data.connectors.push({
      slug: 'news',
      name: 'News',
      builtin: 'tencent-news',
      transport: 'streamable-http',
      url: '',
      command: '',
      args: [],
      enabled: true,
    })
    data.experts[0]!.connectors.push('news')
    const preset = workbenchPresets(validateWorkbench(data))[0]!
    expect(preset.plugins).toContainEqual({
      id: 'mcp-news',
      name: '@deepseek-ai/dsh-client-ui-workbench/connector',
      config: { kind: 'tencent-news', serverName: 'news' },
    })
    data.connectors[0]!.builtin = 'invented'
    expect(() => validateWorkbench(data)).toThrow('Unknown built-in connector')
    delete data.connectors[0]!.builtin
    data.connectors[0]!.url = 'https://example.com/mcp'
    expect(validateWorkbench(data).connectors[0]!.builtin).toBeUndefined()
  })
  it('sends the official Tencent News query and request identifiers', async () => {
    const send = vi
      .fn<(url: string, request: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{"base_rsp":{"code":0},"articles":[]}'))
    vi.stubGlobal('fetch', send)
    await callConnectorGateway(
      'tencent-news',
      { api_key: 'private-key' },
      'search_news',
      { query: 'weather', limit: 100 },
      signal,
      policy,
    )
    const [url, request] = send.mock.calls[0]!
    expect(url).toBe('https://openapi.inews.qq.com/api/v1/agent/search')
    const body = z
      .object({ query: z.object({ search: z.string(), query_id: z.string() }), page_size: z.number() })
      .parse(requestBody(request))
    expect(body.query.search).toBe('weather')
    expect(body.page_size).toBe(50)
    expect(new Headers(request.headers).get('Skill-Request-Id')).toBe(body.query.query_id)
  })
  it.each([
    ['list_notebooks', {}, 'note/v1/list_notebook', { cursor: '0', limit: 20 }],
    ['get_note', { note_id: 'one' }, 'note/v1/get_doc_content', { note_id: 'one', target_content_format: 0 }],
    [
      'search_notes',
      { query: 'hello', search_type: 1 },
      'note/v1/search_note',
      { search_type: 1, query_info: { content: 'hello' }, start: 0, end: 20 },
    ],
    [
      'import_urls',
      { knowledge_base_id: 'kb', urls: ['https://example.com'] },
      'wiki/v1/import_urls',
      { knowledge_base_id: 'kb', folder_id: 'kb', urls: ['https://example.com'] },
    ],
  ])('maps IMA %s to its official request', async (name, args, path, body) => {
    const send = vi
      .fn<(url: string, request: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{"code":0}'))
    vi.stubGlobal('fetch', send)
    await callConnectorGateway(
      'tencent-ima',
      { api_key: 'key', client_id: 'client' },
      name,
      args,
      signal,
      policy,
    )
    expect(send.mock.calls[0]![0]).toBe(`https://ima.qq.com/openapi/${path}`)
    expect(requestBody(send.mock.calls[0]![1])).toEqual(body)
  })
  it('exposes every migrated IMA operation and bounds list requests', async () => {
    const schemas = CONNECTOR_TOOL_SCHEMAS['tencent-ima']!
    expect(schemas.some(schema => schema.name === 'append_note')).toBe(true)
    const send = vi
      .fn<(url: string, request: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{"code":0}'))
    vi.stubGlobal('fetch', send)
    await callConnectorGateway(
      'tencent-ima',
      { api_key: 'key', client_id: 'client' },
      'list_knowledge',
      { knowledge_base_id: 'kb', limit: 100 },
      signal,
      policy,
    )
    expect(z.object({ limit: z.number() }).parse(requestBody(send.mock.calls[0]![1])).limit).toBe(50)
  })
  it('rejects malformed credentials before contacting vendors', async () => {
    const send = vi.fn<(url: string, request: RequestInit) => Promise<Response>>()
    vi.stubGlobal('fetch', send)
    await expect(
      callConnectorGateway('wechat-reading', { api_key: 'wrong' }, 'list_bookshelf', {}, signal, policy),
    ).rejects.toMatchObject({ code: 'credentials' })
    expect(send).not.toHaveBeenCalled()
  })
  it.each(['invalid-json', '{"errcode":401,"errmsg":"private-key"}', '{"ret":1}', '{"base_rsp":{"code":4006}}'])(
    'rejects vendor failures without echoing the response',
    async (payload) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(payload)))
      await expect(
        callConnectorGateway('qq-music', { api_key: 'qmk-private-key' }, 'list_charts', {}, signal, policy),
      ).rejects.toMatchObject({ code: 'response' })
    },
  )
  it('rejects oversized responses and failed HTTP status without echoing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(5000))))
    await expect(
      callConnectorGateway(
        'wechat-reading',
        { api_key: 'wrk-private' },
        'list_bookshelf',
        {},
        signal,
        policy,
      ),
    ).rejects.toMatchObject({ code: 'response' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private', { status: 401 })))
    await expect(
      callConnectorGateway(
        'wechat-reading',
        { api_key: 'wrk-private' },
        'list_bookshelf',
        {},
        signal,
        policy,
      ),
    ).rejects.toMatchObject({ code: 'http', status: 401 })
  })
})
