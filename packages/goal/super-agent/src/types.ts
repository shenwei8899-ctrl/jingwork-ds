/** Durable chat-task identity and progress shared by the host and browser. */
import type { GoalId, GoalPhase } from '@deepseek-ai/dsh-goal/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/types'

/** Latest Super Agent task, retained after completion or stopping. */
export interface SuperAgentTask {
  readonly goalId: GoalId
  readonly objective: string
  readonly phase: GoalPhase | 'stopped'
  readonly todos: readonly TodoItem[]
  readonly blocker: string | null
  /** Direct workers created while this task owns the session goal. */
  readonly workerIds: readonly SessionId[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Associates a chat task with its persisted completion goal. */
    'super-agent/start': { readonly goalId: GoalId; readonly objective: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Latest chat task and its progress, or null before the first task. */
    superAgent: SuperAgentTask | null
  }
}
