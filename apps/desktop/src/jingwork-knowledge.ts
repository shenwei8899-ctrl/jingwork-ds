/** Private loopback retrieval relay. Backend credentials remain in the desktop credential owner. */
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { JingworkDesktopAuth } from './jingwork-auth.ts'

/** Start a retrieval-only relay for the child Host.
 * @param auth Current desktop identity, checked on every backend request.
 * @param timeoutMs Deployment request timeout.
 * @returns Private child environment and a disposer that closes active connections.
 */
export async function startJingworkKnowledge(auth: JingworkDesktopAuth, timeoutMs: number): Promise<{
  environment: Record<string, string>
  dispose: () => Promise<void>
}> {
  const token = randomBytes(32).toString('hex')
  const abort = new AbortController()
  const pending = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401).end()
      return
    }
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://localhost') } catch (_error) {
      response.writeHead(400).end()
      return
    }
    const id = url.searchParams.get('id')
    const query = url.searchParams.get('query')
    if (request.method !== 'GET' || url.pathname !== '/retrieve' || !id || !query || id.length > 256 || query.length > 8192) {
      response.writeHead(400).end()
      return
    }
    const task = auth.retrieveKnowledge(id, query, abort.signal).then((value) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(value))
    }).catch((_error: unknown) => {
      response.writeHead(502, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'Knowledge retrieval failed. Check account permissions and retry.' }))
    }).finally(() => { pending.delete(task) })
    pending.add(task)
  })
  server.maxHeadersCount = 16
  server.requestTimeout = timeoutMs
  server.headersTimeout = timeoutMs
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Knowledge relay did not bind a loopback port')
  }
  return {
    environment: { DSH_KNOWLEDGE_URL: `http://127.0.0.1:${address.port}`, DSH_KNOWLEDGE_TOKEN: token },
    dispose: async () => {
      abort.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      await Promise.allSettled(pending)
    },
  }
}
