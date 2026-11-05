/** Pure recovery of the latest chat task from committed session facts. */
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { GoalId } from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-goal'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SuperAgentTask } from './types.ts'

const taskSchema = z.object({
  goalId: z.string().transform(GoalId),
  objective: z.string(),
  phase: z.enum(['active', 'paused', 'blocked', 'complete', 'stopped']),
  todos: z.array(z.object({ content: z.string(), status: z.enum(['pending', 'in_progress', 'completed']) })),
  blocker: z.string().nullable(),
  workerIds: z.array(z.string().transform(SessionId)),
}).nullable()

/** Projection for one latest task and its current whole-list progress. */
export const taskProjection = {
  key: 'superAgent',
  stateVersion: 1,
  stateSchema: taskSchema,
  init: (): SuperAgentTask | null => null,
  apply: (state: SuperAgentTask | null, event) => {
    if (event.type === 'super-agent/start') {
      const data = z.object({ goalId: z.string().transform(GoalId), objective: z.string().trim().min(1) }).parse(event.data)
      return { ...data, phase: 'active', todos: [], blocker: null, workerIds: [] }
    }
    if (state === null) return state
    if (event.type === 'subagent/catalog' && state.phase === 'active') {
      return { ...state, workerIds: [...state.workerIds, event.data.childId] }
    }
    if (event.type === 'goal/change') {
      const change = event.data
      if (change.operation === 'clear') {
        return change.cleared.id === state.goalId ? { ...state, phase: 'stopped', blocker: null } : state
      }
      if (change.goal.id !== state.goalId) return state
      return { ...state, objective: change.goal.objective, phase: change.goal.phase, blocker: change.goal.blockedReason?.message ?? null }
    }
    if (event.type === 'todo/write' && state.phase !== 'complete' && state.phase !== 'stopped') {
      return { ...state, todos: event.data.todos }
    }
    return state
  },
  wire: { viewSchema: taskSchema, view: state => state },
} satisfies ProjectionDefinition<'superAgent', SuperAgentTask | null>
