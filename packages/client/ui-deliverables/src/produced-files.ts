/** Pure file-mutation readers shared by the Host projection and Client conversation view. */

/** Whether a path is absolute in a POSIX, Windows drive, or Windows UNC spelling. */
function isAbsoluteWorkspacePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
}

/**
 * Extract the path from a supported first-party mutation call.
 * @param name Wire tool name.
 * @param argsRaw Model-produced JSON arguments.
 * @returns The mutation path, or null when the call is unsupported or invalid.
 */
export function mutationPath(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? pathValue(args.file_path) : null
    case 'edit':
      return validEditArgs(args) ? pathValue(args.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(args)
    default:
      return null
  }
}

/**
 * Resolve a settled mutation from recorded metadata, retaining legacy argument paths.
 * @param argumentPath Validated path from the recorded call arguments.
 * @param meta Tool-private result metadata.
 * @returns The recorded absolute result path, a safe legacy fallback, or null.
 */
export function mutationResultPath(argumentPath: string, meta: unknown): string | null {
  if (!isRecord(meta) || !Object.hasOwn(meta, 'path')) return argumentPath
  if (typeof meta.path === 'string' && isAbsoluteWorkspacePath(meta.path)) return meta.path
  return isAbsoluteWorkspacePath(argumentPath) ? argumentPath : null
}

/** Validate the fields that an `edit` execution requires. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && args.insert_line >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
