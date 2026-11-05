/** Personal-assistant prompt shortcuts on a blank Harness conversation. */
import { useState } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkbenchData } from '../types.ts'
import css from './agent-home.module.css'

/** Profile data and the current Session's composer command. */
export interface AgentHomeFace {
  hooks: { form: HostObservable<ConfigFormSnapshot<WorkbenchData>> }
  sendPrompt: (prompt: string) => void
}
/** Display the selected assistant's editable prompt shortcuts.
 * @param props Framework Session seats, saved profile and composer action.
 * @returns Welcome content for workbench assistants, otherwise no content.
 */
export function AgentHome(
  props: PropsRuntime<'conversation.input.dock'> & PropsLocale<'workbench'> & InjectFace<AgentHomeFace>,
) {
  const [failed, setFailed] = useState(false)
  const preset = props.useSessions(
    state => state.byId[props.sessionId]?.projectionValues?.agentPreset,
  )
  const expert = props.useForm(
    state => state.value?.experts.find(row => `workbench-${row.slug}` === preset),
  )
  if (!expert || !props.session.blank || props.session.promptAttempted) return null
  if (!failed && !expert.quickPrompts?.length) return null
  return (
    <section className={css.home}>
      {failed && <p role="alert">{props.t('agentPromptFailed')}</p>}
      <div className={css.cards}>
        {expert.quickPrompts?.map(card => (
          <button
            type="button"
            key={card.id}
            disabled={props.input.phase !== 'plain'}
            onClick={() => {
              setFailed(false)
              try {
                props.sendPrompt(card.prompt)
              } catch (_error) {
                setFailed(true)
              }
            }}
          >
            <strong>{card.title}</strong>
            <span>{card.description}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
