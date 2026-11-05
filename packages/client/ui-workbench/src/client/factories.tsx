/** Reusable workbench pages retain their owner-provided data and commands. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { AssistantsPage } from './assistants.tsx'
import { WorkbenchPage } from './page.tsx'

/** Render the assistant catalog and its eight-step editor.
 * @param props Framework-bound workbench data and commands.
 * @returns The shared assistant page.
 */
export function AssistantsFactory(props: FactoryComponentPropsOf<'workbench.assistants'>) {
  return <AssistantsPage {...props} />
}

/** Render one resource collection selected by the caller.
 * @param props Resource identity and framework-bound workbench commands.
 * @returns The shared resource editor with an independent page identity.
 */
export function ResourcesFactory(props: FactoryComponentPropsOf<'workbench.resources'>) {
  return (
    <WorkbenchPage
      {...props}
      key={props.kind}
      page={props.kind === 'experts' ? 'experts' : 'capabilities'}
      initialTab={props.kind}
      initialTemplates={false}
    />
  )
}

/** Render the workspace file browser through its owning commands.
 * @param props Framework-bound file access and navigation.
 * @returns The shared library page.
 */
export function LibraryFactory(props: FactoryComponentPropsOf<'workbench.library'>) {
  return <WorkbenchPage {...props} />
}
