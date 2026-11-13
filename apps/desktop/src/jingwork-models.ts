/** Private OpenAI-compatible model relay authenticated by the native enterprise account. */
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import type { JingworkDesktopAuth } from './jingwork-auth.ts'

/** Bind a model-only relay to the current desktop process.
 * @param auth Native owner of the IAM-bound device credential.
 * @returns Private connection settings and shutdown ownership.
 */
export async function startJingworkModels(auth: JingworkDesktopAuth): Promise<{
  baseURL: string
  token: string
  dispose: () => Promise<void>
}> {
  const token = randomBytes(32).toString('hex')
  const lifetime = new AbortController()
  const pending = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const provided = Buffer.from(request.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      response.writeHead(401).end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end()
      return
    }
    const cancel = new AbortController()
    response.once('close', () => { cancel.abort() })
    const signal = AbortSignal.any([lifetime.signal, cancel.signal])
    const task = (async () => {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > 32 * 1024 * 1024) {
          response.writeHead(413).end()
          return
        }
        chunks.push(buffer)
      }
      const upstream = await auth.completeModel(Buffer.concat(chunks).toString('utf8'), signal)
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      })
      if (upstream.body !== null) {
        const reader = upstream.body.getReader()
        try {
          while (true) {
            const next = await reader.read()
            if (next.done) break
            if (!response.write(next.value)) await once(response, 'drain', { signal })
          }
        } finally {
          try { await reader.cancel() } catch (error) {
            // The upstream may already be closed after request cancellation.
            void error
          }
          reader.releaseLock()
        }
      }
      response.end()
    })().catch(() => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      response.writeHead(502, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Enterprise model request failed. Check sign-in and model access.' } }))
    }).finally(() => { pending.delete(task) })
    pending.add(task)
  })
  server.requestTimeout = 300000
  server.headersTimeout = 15000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Enterprise model relay did not bind')
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`, token,
    dispose: async () => {
      lifetime.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      await Promise.allSettled(pending)
    },
  }
}
