/** Both SDKs preserve the chat task's durable identity as a raw Session event. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createProcessDeepSeekHarness } from '../src/api.ts'

function isTaskEvent(value: unknown): value is { type: 'super-agent/start' } {
  return value !== null && typeof value === 'object' && 'type' in value && value.type === 'super-agent/start'
}

it('preserves Super Agent task events and notifications alongside the final response', async () => {
  const expected = JSON.parse(await readFile(new URL('./expected/super-agent-projection.json', import.meta.url), 'utf8')) as {
    finalResponse: string
    auditEvents: Record<string, unknown>[]
  }
  const harness = createProcessDeepSeekHarness({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))],
    environment: () => ({ ...process.env, FAKE_TEXT: expected.finalResponse, FAKE_SESSION_EVENTS: JSON.stringify(expected.auditEvents) }),
    description: 'scripted SDK task projection', initializeTimeoutMs: 5000,
  })
  try {
    const result = await harness.run([{ type: 'text', text: 'Review the document' }])
    const projection = {
      finalResponse: result.finalResponse,
      auditEvents: result.events.filter(event => event.type === 'super-agent/start'),
      auditNotifications: result.notifications.flatMap(notification => notification.method === 'session.event'
        && isTaskEvent(notification.params.event)
        ? [{ method: notification.method, event: notification.params.event }]
        : []),
      assistantTexts: result.events.filter(event => event.type === 'assistant/message')
        .flatMap(event => event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])),
    }
    expect(projection).toEqual(JSON.parse(await readFile(new URL('./expected/super-agent-projection.json', import.meta.url), 'utf8')))
  } finally {
    await harness.close()
  }
})
