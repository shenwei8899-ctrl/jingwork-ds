/** Composer task mode and a recoverable task progress card. */
import { useRef, useState } from 'react'
import type { GoalActivation } from '@deepseek-ai/dsh-goal/client'
import type { SuperAgentTask } from '@deepseek-ai/dsh-super-agent/types'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { IconGoalOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GoalActionResult } from './slots.ts'
import css from './SuperAgent.module.css'

/** Task control verbs available from the current task card. */
export type TaskControl = 'pause' | 'resume' | 'stop'

/** Composer callback owned by the session input machine. */
export interface SuperAgentButtonInjected {
  toggleTaskMode: () => void
}

type ButtonProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'goal'> & InjectFace<SuperAgentButtonInjected>

/** Toggle a command chip without replacing the user's draft or references. */
export function SuperAgentButton({ useInput, useSession, useProjection, toggleTaskMode, t }: ButtonProps) {
  const input = useInput(value => value)
  const running = useSession(value => value.running)
  const subagent = useSession(value => value.subagent)
  const removed = useSession(value => value.removed)
  const goal = useProjection('goal')
  const plan = useProjection('plan', value => value?.active === true)
  const selected = input.claim?.name === 'super-agent'
  const locked = removed || subagent !== null || (input.phase !== 'plain' && !selected)
    || input.phase === 'submitting' || running || plan || (goal != null && goal.goal.phase !== 'complete')
  return (
    <Tooltip portal label={t('super.hint')} side="top" delayMs={500}>
      <button type="button" className={css.toggle} aria-pressed={selected} disabled={locked}
        onMouseDown={(event) => { event.preventDefault() }} onClick={toggleTaskMode}>
        <IconGoalOutlineRegular size={14} />
        <span>{t('super.title')}</span>
      </button>
    </Tooltip>
  )
}

/** Plain task data and callbacks supplied by the goal dock. */
export interface SuperAgentCardProps extends PropsLocale<'goal'> {
  task: SuperAgentTask
  activation: GoalActivation | undefined
  control: ((action: TaskControl) => Promise<GoalActionResult>) | undefined
}

/** Current task summary with expandable steps and explicit lifecycle controls. */
export function SuperAgentCard({ task, activation, control, t }: SuperAgentCardProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const terminal = task.phase === 'complete' || task.phase === 'stopped'
  const paused = task.phase === 'paused' || (task.phase === 'active' && activation !== 'armed')
  const phase = paused ? 'paused' : task.phase
  const completed = task.todos.filter(item => item.status === 'completed').length
  async function run(action: TaskControl): Promise<void> {
    if (busy.current || control === undefined) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await control(action)
      if (!result.ok) setError(result.error.message)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('super.error'))
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <section className={css.card} data-super-agent-task aria-label={t('super.title')} aria-busy={pending}>
      <header className={css.header}>
        <span className={css.title}><IconGoalOutlineRegular size={14} />{t('super.title')}</span>
        <span role="status">{t(`super.phase.${phase}`)}</span>
        {!terminal && control !== undefined && <div className={css.actions}>
          <button type="button" disabled={pending} onClick={() => { void run(paused || task.phase === 'blocked' ? 'resume' : 'pause') }}>
            {t(paused || task.phase === 'blocked' ? 'super.resume' : 'super.pause')}
          </button>
          <button type="button" disabled={pending} onClick={() => { void run('stop') }}>{t('super.stop')}</button>
        </div>}
      </header>
      <p className={css.objective}>{task.objective}</p>
      {task.blocker !== null && <p className={css.blocker}>{task.blocker}</p>}
      {task.todos.length > 0 && <details>
        <summary>{t('super.progress', { completed, total: task.todos.length })}</summary>
        <ul className={css.steps}>{task.todos.map(item => <li key={item.content} data-status={item.status}>
          <span className={css.stepStatus}>{t(`super.step.${item.status}`)}</span><span>{item.content}</span>
        </li>)}</ul>
      </details>}
      {error !== null && <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}
