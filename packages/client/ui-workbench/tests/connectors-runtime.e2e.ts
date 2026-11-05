/** Built-artifact smoke through a real cordis.yml and the native tool executor. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { connectorCredentialRef } from '../src/connector-catalog.ts'

const artifact = (path: string) => fileURLToPath(new URL(path, import.meta.url))
afterEach(() => {
  vi.unstubAllGlobals()
})

it('loads bundled news tools, rotates local credentials, and removes tools on unload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-connectors-'))
  const key = connectorCredentialRef('news')
  await writeFile(
    join(root, 'credentials.yml'),
    `version: 1\nrefs:\n  ${key}: '{"api_key":"fixture-one"}'\n`,
    { mode: 0o600 },
  )
  const plugins = [
    {
      id: 'credentials',
      name: artifact('../../../credentials/credentials-local/lib/index.js'),
      config: { path: join(root, 'credentials.yml'), watch: false },
    },
    { id: 'prompt', name: artifact('../../../core/system-prompt/lib/index.js'), config: {} },
    { id: 'tools', name: artifact('../../../core/tools/lib/index.js'), config: {} },
    { id: 'executor', name: artifact('../../../core/tool-executor-native/lib/index.js'), config: {} },
    {
      id: 'news',
      name: '@deepseek-ai/dsh-client-ui-workbench/connector',
      config: { kind: 'tencent-news', serverName: 'news' },
    },
  ]
  // JSON is a YAML subset. Every configured plugin is loaded by the normal Loader.
  await writeFile(join(root, 'cordis.yml'), JSON.stringify(plugins))
  let ctx: Awaited<ReturnType<typeof boot>> | undefined
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, request: RequestInit) => {
      requests.push(new Headers(request.headers).get('Authorization') ?? '')
      return new Response('{"base_rsp":{"code":0},"articles":[{"title":"Connector fixture"}]}')
    }),
  )
  try {
    ctx = await boot('dsh-connectors-test', join(root, 'cordis.yml'), undefined, undefined, new URL('../lib/index.js', import.meta.url).href)
    expect(ctx.tools.schemas().map(tool => tool.name)).toContain('mcp__news__search_news')
    const execute = () =>
      ctx!.tools.execute({
        calls: [
          {
            type: 'tool-call',
            id: ToolCallId('news-fixture'),
            name: 'mcp__news__search_news',
            arguments: '{"query":"fixture"}',
          },
        ],
        signal: new AbortController().signal,
      })
    const first = await execute()
    expect(JSON.stringify(first)).toContain('Connector fixture')
    await ctx.credentials.set(credentialRef(key), '{"api_key":"fixture-two"}')
    expect(JSON.stringify(await execute())).toContain('Connector fixture')
    expect(requests).toEqual(['Bearer fixture-one', 'Bearer fixture-two'])
    await ctx.credentials.set(credentialRef(key), '{}')
    expect(JSON.stringify(await execute())).toContain('credentials')
    expect(requests).toHaveLength(2)
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'news')
    expect(entry).toBeDefined()
    await entry!.fiber!.dispose()
    expect(ctx.tools.schemas().map(tool => tool.name)).not.toContain('mcp__news__search_news')
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
