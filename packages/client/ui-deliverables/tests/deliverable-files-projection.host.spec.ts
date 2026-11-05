/** Whole-Session file attribution from successful mutations and explicit deliveries. */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { deliverableFilesProjectionDefinition } from '../src/projection.ts'
import type {} from '../src/types.ts'

describe('deliverable file projection', () => {
  let ctx: Context
  let session: Session

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.sessionProjections.register(deliverableFilesProjectionDefinition)
    session = ctx.sessions.create(SessionId('deliverable-files'))
  })

  function result(callId: string, isError: boolean, meta?: { path: string }): void {
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: ToolCallId(callId),
        content: [{ type: 'text', text: isError ? 'failed' : 'written' }],
        isError,
      }),
      ...(meta === undefined ? {} : { meta }),
      ...(isError ? { error: { name: 'Error', code: 'TEST' } } : {}),
    }, { surfaceOp: 'append' })
  }

  it('keeps successful mutation targets and explicit deliveries once in first-seen order', () => {
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('write'), name: 'write',
      arguments: JSON.stringify({ file_path: 'draft.md', content: 'draft' }),
    })
    result('write', false, { path: '/workspace/report.md' })
    session.append('deliverables/presented', {
      turn: 1,
      callId: ToolCallId('present'),
      files: [{ path: '/workspace/report.md' }, { path: '/workspace/chart.png', description: 'Chart' }],
    })

    expect(ctx.sessionProjections.snapshot(session).values.deliverableFiles).toEqual([
      '/workspace/report.md',
      '/workspace/chart.png',
    ])
    expect(ctx.sessionProjections.checkpoint(session).deliverableFiles?.val).toEqual({
      paths: ['/workspace/report.md', '/workspace/chart.png'],
      calls: {},
    })
  })

  it('ignores failed, unsupported and malformed mutation calls', () => {
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('failed'), name: 'write',
      arguments: JSON.stringify({ file_path: 'failed.md', content: 'draft' }),
    })
    result('failed', true)
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('read'), name: 'read', arguments: '{"file_path":"source.md"}',
    })
    result('read', false)
    session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('bad'), name: 'write', arguments: '{',
    })
    result('bad', false)

    expect(ctx.sessionProjections.snapshot(session).values.deliverableFiles).toEqual([])
    expect(ctx.sessionProjections.checkpoint(session).deliverableFiles?.val).toEqual({ paths: [], calls: {} })
  })
})
