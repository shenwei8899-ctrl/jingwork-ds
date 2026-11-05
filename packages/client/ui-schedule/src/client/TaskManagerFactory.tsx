/** Reusable task management retains the schedule plugin's catalog and commands. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { TaskManagerPage } from './TaskManagerPage.tsx'

/** Render the shared task manager in another presentation host.
 * @param props Framework-bound schedule catalog, copy and task actions.
 * @returns The task management page.
 */
export function TaskManagerFactory(props: FactoryComponentPropsOf<'schedule.manager'>) {
  return <TaskManagerPage {...props} />
}
