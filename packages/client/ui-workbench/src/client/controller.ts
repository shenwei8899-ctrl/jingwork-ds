/** Workbench data operations over existing Settings and workspace-file APIs. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { WorkspaceDirectoryListing } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { Connector, Expert, ExpertTeam, WorkbenchData, WorkbenchSkill } from '../types.ts'
import { validateWorkbench } from '../validation.ts'
import { resolveExpert } from '../expert.ts'
import type { WorkbenchKey } from './locales.ts'

/** Editable workbench collections. */
export type EntityKind = 'experts' | 'teams' | 'skills' | 'connectors'
/** One editor record. */
export type Entity = Expert | ExpertTeam | WorkbenchSkill | Connector
/** One explicit file-preview navigation, consumed after the destination mounts. */
export interface PendingPreview {
  sessionId: SessionId
  address: string
}
/** Data fetched from the Host, owned by this controller rather than copied into a view store. */
export interface WorkbenchSnapshot {
  roster: readonly AgentPresetRow[]
  files: WorkspaceDirectoryListing | null
  fileSession: SessionId | null
  loading: boolean
  error: WorkbenchKey | null
  pendingPreview: PendingPreview | null
  previewError: WorkbenchKey | null
}
/** Settings and file commands supplied by the plugin's injected services. */
export interface WorkbenchPorts {
  form: ConfigForm<WorkbenchData>
  listPresets: Context['remote']['agentPresets']['list']
  listFiles: Context['remote']['workspaceFiles']['list']
  statFile: Context['remote']['workspaceFiles']['stat']
  readFileBytes: Context['remote']['workspaceFiles']['readBytes']
  openSession: (sessionId: SessionId) => void
  openResource: (address: string) => void
  beginNavigation: () => AbortSignal
}
/** UI-domain controller; no subscriptions or transport work live in components. */
export class WorkbenchController {
  /** Revision-fenced profile configuration. */
  readonly form
  /** Roster diagnostics and directory-read state. */
  readonly source = createSnapshotStore<WorkbenchSnapshot>({
    roster: [],
    files: null,
    fileSession: null,
    loading: false,
    error: null,
    pendingPreview: null,
    previewError: null,
  })
  private abort = new AbortController()
  private fileAbort: AbortController | undefined
  private generation = 0
  private rosterGeneration = 0
  constructor(private readonly ports: WorkbenchPorts) {
    this.form = ports.form
  }
  private patch(value: Partial<WorkbenchSnapshot>): void {
    this.source.set({ ...this.source.getSnapshot(), ...value })
  }
  /** Read current roster diagnostics without replacing saved configurations. */
  async load(): Promise<void> {
    const generation = ++this.rosterGeneration
    try {
      const result = await this.ports.listPresets()
      if (this.abort.signal.aborted || generation !== this.rosterGeneration) return
      if (!result.ok) throw new Error(result.error.message)
      this.patch({ roster: result.value.presets, error: null })
    } catch (_error) {
      if (!this.abort.signal.aborted && generation === this.rosterGeneration) this.patch({ error: 'loadError' })
    }
  }
  /** Save one complete entity with a Settings revision fence.
   * @param kind Configuration collection.
   * @param entity Validated editor value.
   * @param originalSlug Previous key; undefined creates a new item.
   * @param revision Revision seen when editing began.
   * @returns Localized failure key, or null on acceptance.
   */
  async save(
    kind: EntityKind,
    entity: Entity,
    originalSlug: string | undefined,
    revision: number | undefined,
  ): Promise<WorkbenchKey | null> {
    const data = this.form.getSnapshot().value
    if (data === undefined) return 'notConfigured'
    const rows = data[kind]
    if (
      originalSlug !== undefined &&
      (kind === 'experts' || kind === 'teams') &&
      (entity.slug !== originalSlug || ('skills' in entity && !resolveExpert(entity).enabled)) &&
      this.isDefault(kind, originalSlug)
    ) return 'defaultInUse'
    if (rows.some(row => row.slug === entity.slug && row.slug !== originalSlug)) return 'duplicate'
    if (
      (kind === 'experts' || kind === 'teams') &&
      (kind === 'experts' ? data.teams : data.experts).some(row => row.slug === entity.slug)
    )
      return 'duplicate'
    if (
      kind === 'experts' &&
      originalSlug !== undefined &&
      entity.slug !== originalSlug &&
      data.teams.some(team => team.members.includes(originalSlug))
    )
      return 'expertInTeam'
    if (originalSlug !== undefined && !rows.some(row => row.slug === originalSlug)) return 'saveError'
    const next =
      originalSlug === undefined ? [...rows, entity] : rows.map(row => (row.slug === originalSlug ? entity : row))
    try {
      validateWorkbench({ ...data, [kind]: next })
      const accepted = await this.form.mutate([{ op: 'set', path: [kind], value: next }], revision)
      if (!accepted) return 'saveError'
      await this.load()
      return null
    } catch (_error) {
      return 'saveError'
    }
  }
  private isDefault(kind: 'experts' | 'teams', slug: string): boolean {
    const defaults = this.source.getSnapshot().roster.filter(row => row.isDefault).map(row => row.id)
    if (defaults.includes(`workbench-${slug}`)) return true
    return kind === 'experts' && (this.form.getSnapshot().value?.teams.some(team =>
      team.members.includes(slug) && defaults.includes(`workbench-${team.slug}`)) ?? false)
  }
  /** Enable or disable an assistant for subsequently created sessions.
   * @param slug Saved assistant key.
   * @param enabled Whether new sessions can select the assistant and teams containing it.
   * @param revision Revision seen when the action began.
   * @returns Localized failure key, or null on acceptance.
   */
  async setEnabled(slug: string, enabled: boolean, revision: number | undefined): Promise<WorkbenchKey | null> {
    const expert = this.form.getSnapshot().value?.experts.find(row => row.slug === slug)
    if (expert === undefined) return 'saveError'
    return this.save('experts', { ...resolveExpert(expert), enabled }, slug, revision)
  }
  /** Remove configuration without deleting sessions or files.
   * @param kind Configuration collection.
   * @param slug User-owned key.
   * @returns Localized failure, or null on acceptance.
   */
  async remove(kind: EntityKind, slug: string): Promise<WorkbenchKey | null> {
    const before = this.form.getSnapshot()
    const data = before.value
    if (data === undefined) return 'notConfigured'
    if ((kind === 'experts' || kind === 'teams') && this.isDefault(kind, slug)) return 'defaultInUse'
    if (kind === 'experts' && data.teams.some(team => team.members.includes(slug))) return 'expertInTeam'
    const next = data[kind].filter(row => row.slug !== slug)
    try {
      const ops: import('@deepseek-ai/dsh-api-remotes/client').SettingsPathOpView[] = [
        { op: 'set' as const, path: [kind], value: next },
      ]
      if (kind === 'skills' || kind === 'connectors') {
        const experts = data.experts.map(expert => ({ ...expert, [kind]: expert[kind].filter(key => key !== slug) }))
        ops.push({ op: 'set', path: ['experts'], value: experts })
      }
      return (await this.form.mutate(ops, before.revision)) ? null : 'saveError'
    } catch (_error) {
      return 'saveError'
    }
  }
  /** Import all collections atomically; Host schemas reject malformed data.
   * @param raw JSON exported by the workbench.
   * @returns Localized failure, or null on acceptance.
   */
  async import(raw: string): Promise<WorkbenchKey | null> {
    try {
      const data = validateWorkbench(JSON.parse(raw))
      const keys: EntityKind[] = ['experts', 'teams', 'skills', 'connectors']
      const accepted = await this.form.mutate(
        keys.map(key => ({ op: 'set', path: [key], value: data[key] })),
        this.form.getSnapshot().revision,
      )
      if (accepted) await this.load()
      return accepted ? null : 'importError'
    } catch (_error) {
      return 'importError'
    }
  }
  /** List an authorized workspace directory, retaining prior entries on failure.
   * @param sessionId Session supplying the workspace and access policy.
   * @param path Workspace-relative directory.
   */
  async files(sessionId: SessionId, path: string): Promise<void> {
    this.fileAbort?.abort()
    const abort = (this.fileAbort = new AbortController())
    const generation = ++this.generation
    this.patch({ loading: true, error: null })
    try {
      const result = await this.ports.listFiles(sessionId, path || '.', abort.signal)
      if (abort.signal.aborted || generation !== this.generation) return
      if (!result.ok) throw new Error(result.error.message)
      this.patch({ files: result.value, fileSession: sessionId, loading: false })
    } catch (_error) {
      if (!abort.signal.aborted && generation === this.generation) this.patch({ loading: false, error: 'loadError' })
    }
  }
  /** Open the existing preview system, including its supported document and media renderers.
   * @param sessionId File's Session.
   * @param path Workspace-relative file.
   */
  async preview(sessionId: SessionId, path: string): Promise<void> {
    const signal = AbortSignal.any([this.abort.signal, this.ports.beginNavigation()])
    try {
      const result = await this.ports.statFile(sessionId, path, signal)
      if (signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      this.patch({
        pendingPreview: { sessionId, address: fileAddressFor(sessionId, undefined, result.value.absolutePath) },
        previewError: null,
      })
      this.ports.openSession(sessionId)
    } catch (_error) {
      if (!signal.aborted) this.patch({ error: 'loadError' })
    }
  }
  /** Consume one navigation after its Session surface has committed.
   * @param request The exact pending request observed by the destination's seat.
   */
  completePreview(request: PendingPreview): void {
    if (this.abort.signal.aborted || this.source.getSnapshot().pendingPreview !== request) return
    this.patch({ pendingPreview: null })
    try {
      this.ports.openResource(request.address)
    } catch (_error) {
      this.patch({ previewError: 'loadError' })
    }
  }
  /** Cancel preview navigation superseded by a different panel or Session. */
  cancelPreview(): void {
    if (this.source.getSnapshot().pendingPreview !== null || this.source.getSnapshot().previewError !== null) {
      this.patch({ pendingPreview: null, previewError: null })
    }
  }
  /** Download the complete file under the Host's existing read cap.
   * @param sessionId File's Session.
   * @param path Workspace-relative file.
   */
  async download(sessionId: SessionId, path: string): Promise<void> {
    try {
      const result = await this.ports.readFileBytes(sessionId, path, {}, this.abort.signal)
      if (this.abort.signal.aborted) return
      if (!result.ok) throw new Error(result.error.message)
      if (!result.value.eof) throw new Error('File exceeds read limit')
      saveDownload(path.split('/').at(-1) ?? path, new Blob([new Uint8Array(result.value.data)]))
    } catch (_error) {
      if (!this.abort.signal.aborted) this.patch({ error: 'loadError' })
    }
  }
  /** End reads and prevent pending results from publishing. */
  dispose(): void {
    this.abort.abort()
    this.fileAbort?.abort()
    this.generation++
  }
}
/** Download browser-owned data without keeping object URLs alive.
 * @param name Suggested filename.
 * @param content Download bytes.
 */
export function saveDownload(name: string, content: Blob): void {
  const url = URL.createObjectURL(content)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
