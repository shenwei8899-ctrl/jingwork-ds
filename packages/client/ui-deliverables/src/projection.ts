/** Whole-Session produced-file projection used by historical library summaries. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { isPresentedData, isPresentedFile } from './presented.ts'
import { mutationPath, mutationResultPath } from './produced-files.ts'
import type {} from './types.ts'

interface DeliverableFilesState {
  readonly paths: readonly string[]
  readonly calls: Readonly<Record<string, string | null>>
}

const pathsSchema = z.array(z.string().min(1))
const stateSchema: z.ZodType<DeliverableFilesState> = z.object({
  paths: pathsSchema,
  calls: z.record(z.string(), z.string().nullable()),
}).strict()

const EMPTY_STATE: DeliverableFilesState = { paths: [], calls: {} }

/** Append paths once while preserving first-seen order and the existing array when unchanged. */
function appendPaths(paths: readonly string[], additions: readonly string[]): readonly string[] {
  if (additions.length === 0) return paths
  const seen = new Set(paths)
  const next = [...paths]
  for (const path of additions) {
    if (seen.has(path)) continue
    seen.add(path)
    next.push(path)
  }
  return next.length === paths.length ? paths : next
}

/** Remove a completed call while retaining all other pending mutation calls. */
function withoutCall(calls: Readonly<Record<string, string | null>>, callId: string): Readonly<Record<string, string | null>> {
  if (!Object.hasOwn(calls, callId)) return calls
  return Object.fromEntries(Object.entries(calls).filter(([key]) => key !== callId))
}

/** Pure Session fold for successful file writes and explicit file deliveries. */
export const deliverableFilesProjectionDefinition = {
  key: 'deliverableFiles',
  stateVersion: 1,
  stateSchema,
  init: () => EMPTY_STATE,
  apply: (state, event) => {
    if (event.type === 'tool/call') {
      const calls = { ...state.calls, [String(event.data.callId)]: mutationPath(event.data.name, event.data.arguments) }
      return { paths: state.paths, calls }
    }
    if (event.type === 'tool/result' && event.surfaceOp === 'append') {
      const callId = String(event.data.message.source.callId)
      const argumentPath = state.calls[callId]
      const calls = withoutCall(state.calls, callId)
      if (event.data.message.isError === true || argumentPath === null || argumentPath === undefined) {
        return calls === state.calls ? state : { paths: state.paths, calls }
      }
      const path = mutationResultPath(argumentPath, event.data.meta)
      const paths = path === null ? state.paths : appendPaths(state.paths, [path])
      return paths === state.paths && calls === state.calls ? state : { paths, calls }
    }
    if (event.type === 'deliverables/presented' && isPresentedData(event.data)) {
      const paths = appendPaths(state.paths, event.data.files.flatMap(file => isPresentedFile(file) ? [file.path] : []))
      return paths === state.paths ? state : { paths, calls: state.calls }
    }
    return state
  },
  wire: { viewSchema: pathsSchema, view: state => state.paths },
} satisfies ProjectionDefinition<'deliverableFiles', DeliverableFilesState>
