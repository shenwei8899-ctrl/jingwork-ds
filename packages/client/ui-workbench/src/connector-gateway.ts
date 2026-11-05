/** Native HTTP adapters for the Jingwork news, reading, music and IMA tools. */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** One credential set read only on the Host. */
export type ConnectorCredentials = Record<string, string>
/** Deployment limits shared by adapter requests. */
export interface ConnectorRequestPolicy {
  /** Maximum duration of a vendor request. */
  timeoutMs: number
  /** Maximum bytes accepted from a vendor response. */
  maxResponseBytes: number
}
/** A vendor failure with no echoed credential or response body. */
export class ConnectorRequestError extends Error {
  /** @param code Stable failure classification. @param status HTTP status when available. */
  constructor(
    readonly code: 'credentials' | 'http' | 'response' | 'network',
    readonly status?: number,
  ) {
    super(
      `Connector request failed (${code}${status === undefined ? '' : `, HTTP ${status}`}). Check the connection before retrying. A submitted change may have completed.`,
    )
  }
}
const string = (args: Record<string, unknown>, key: string, fallback = ''): string =>
  z.string().parse(args[key] ?? fallback)
const integer = (args: Record<string, unknown>, key: string, fallback: number): number =>
  z
    .number()
    .int()
    .parse(args[key] ?? fallback)
const limit = (args: Record<string, unknown>, max = 20): number =>
  Math.max(1, Math.min(max, integer(args, 'limit', 20)))
const required = (creds: ConnectorCredentials, key: string): string => {
  const value = creds[key]?.trim()
  if (!value) throw new ConnectorRequestError('credentials')
  return value
}

/** Call one official vendor API without automatic retries of mutations.
 * @param kind Bundled gateway identity.
 * @param creds Host-only credentials.
 * @param name Vendor tool name.
 * @param args Validated tool arguments.
 * @param signal Tool cancellation.
 * @param policy Deployment request limits.
 * @returns Vendor JSON encoded for the tool transcript.
 */
export async function callConnectorGateway(
  kind: string,
  creds: ConnectorCredentials,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
  policy: ConnectorRequestPolicy,
): Promise<string> {
  let url: string
  let body: Record<string, unknown>
  let headers: Record<string, string>
  switch (kind) {
    case 'tencent-news': {
      if (name !== 'search_news') throw new ConnectorRequestError('response')
      const requestId = randomUUID()
      url = 'https://openapi.inews.qq.com/api/v1/agent/search'
      headers = {
        Authorization: `Bearer ${required(creds, 'api_key')}`,
        'Caller-Skill': 'octop_tencent-news_0.1',
        'Skill-Request-Id': requestId,
      }
      body = {
        page: 1,
        page_size: Math.max(1, Math.min(50, integer(args, 'limit', integer(args, 'max_results', 10)))),
        is_show_content: 0,
        query: { query_id: requestId, search: string(args, 'query') },
        article_types: [0],
      }
      break
    }
    case 'wechat-reading': {
      const key = required(creds, 'api_key')
      if (!key.startsWith('wrk-')) throw new ConnectorRequestError('credentials')
      url = 'https://i.weread.qq.com/api/agent/gateway'
      headers = { Authorization: `Bearer ${key}` }
      if (name === 'list_bookshelf') body = { api_name: '/shelf/sync', skill_version: '1.0.3' }
      else if (name === 'get_book_notes')
        body = { api_name: '/book/bookmarklist', skill_version: '1.0.3', bookId: string(args, 'book_id') }
      else throw new ConnectorRequestError('response')
      break
    }
    case 'qq-music': {
      const key = required(creds, 'api_key')
      if (!key.startsWith('qmk-')) throw new ConnectorRequestError('credentials')
      headers = { Authorization: `Bearer ${key}` }
      let path: string
      let params: Record<string, unknown>
      switch (name) {
        case 'search_music':
          path = '/discover/search'
          params = { keyword: string(args, 'keyword'), type: string(args, 'type', '0') }
          break
        case 'list_charts':
          path = '/charts'
          params = {}
          break
        case 'get_chart_detail':
          path = '/charts/detail'
          params = { topId: integer(args, 'top_id', 0) }
          break
        case 'get_playlist_detail':
          path = '/playlists/detail'
          params = { dissId: integer(args, 'diss_id', 0) }
          break
        case 'listening_report':
          path = '/me/report'
          params = args.type === undefined ? {} : { type: string(args, 'type') }
          break
        default:
          throw new ConnectorRequestError('response')
      }
      url = `https://a.y.qq.com${path}`
      body = { params, comm: { skill_version: '0.0.3' } }
      break
    }
    case 'tencent-ima': {
      headers = {
        'ima-openapi-clientid': required(creds, 'client_id'),
        'ima-openapi-apikey': required(creds, 'api_key'),
      }
      const request = imaRequest(name, args)
      url = `https://ima.qq.com/openapi/${request.path}`
      body = request.body
      break
    }
    default:
      throw new ConnectorRequestError('response')
  }
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(policy.timeoutMs)])
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'User-Agent': 'octop-connector/0.1' },
      body: JSON.stringify(body),
      signal: requestSignal,
      redirect: 'error',
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ConnectorRequestError('http', response.status)
    }
    if (!response.body) throw new ConnectorRequestError('response')
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > policy.maxResponseBytes) throw new ConnectorRequestError('response')
      chunks.push(chunk)
    }
    let payload: unknown
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (_error: unknown) {
      throw new ConnectorRequestError('response')
    }
    const record = z.record(z.string(), z.unknown()).safeParse(payload)
    if (record.success) {
      const value = record.data
      const base = z.record(z.string(), z.unknown()).safeParse(value.base_rsp)
      const code = base.success ? base.data.code : (value.errcode ?? value.errCode ?? value.code ?? value.ret)
      if (code !== undefined && code !== null && code !== 0 && code !== '0')
        throw new ConnectorRequestError('response')
    }
    return JSON.stringify(payload)
  } catch (error: unknown) {
    if (requestSignal.aborted) throw requestSignal.reason
    if (error instanceof ConnectorRequestError) throw error
    throw new ConnectorRequestError('network')
  }
}

function imaRequest(
  name: string,
  args: Record<string, unknown>,
): { path: string; body: Record<string, unknown> } {
  const optionalFolder = args.folder_id ? { folder_id: string(args, 'folder_id') } : {}
  const pagination = { cursor: string(args, 'cursor'), limit: limit(args) }
  const knowledgeBase = () => string(args, 'knowledge_base_id')
  switch (name) {
    case 'list_notebooks':
      return {
        path: 'note/v1/list_notebook',
        body: { cursor: string(args, 'cursor', '0'), limit: limit(args) },
      }
    case 'list_notes':
      return { path: 'note/v1/list_note', body: { ...pagination, ...optionalFolder } }
    case 'get_note':
      return {
        path: 'note/v1/get_doc_content',
        body: { note_id: string(args, 'note_id'), target_content_format: 0 },
      }
    case 'search_notes': {
      const type = z.union([z.literal(0), z.literal(1)]).parse(args.search_type ?? 0)
      return {
        path: 'note/v1/search_note',
        body: {
          search_type: type,
          query_info: { [type === 1 ? 'content' : 'title']: string(args, 'query') },
          start: integer(args, 'start', 0),
          end: integer(args, 'end', 20),
        },
      }
    }
    case 'create_note':
      return {
        path: 'note/v1/import_doc',
        body: { content_format: 1, content: string(args, 'content'), ...optionalFolder },
      }
    case 'append_note':
      return {
        path: 'note/v1/append_doc',
        body: { note_id: string(args, 'note_id'), content_format: 1, content: string(args, 'content') },
      }
    case 'list_knowledge_bases':
      return { path: 'wiki/v1/search_knowledge_base', body: { query: string(args, 'query'), ...pagination } }
    case 'list_addable_knowledge_bases':
      return {
        path: 'wiki/v1/get_addable_knowledge_base_list',
        body: { ...pagination, limit: limit(args, 50) },
      }
    case 'get_knowledge_base':
      return {
        path: 'wiki/v1/get_knowledge_base',
        body: { ids: z.array(z.string().trim().min(1)).min(1).max(20).parse(args.ids) },
      }
    case 'list_knowledge':
      return {
        path: 'wiki/v1/get_knowledge_list',
        body: {
          knowledge_base_id: knowledgeBase(),
          ...pagination,
          limit: limit(args, 50),
          ...optionalFolder,
        },
      }
    case 'search_knowledge':
      return {
        path: 'wiki/v1/search_knowledge',
        body: {
          query: string(args, 'query'),
          knowledge_base_id: knowledgeBase(),
          cursor: string(args, 'cursor'),
        },
      }
    case 'import_urls':
      return {
        path: 'wiki/v1/import_urls',
        body: {
          knowledge_base_id: knowledgeBase(),
          folder_id: string(args, 'folder_id', knowledgeBase()),
          urls: z
            .array(z.url({ protocol: /^https?$/ }))
            .min(1)
            .max(10)
            .parse(args.urls),
        },
      }
    case 'add_note_to_knowledge':
      return {
        path: 'wiki/v1/add_knowledge',
        body: {
          media_type: 11,
          title: string(args, 'title'),
          knowledge_base_id: knowledgeBase(),
          note_info: { content_id: string(args, 'note_id') },
          ...optionalFolder,
        },
      }
    case 'get_media':
      return { path: 'wiki/v1/get_media_info', body: { media_id: string(args, 'media_id') } }
    default:
      throw new ConnectorRequestError('response')
  }
}
