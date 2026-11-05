/** Bind Super Agent controls to the existing command transport and composer. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import type { GoalProjection } from '@deepseek-ai/dsh-goal/client'
import type { SuperAgentTask } from '@deepseek-ai/dsh-super-agent/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubmitAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { GoalActionResult } from './slots.ts'
import { SuperAgentButton, type SuperAgentButtonInjected, type TaskControl } from './SuperAgent.tsx'

/**
 * Run a task control against the latest compare-and-set goal reference.
 * @param ctx - client context with command transport.
 * @param sessionId - addressed session.
 * @param action - task lifecycle operation.
 * @returns command success or its visible diagnostic.
 */
export async function controlTask(ctx: Context, sessionId: SessionId, action: TaskControl): Promise<GoalActionResult> {
  const projection = ctx.sessions.binding(sessionId)?.session.projections.faceOf('goal').getSnapshot() as GoalProjection | null | undefined
  const goal = projection?.goal
  const task = ctx.sessions.binding(sessionId)?.session.projections.faceOf('superAgent').getSnapshot() as SuperAgentTask | null | undefined
  if (goal === undefined || task?.goalId !== goal.id) return { ok: false, error: { code: 'no-current-goal', message: 'No current Super Agent task.' } }
  const result = await ctx.remote.commands.execute(sessionId, `/super-agent-${action} ${goal.id} ${goal.revision}`, [])
  if (!result.ok) return result
  if (result.value === undefined) return { ok: false, error: { code: 'no-current-goal', message: 'Super Agent is unavailable in this profile.' } }
  if (result.value.result.kind === 'error') return { ok: false, error: { code: 'no-current-goal', message: result.value.result.text } }
  return { ok: true, value: undefined }
}

/**
 * Register the task mode when the composer and command transport are present.
 * @param ctx - client plugin context.
 */
export function registerTaskMode(ctx: Context): void {
  ctx.inject(['conversation', 'remote.commands'], (child) => {
    child.slots.inject('conversation.input.left', () => child.slots.register({
      name: 'conversation.input.left', id: 'super-agent', order: 10, locale: 'goal',
      inject: (sessionId: SessionId): SuperAgentButtonInjected => ({
        toggleTaskMode: () => {
          const binding = child.sessions.binding(sessionId)
          if (binding === undefined) return
          const input = child.conversation.input.for(binding.ctx)
          const state = input.state.getSnapshot()
          if (state.claim?.name === 'super-agent') {
            // TokenSpan counts the command chip as one character, followed by its separator.
            binding.ctx.bail('slash/input-consume-token', { guard: { kind: 'span', span: { start: 0, end: 2, draftRev: state.draftRev } } })
          } else if (state.phase === 'plain') {
            const t = child.locale.bind('goal')
            input.beginCommand({
              name: 'super-agent', token: '/super-agent ', hint: t('super.hint'), attachments: true,
              submit: async (objective: string, _scope: Context, attachments: readonly SubmitAttachment[]) => {
                const result = await child.remote.commands.execute(sessionId, `/super-agent ${objective}`, attachments)
                if (!result.ok) return { kind: 'error', text: result.error.message }
                if (result.value === undefined) return { kind: 'error', text: 'Super Agent is unavailable in this profile.' }
                return result.value.result.kind === 'error' ? { kind: 'error', text: result.value.result.text } : { kind: 'success' }
              },
            }, { start: 0, end: 0, draftRev: state.draftRev })
          }
          input.focus()
        },
      }),
    }, SuperAgentButton))
  })
}
