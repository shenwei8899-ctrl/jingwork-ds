/** Apply a requested file preview from the destination Session's committed surface. */
import { useEffect } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PendingPreview, WorkbenchSnapshot } from './controller.ts'
import css from './page.module.css'

/** Reactive preview intent and its committed-surface command. */
export interface PreviewFace {
  hooks: { catalog: HostObservable<WorkbenchSnapshot>; mounted: HostObservable<SessionId | undefined> }
  completePreview: (request: PendingPreview) => void
}
type Props = PropsRuntime<'conversation.input.overlay'> & PropsLocale<'workbench'> & InjectFace<PreviewFace>
/** Finish an explicit Library gesture after the selected Session and its sidebar store commit.
 * @param props Framework Session seats and the pending navigation command.
 * @returns An in-place failure notice, or no visible control.
 */
export function PreviewNavigation(props: Props) {
  const request = props.useCatalog(state => state.pendingPreview)
  const error = props.useCatalog(state => state.previewError)
  const mounted = props.useMounted(value => value)
  const open = props.useSession(state => state.openState === 'open')
  const { sessionId, completePreview } = props
  useEffect(() => {
    if (!open || mounted !== sessionId || request?.sessionId !== sessionId) return
    let cancelled = false
    // Sidebar navigation flushes focus synchronously outside React effects.
    queueMicrotask(() => { if (!cancelled) completePreview(request) })
    return () => { cancelled = true }
  }, [open, mounted, request, sessionId, completePreview])
  return error && mounted === sessionId ? (
    <span role="alert" className={css.error}>
      {props.t(error)}
    </span>
  ) : null
}
