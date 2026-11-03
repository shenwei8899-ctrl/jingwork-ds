/** Assistant action feedback survives navigation away from its management page. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchKey } from './locales.ts'

/** Declare one shared notice and its dismissal command.
 * @returns Root-scoped assistant notice state.
 */
export function createAssistantNoticeStore() {
  return defineStore({
    init: () => ({
      notice: null as { key: WorkbenchKey; success: boolean; sequence: number } | null,
      sequence: 0,
    }),
    actions: {
      show(draft, key: WorkbenchKey, success: boolean) {
        draft.sequence++
        draft.notice = { key, success, sequence: draft.sequence }
      },
      dismiss(draft) {
        draft.notice = null
      },
    },
  })
}
/** Render action results from the shell's persistent overlay.
 * @param props Framework-bound notice state and localized messages.
 * @returns A transient shared toast.
 */
export function AssistantNotice(
  props: PropsRuntime<'shell.overlay'> &
    PropsLocale<'workbench'> &
    PropsStore<ReturnType<typeof createAssistantNoticeStore>>,
) {
  const notice = props.useStore(state => state.notice)
  return notice === null ? null : (
    <Toast
      key={notice.sequence}
      text={props.t(notice.key)}
      {...(notice.success ? { tone: 'success' as const } : {})}
      onDone={props.actions.dismiss}
    />
  )
}
