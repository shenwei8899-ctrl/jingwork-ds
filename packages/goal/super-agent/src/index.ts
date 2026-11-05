/** Chat task orchestration over persisted goals, task lists, and existing subagents. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-goal'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SuperAgentTask } from './types.ts'
import type {} from '@deepseek-ai/dsh-tools'
import { taskProjection } from './projection.ts'
export type * from './types.ts'

export const name = 'super-agent'
export const inject = ['commands', 'goals', 'agents', 'subagents', 'sessionProjections', 'systemPrompt', 'tools']

/** Model policy for a task explicitly started from the chat composer. */
export const TASK_INSTRUCTIONS = `You are coordinating the current Super Agent task in this chat.
Understand the requested outcome and inspect the current workspace before acting. For multi-step work, use todo_write to record concrete steps and update their status as work progresses. Delegate independent work with the available subagent tools when it helps, give each worker a bounded assignment, use only workers created for this task, and integrate and verify their results. Complete simple tasks directly.
Use the current session's configured tools, workspace, permissions, and approval policy. Choose tools appropriate to the task, including research, writing, files, and coding. Treat follow-up user messages as corrections or additional requirements for the current task. Use the available question tools to wait for required user decisions that inspection cannot resolve.
Keep the user informed of meaningful progress in this chat. Before marking the goal complete, settle delegated work, verify the entire requested outcome, update the task list, and provide the final result with usable deliverables and any remaining limitations. Read get_goal and use update_goal to record completion. After interruption or resume, inspect existing results and child agents before creating replacement work.`

/**
 * Register chat task commands and scoped orchestration policy.
 * @param ctx - host plugin context.
 * @returns when projection recovery and command registration are available.
 */
export async function apply(ctx: Context): Promise<void> {
  const tasks = await ctx.sessionProjections.register<'superAgent', SuperAgentTask | null>(taskProjection)
  const controls = new WeakSet<Agent>()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() })

  /** Interrupt every reachable descendant before acknowledging the control operation. */
  async function interruptChildren(agent: Agent, signal: AbortSignal): Promise<void> {
    const owned = new Set(tasks.stateOf(agent.session)?.workerIds ?? [])
    if (owned.size === 0) return
    const descendants = (await ctx.subagents.listDescendants(agent.id, signal)).filter((child) => {
      if (!owned.has(child.id) && !owned.has(child.parentId)) return false
      owned.add(child.id)
      return true
    })
    const failures: string[] = []
    for (const child of descendants.toReversed()) {
      if (child.kind === 'diagnostic') { failures.push(`${child.id}: ${child.reason}`); continue }
      try {
        ctx.subagents.interrupt(child.id, { kind: 'user', parentSessionId: child.parentId })
      } catch (error) {
        failures.push(`${child.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (failures.length > 0) throw new Error(`Some workers could not be interrupted. Check their Sessions before resuming. ${failures.join(', ')}`)
  }

  async function execute(invocation: CommandInvocation, action?: 'pause' | 'resume' | 'stop'): Promise<CommandResult> {
    const { agent } = invocation
    const signal = AbortSignal.any([invocation.signal, lifetime.signal])
    signal.throwIfAborted()
    if (controls.has(agent)) return { kind: 'error', text: 'A task control operation is still running. Wait for it to finish.' }
    const input = invocation.rawInput.trim()
    const task = tasks.stateOf(agent.session)
    const goal = ctx.goals.get(agent)
    if (action !== undefined) {
      if (invocation.attachments.length > 0) return { kind: 'error', text: 'Attachments require a task objective.' }
      if (task === null || goal === undefined || goal.id !== task.goalId) return { kind: 'error', text: 'No current Super Agent task. Start a new task from the composer.' }
      if (input !== '' && input !== `${goal.id} ${goal.revision}`) return { kind: 'error', text: 'The task changed. Refresh its state and try again.' }
      controls.add(agent)
      try {
        if (action === 'resume') {
          ctx.goals.resume(agent, goal)
          return { kind: 'success', text: 'Super Agent task resumed.' }
        }
        if (goal.phase === 'active') ctx.goals.pause(agent, goal)
        agent.cancel({ kind: 'user' }, { keepInbox: action === 'pause' })
        await agent.whenIdle()
        signal.throwIfAborted()
        await interruptChildren(agent, signal)
        signal.throwIfAborted()
        if (action === 'stop') {
          const current = ctx.goals.get(agent)
          if (current?.id === goal.id) ctx.goals.clear(agent, current)
        }
        return { kind: 'success', text: action === 'pause' ? 'Super Agent task paused.' : 'Super Agent task stopped. Existing outputs are retained.' }
      } finally {
        controls.delete(agent)
      }
    }
    const objective = input
    if (objective === '') return { kind: 'error', text: 'Enter a task objective.' }
    if (goal !== undefined && goal.phase !== 'complete') return { kind: 'error', text: 'A goal or task is already open. Resume or stop it before starting another.' }
    if (agent.status !== 'idle') return { kind: 'error', text: 'Wait for the current response to finish before starting a task.' }
    const missing = ['get_goal', 'update_goal', 'todo_write'].filter(name => ctx.tools.get(name, agent) === undefined)
    if (missing.length > 0) return { kind: 'error', text: `This agent preset is missing required task tools (${missing.join(', ')}). Choose Standard or enable the goal and task-list tools.` }
    const created = ctx.goals.create(agent, { objective })
    try {
      agent.session.append('super-agent/start', { goalId: created.id, objective })
    } catch (error) {
      ctx.goals.disarm(agent)
      throw error
    }
    if (invocation.attachments.length > 0) {
      agent.followup(createUserMessage({ content: [...invocation.attachments, { type: 'text', text: 'Reference attachments for the Super Agent task.' }], source: { kind: 'user' } }))
    }
    return { kind: 'success', text: 'Super Agent task started.' }
  }

  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-super-agent'),
    name: 'super-agent',
    description: 'Start or control a Super Agent task in this chat',
    input: { hint: '<objective>', attachments: true },
    handler: invocation => execute(invocation),
  })
  for (const action of ['pause', 'resume', 'stop'] as const) {
    ctx.commands.register({
      definitionId: CommandDefinitionId(`@deepseek-ai/dsh-super-agent/${action}`),
      name: `super-agent-${action}`,
      description: `${action.charAt(0).toUpperCase()}${action.slice(1)} the current Super Agent task`,
      handler: invocation => execute(invocation, action),
    })
  }
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const task = tasks.stateOf(agent.session)
    if (task === null || task.phase === 'complete') return decision
    const goal = ctx.goals.get(agent)
    if (task.phase === 'active' && goal?.activation === 'armed') return decision
    // Interrupted workers can report after the task is paused. Their reports must not restart it.
    const messages = decision.messages.filter((message) => {
      const source = message.source
      return (source.kind !== 'subagent-settled' && source.kind !== 'agent-message')
        || !task.workerIds.includes(source.senderSessionId)
    })
    return messages.length === decision.messages.length ? decision : { ...decision, messages }
  })
  ctx.systemPrompt.section({
    name: 'super-agent', order: 850, interpolate: false,
    text: ({ agent }) => {
      if (agent === undefined) return ''
      const task = tasks.stateOf(agent.session)
      const goal = ctx.goals.get(agent)
      return task !== null && goal?.id === task.goalId && goal.phase !== 'complete' ? TASK_INSTRUCTIONS : ''
    },
  })
}
