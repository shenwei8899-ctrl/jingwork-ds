/** Chat task commands exercise the real goal service and projection lifecycle. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import GoalService from '@deepseek-ai/dsh-goal'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import * as toolGoal from '@deepseek-ai/dsh-tool-goal'
import * as toolTodo from '@deepseek-ai/dsh-tool-todo'
import * as superAgent from '../src/index.ts'
import { taskProjection } from '../src/projection.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Commands)
  await ctx.plugin(GoalService)
  await ctx.plugin(toolGoal)
  await ctx.plugin(toolTodo, { allowParallelInProgress: true })
  const listDescendants = vi.fn<SubagentRuntime['listDescendants']>().mockResolvedValue([])
  const interrupt = vi.fn<SubagentRuntime['interrupt']>()
  ctx.provide('subagents', { listDescendants, interrupt })
  const plugin = ctx.plugin(superAgent)
  await plugin.await()
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('super-agent-test'))
  async function run(input: string) {
    const execution = await ctx.commands.execute(agent, /^(pause|resume|stop)(?:\s|$)/u.test(input) ? `/super-agent-${input}` : `/super-agent ${input}`, [], new AbortController().signal)
    if (execution === undefined) throw new Error('missing task command')
    return execution.result
  }
  const task = () => ctx.sessionProjections.snapshot(agent.session).values.superAgent
  return { ctx, agent, run, task, plugin, listDescendants, interrupt }
}

describe('chat Super Agent', () => {
  it('starts one task, rejects duplicates, and retains task-list progress across turns', async () => {
    const h = await harness()
    expect((await h.run('Write a report')).kind).toBe('success')
    expect(h.task()).toMatchObject({ objective: 'Write a report', phase: 'active', todos: [] })
    expect((await h.run('Other work')).kind).toBe('error')
    h.agent.session.append('todo/write', { todos: [{ content: 'Research', status: 'completed' }, { content: 'Write', status: 'in_progress' }] })
    expect(h.task()?.todos).toHaveLength(2)
    const assembly = await h.ctx.systemPrompt.assemble({ agent: h.agent, scope: h.agent })
    expect(assembly).toEqual(expect.objectContaining({}))
    expect(JSON.stringify(assembly)).toContain('Super Agent task')
    const goal = h.ctx.goals.get(h.agent)!
    h.ctx.goals.complete(h.agent, goal)
    expect(h.task()?.phase).toBe('complete')
    h.agent.session.append('todo/write', { todos: [] })
    expect(h.task()?.todos).toHaveLength(2)
    expect((await h.run('Next task')).kind).toBe('success')
    expect(h.task()?.todos).toEqual([])
  })

  it('pauses, resumes, stops, and rejects controls from an old goal revision', async () => {
    const h = await harness()
    await h.run('Work')
    const goal = h.ctx.goals.get(h.agent)!
    expect((await h.run(`pause ${goal.id} ${goal.revision}`)).kind).toBe('success')
    expect(h.task()?.phase).toBe('paused')
    expect((await h.run(`resume ${goal.id} ${goal.revision}`)).kind).toBe('error')
    expect((await h.run('resume')).kind).toBe('success')
    expect(h.ctx.goals.get(h.agent)?.activation).toBe('armed')
    expect((await h.run('stop')).kind).toBe('success')
    expect(h.ctx.goals.get(h.agent)).toBeUndefined()
    expect(h.task()?.phase).toBe('stopped')
    expect((await h.run('resume')).kind).toBe('error')
  })

  it('interrupts descendants deepest first and reports worker failures without claiming a stop', async () => {
    const h = await harness()
    await h.run('Delegate work')
    h.agent.session.append('subagent/catalog', { version: 0, childId: SessionId('child'), childCreatedAt: Date.now(), mode: 'one-shot' })
    h.listDescendants.mockResolvedValue([
      { kind: 'child', id: SessionId('unrelated'), parentId: h.agent.id, depth: 1, mode: 'one-shot', activity: 'running', hasChildren: false },
      { kind: 'child', id: SessionId('child'), parentId: h.agent.id, depth: 1, mode: 'one-shot', activity: 'running', hasChildren: true },
      { kind: 'child', id: SessionId('grandchild'), parentId: SessionId('child'), depth: 2, mode: 'one-shot', activity: 'running', hasChildren: false },
    ])
    await h.run('pause')
    expect(h.interrupt.mock.calls.map(args => args[0])).toEqual(['grandchild', 'child'])
    await h.run('resume')
    h.interrupt.mockImplementation(() => { throw new Error('worker unavailable') })
    await expect(h.run('stop')).rejects.toThrow('could not be interrupted')
    expect(h.task()?.phase).toBe('paused')
    expect(h.ctx.goals.get(h.agent)).toBeDefined()
  })

  it('replays progress without runtime effects and releases the command on disposal', async () => {
    const h = await harness()
    expect((await h.run('')).kind).toBe('error')
    await h.run('Research')
    h.agent.session.append('todo/write', { todos: [{ content: 'Read sources', status: 'in_progress' }] })
    await h.run('pause')
    let restored = taskProjection.init()
    for (const event of h.agent.session.snapshotEvents()) restored = taskProjection.apply(restored, event)
    expect(restored).toEqual(h.task())
    expect(taskProjection.stateSchema.parse(JSON.parse(JSON.stringify(restored)))).toEqual(restored)
    const calls = h.listDescendants.mock.calls.length
    await h.plugin.dispose()
    expect(await h.ctx.commands.execute(h.agent, '/super-agent Again', [], new AbortController().signal)).toBeUndefined()
    expect(h.listDescendants).toHaveBeenCalledTimes(calls)
  })
  it('prevents a late worker report from restarting a paused task while preserving direct user input', async () => {
    const h = await harness()
    await h.run('Work')
    h.agent.session.append('subagent/catalog', { version: 0, childId: SessionId('worker'), childCreatedAt: Date.now(), mode: 'one-shot' })
    await h.run('pause')
    const report = createUserMessage({ content: [{ type: 'text', text: 'Stopped worker report' }], source: {
      kind: 'subagent-settled', form: 'notice', summary: 'Worker stopped', senderSessionId: SessionId('worker'),
    } })
    const human = createUserMessage({ content: [{ type: 'text', text: 'Additional requirement' }], source: { kind: 'user' } })
    const payload = { messages: [report], turn: 1, step: 1, signal: new AbortController().signal,
      modelSelection: { provider: 'mock', model: 'mock' } }
    const dispatch = agentEvents(h.ctx, h.agent)
    const decision = await dispatch.waterfall('agent/pre-step', payload, async () => ({ kind: 'enter', messages: [report] }))
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    const corrected = await dispatch.waterfall('agent/pre-step', { ...payload, messages: [report, human] }, async () => ({ kind: 'enter', messages: [report, human], startsRequestSeries: true }))
    expect(corrected).toEqual({ kind: 'enter', messages: [human], startsRequestSeries: true })
  })

  it('rejects a second control while worker interruption is pending', async () => {
    const h = await harness()
    await h.run('Work')
    h.agent.session.append('subagent/catalog', { version: 0, childId: SessionId('worker'), childCreatedAt: Date.now(), mode: 'one-shot' })
    const pending = Promise.withResolvers<Awaited<ReturnType<SubagentRuntime['listDescendants']>>>()
    h.listDescendants.mockReturnValue(pending.promise)
    const pausing = h.run('pause')
    await vi.waitFor(() => { expect(h.listDescendants).toHaveBeenCalledOnce() })
    expect((await h.run('resume')).kind).toBe('error')
    pending.resolve([])
    expect((await pausing).kind).toBe('success')
  })

})
