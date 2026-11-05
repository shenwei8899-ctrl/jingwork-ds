import { memo, useMemo } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalCommandInputData } from './goal-command-input.ts'
import css from './GoalCommandInputView.module.css'

type GoalCommandInputViewProps =
  PropsRuntime<'conversation.chat.node', 'command-input'>
  & PropsLocale<'goal'>
  & PropsRenderFactories

/** Render an executed goal or task command with its confirmed leading command chip. */
export const GoalCommandInputView = memo(function GoalCommandInputView({
  node, t, renderFactorySlot,
}: GoalCommandInputViewProps) {
  const data: GoalCommandInputData = node.data
  const name = data.text.slice(1).split(/\s/u, 1)[0] ?? 'goal'
  const commands = useMemo(() => [{ start: 0, end: name.length + 1, name }], [name])
  return (
    <div
      className={css.row}
      data-command-input=""
      role="group"
      aria-label={t('commandInput.aria')}
    >
      <div className={css.stack}>
        <div className={css.bubble}>
          {renderFactorySlot('conversation.user.text', {
            text: data.text,
            facts: { commands },
            interactive: false,
          })}
        </div>
      </div>
    </div>
  )
})
