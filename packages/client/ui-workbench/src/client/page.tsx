/** Profile-owned expert management and workspace file browsing. */
import { useEffect, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  Tooltip,
  IconUsersOutlineRegular,
  IconUserOutlineRegular,
  IconAppsAddOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconFolderOpenRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconNewChatOutlineRegular,
  IconLoadingOutlineRegular,
  IconPlusOutlineRegular,
  IconChevronRightOutlineRegular,
  IconEditOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fileMediaUrl, relativizeToCwd, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchData } from '../types.ts'
import { EXPERT_TEMPLATES } from '../defaults.ts'
import type { Entity, EntityKind, WorkbenchController, WorkbenchSnapshot } from './controller.ts'
import { saveDownload } from './controller.ts'
import type { WorkbenchKey } from './locales.ts'
import cardStyles from './card.module.css'
import css from './page.module.css'
import { expertAvatars } from './expert-avatars.ts'
import type { createAssistantNoticeStore } from './assistant-notice.tsx'
import { Connectors } from './Connectors.tsx'
import { BuiltinSkills } from './BuiltinSkills.tsx'

/** Commands and observable data injected by the plugin registration. */
export interface WorkbenchFace {
  page: 'assistants' | 'experts' | 'capabilities' | 'library'
  initialTab?: EntityKind
  initialTemplates?: boolean
  hooks: {
    form: HostObservable<ConfigFormSnapshot<WorkbenchData>>
    catalog: HostObservable<WorkbenchSnapshot>
  }
  saveConnectorCredentials: (slug: string, value: Record<string, string>) => Promise<WorkbenchKey | null>
  setEnabled: WorkbenchController['setEnabled']
  setDefault: (slug: string) => Promise<WorkbenchKey | null>
  load: WorkbenchController['load']
  loadLibrary: WorkbenchController['loadLibrary']
  save: WorkbenchController['save']
  remove: WorkbenchController['remove']
  importData: WorkbenchController['import']
  files: WorkbenchController['files']
  preview: WorkbenchController['preview']
  download: WorkbenchController['download']
  start: (slug: string) => void | Promise<void>
}
type PageProps = PropsRuntime<'main'> & PropsLocale<'workbench'> & InjectFace<WorkbenchFace> & PropsStore<ReturnType<typeof createAssistantNoticeStore>>
type Editing = {
  kind: EntityKind
  entity: Entity
  original: string | undefined
  revision: number | undefined
}
const empty = (kind: EntityKind): Entity => {
  const base = { slug: '', name: '', description: '' }
  if (kind === 'teams') return { ...base, instructions: '', members: [] }
  if (kind === 'skills') return { ...base, content: '' }
  if (kind === 'connectors')
    return {
      ...base,
      transport: 'streamable-http',
      url: '',
      command: '',
      args: [],
      enabled: false,
    }
  return { ...base, instructions: '', skills: [], connectors: [] }
}
/** One lazy thumbnail retains its failure state until its file address changes. */
function LibraryThumbnail({ src, name, failedLabel }: {
  src: string | undefined
  name: string
  failedLabel: string
}) {
  const [failed, setFailed] = useState(false)
  return <span className={css.thumbnailFrame}>
    {src === undefined || failed ? <span role="status">{failedLabel}</span> : (
      <img src={src} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer"
        onError={() => { setFailed(true) }} />
    )}
  </span>
}
/** Normalize a recorded file path into the slash-separated spelling used by directory listings. */
function libraryRelativePath(cwd: string, path: string): string {
  return relativizeToCwd(path, cwd).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+|\/+$/g, '')
}

/** Compare Session workspace roots across POSIX and Windows separator spellings. */
function sameWorkspace(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').replace(/\/+$/, '') === right.replace(/\\/g, '/').replace(/\/+$/, '')
}
/** Render a panel from framework-provided settings, sessions and commands.
 * @param props Derived slot props.
 * @returns Workbench page.
 */
export function WorkbenchPage(props: PageProps) {
  const { t, page } = props
  const form = props.useForm(s => s)
  const catalog = props.useCatalog(s => s)
  const sessions = catalog.librarySessions
  const data = form.value
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<EntityKind>(props.initialTab ?? 'experts')
  const [templates, setTemplates] = useState(props.initialTemplates ?? true)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<{
    kind: EntityKind
    entity: Entity
  } | null>(null)
  const [error, setError] = useState<WorkbenchKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [args, setArgs] = useState('[]')
  const [session, setSession] = useState<SessionId | undefined>()
  const [path, setPath] = useState('')
  const [filter, setFilter] = useState<WorkbenchKey>('allFiles')
  useEffect(() => {
    if (page === 'library') void props.loadLibrary()
    else void props.load()
  }, [page, props.load, props.loadLibrary])
  useEffect(() => {
    const first = sessions[0]
    if (page !== 'library' || catalog.libraryLoading || first === undefined
      || sessions.some(row => row.id === session)) return
    setSession(first.id)
    setPath('')
    void props.files(first.id, '')
  }, [page, catalog.libraryLoading, sessions, session, props.files])
  const begin = (kind: EntityKind, entity?: Entity) => {
    const value = structuredClone(entity ?? empty(kind))
    setEditing({
      kind,
      entity: value,
      original: entity?.slug,
      revision: form.revision,
    })
    setArgs('args' in value ? JSON.stringify(value.args) : '[]')
    setError(null)
  }
  const update = (values: Partial<Entity>) => {
    if (editing) setEditing({ ...editing, entity: { ...editing.entity, ...values } })
  }
  const perform = async (action: () => Promise<WorkbenchKey | null>, done?: () => void) => {
    setBusy(true)
    setError(null)
    try {
      const failure = await action()
      setError(failure)
      if (!failure) done?.()
    } finally {
      setBusy(false)
    }
  }
  const submit = () => {
    if (!editing) return
    let entity = editing.entity
    if (!entity.name.trim() || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(entity.slug)) {
      setError('invalid')
      return
    }
    if ('members' in entity && !entity.members.length) {
      setError('memberRequired')
      return
    }
    if (
      ('content' in entity && !entity.content.trim()) ||
      ('instructions' in entity && !entity.instructions.trim())
    ) {
      setError('invalid')
      return
    }
    if ('transport' in entity) {
      try {
        const parsed: unknown = JSON.parse(args)
        if (!Array.isArray(parsed) || !parsed.every((v: unknown) => typeof v === 'string'))
          throw new Error('arguments')
        if (
          entity.transport === 'streamable-http'
            ? !['http:', 'https:'].includes(new URL(entity.url).protocol)
            : !entity.command.trim()
        )
          throw new Error('transport')
        entity = { ...entity, args: parsed }
      } catch (_error) {
        setError('badConnector')
        return
      }
    }
    void perform(
      () => props.save(editing.kind, entity, editing.original, editing.revision),
      () => {
        setEditing(null)
      },
    )
  }
  const matches = (row: { name: string; description?: string }) =>
    `${row.name} ${row.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  const selectedSession = sessions.find(row => row.id === session)
  const browse = (id: SessionId, directory: string) => {
    setSession(id)
    setPath(directory)
    void props.files(id, directory)
  }
  const fileKind = (name: string): WorkbenchKey =>
    /\.(png|jpg|jpeg|gif|webp|svg|avif|heic)$/i.test(name)
      ? 'images'
      : /\.(md|pdf|docx?|xlsx?|pptx?|txt|csv|rtf|odt)$/i.test(name)
        ? 'documents'
        : /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(name)
          ? 'videos'
          : /\.(mp3|wav|m4a|aac|ogg|flac|aiff)$/i.test(name)
            ? 'audio'
            : 'other'
  const libraryEntries =
    catalog.fileSession === session && catalog.files?.path === path ? catalog.files.entries : []
  const shownDirectories = filter === 'allFiles'
    ? libraryEntries.filter(entry => entry.type === 'directory' && matches(entry))
    : []
  const shownFileEntries = libraryEntries.filter(
    entry => entry.type !== 'directory'
      && matches(entry)
      && (filter === 'allFiles' || (entry.type === 'file' && fileKind(entry.name) === filter)),
  )
  const workspaceSessions = selectedSession === undefined
    ? []
    : sessions.filter(row => sameWorkspace(row.cwd, selectedSession.cwd))
  const recordedPaths = new Map<SessionId, ReadonlySet<string>>(workspaceSessions.map(row => [
    row.id,
    new Set(row.deliverableFiles.map(file => libraryRelativePath(row.cwd, file))),
  ]))
  const fullPath = (entry: WorkspaceDirectoryEntry) => path ? `${path}/${entry.name}` : entry.name
  const attributedGroups = workspaceSessions.flatMap((row) => {
    const paths = recordedPaths.get(row.id)
    const entries = paths === undefined ? [] : shownFileEntries.filter(entry => paths.has(fullPath(entry)))
    return entries.length === 0 ? [] : [{ session: row, entries }]
  })
  const claimedPaths = new Set(workspaceSessions.flatMap(row => [...(recordedPaths.get(row.id) ?? [])]))
  const unassignedFiles = shownFileEntries.filter(entry => !claimedPaths.has(fullPath(entry)))
  const hasShownEntries = shownDirectories.length > 0 || attributedGroups.length > 0 || unassignedFiles.length > 0
  const fileCount = libraryEntries.filter(entry => entry.type === 'file').length
  const showingSkills = page === 'capabilities' && !templates && tab === 'skills'
  const kind: EntityKind = page === 'assistants' ? 'experts' : tab
  const rows = data?.[kind] ?? []
  const edit = editing?.entity
  const visibleError = error ?? catalog.error
  const renderLibraryEntries = (entries: readonly WorkspaceDirectoryEntry[], owner: SessionId) => (
    <div className={filter === 'images' ? css.imageGrid : css.files}>
      {entries.map((entry) => {
        const full = fullPath(entry)
        const thumbnail = filter === 'images'
          ? fileMediaUrl(document.baseURI, resolveWorkspacePath(selectedSession?.cwd, full))
          : undefined
        return (
          <article className={filter === 'images' ? css.imageCard : css.file} key={entry.name}>
            {filter === 'images' ? (
              <button type="button" className={css.imageThumbnail}
                aria-label={`${t('preview')} ${entry.name}`}
                onClick={() => { void props.preview(owner, full) }}>
                <LibraryThumbnail key={thumbnail} src={thumbnail} name={entry.name}
                  failedLabel={t('thumbnailFailed')} />
              </button>
            ) : <span>{entry.type === 'directory' ? '▧' : '▤'}</span>}
            <strong>{entry.name}</strong>
            {entry.size !== undefined && <small>{`${Math.ceil(entry.size / 1024)} KB`}</small>}
            <div className={css.fileActions}>
              {entry.type === 'directory' ? (
                <Button onClick={() => { browse(owner, full) }}>{t('openFolder')}</Button>
              ) : entry.type === 'file' && (
                <>
                  <Button onClick={() => { void props.preview(owner, full) }}>{t('preview')}</Button>
                  <Button onClick={() => { void props.download(owner, full) }}>{t('download')}</Button>
                </>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
  const choices = (key: 'skills' | 'connectors' | 'members', options: { slug: string; name: string }[]) =>
    edit &&
    key in edit && (
      <fieldset>
        <legend>
          {t(key === 'members' ? 'members' : key === 'skills' ? 'chooseSkills' : 'chooseConnectors')}
        </legend>
        {options.map((option) => {
          const selected =
            key === 'members' && 'members' in edit
              ? edit.members
              : key === 'skills' && 'skills' in edit
                ? edit.skills
                : key === 'connectors' && 'connectors' in edit
                  ? edit.connectors
                  : []
          return (
            <label className={css.check} key={option.slug}>
              <input
                type="checkbox"
                checked={selected.includes(option.slug)}
                onChange={(event) => {
                  update({
                    [key]: event.target.checked
                      ? [...selected, option.slug]
                      : selected.filter(v => v !== option.slug),
                  })
                }}
              />
              {option.name}
            </label>
          )
        })}
      </fieldset>
    )
  return (
    <section className={`${css.page} ${
      page === 'library' ? css.libraryPage : page === 'capabilities' ? css.capabilitiesPage : ''
    }`}>
      <header className={css.header}>
        <div>
          {page !== 'library' && page !== 'capabilities' && <span className={css.eyebrow}>{t('workbench')}</span>}
          <h1>{t(props.initialTemplates === false && page === 'capabilities' ? tab : page)}</h1>
          <p>{t(`${page}Intro`)}</p>
        </div>
        <div className={css.actions}>
          {page !== 'library' && (
            <>
              <Button
                onClick={() => {
                  if (data)
                    saveDownload(
                      'workbench.json',
                      new Blob([JSON.stringify(data, null, 2)], {
                        type: 'application/json',
                      }),
                    )
                }}
              >
                {t('export')}
              </Button>
              <label className={css.import}>
                {t('import')}
                <input
                  type="file"
                  accept="application/json"
                  disabled={busy || !form.writable}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void perform(async () => props.importData(await file.text()))
                    event.target.value = ''
                  }}
                />
              </label>
            </>
          )}
          <Button
            className={page === 'library' ? css.libraryRefresh : undefined}
            icon={page === 'library' ? <IconRefreshOutlineRegular size={18} /> : undefined}
            onClick={() => {
              if (page === 'library') void props.loadLibrary()
              else void props.load()
              if (selectedSession) void props.files(selectedSession.id, path)
            }}
          >
            {t('refresh')}
          </Button>
        </div>
      </header>
      {visibleError && !editing && !deleting && (
        <p role="alert" className={css.error}>
          {t(visibleError)}
        </p>
      )}
      {page !== 'library' && !data && <p role="status">{t('notConfigured')}</p>}
      {page !== 'library' && (
        <div className={css.toolbar}>
          {page === 'experts' && props.initialTemplates !== false && (
            <nav aria-label={t('experts')}>
              {(['experts', 'teams'] as const).map(k => (
                <Button
                  key={k}
                  aria-pressed={tab === k}
                  onClick={() => {
                    setTab(k)
                  }}
                >
                  {t(k === 'experts' ? 'myExperts' : 'teams')}
                </Button>
              ))}
            </nav>
          )}
          {page === 'capabilities' && props.initialTemplates !== false && (
            <nav aria-label={t('capabilities')}>
              <Button
                aria-pressed={templates}
                onClick={() => {
                  setTemplates(true)
                }}
              >
                {t('templates')}
              </Button>
              {(['skills', 'connectors'] as const).map(k => (
                <Button
                  key={k}
                  aria-pressed={!templates && tab === k}
                  onClick={() => {
                    setTemplates(false)
                    setTab(k)
                  }}
                >
                  {t(k)}
                </Button>
              ))}
            </nav>
          )}
          <Input
            className={`${page === 'capabilities' ? css.capabilitySearch : ''}`}
            icon={page === 'capabilities' ? <IconSearchOutlineRegular size={16} /> : undefined}
            aria-label={t('search')}
            placeholder={t('search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
            }}
          />
          {page !== 'assistants' && !(page === 'capabilities' && (templates || tab === 'connectors')) && (
            <Button
              variant="primary"
              disabled={!data || !form.writable}
              onClick={() => {
                begin(kind)
              }}
            >
              {t('create')}
            </Button>
          )}
        </div>
      )}
      {page === 'library' ? (
        <section className={css.libraryPanel} aria-label={t('libraryCollection')}>
          <div className={css.collectionHeader}>
            <h2>
              <IconFolderOpenOutlineRegular size={24} />
              {t('libraryCollection')}
            </h2>
            <span className={css.collectionStats}>
              {t('libraryStats', {
                sessions: workspaceSessions.length,
                files: fileCount,
              })}
            </span>
          </div>
          <div className={css.libraryControls}>
            <div className={css.librarySearch}>
              <IconSearchOutlineRegular size={20} />
              <Input
                aria-label={t('librarySearch')}
                placeholder={t('librarySearch')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                }}
              />
            </div>
            <select
              aria-label={t('session')}
              value={session ?? ''}
              onChange={(event) => {
                const row = sessions.find(item => item.id === event.target.value)
                if (row) browse(row.id, '')
              }}
            >
              <option value="">{t('session')}</option>
              {sessions.map(row => (
                <option key={row.id} value={row.id}>
                  {row.displayTitle}
                </option>
              ))}
            </select>
          </div>
          <nav className={css.libraryTabs} aria-label={t('allFiles')}>
            {(['allFiles', 'images', 'documents', 'videos', 'audio', 'other'] as const).map(key => (
              <Button
                key={key}
                aria-pressed={filter === key}
                onClick={() => {
                  setFilter(key)
                }}
              >
                {t(key === 'allFiles' ? 'libraryAll' : key)}
              </Button>
            ))}
          </nav>
          {catalog.libraryAttributionIncomplete && (
            <p role="status" className={css.libraryNotice}>{t('libraryAttributionIncomplete')}</p>
          )}
          {session && (
            <div className={css.libraryBreadcrumb}>
              <Button
                disabled={!path || catalog.loading}
                onClick={() => {
                  if (session) browse(session, path.split('/').slice(0, -1).join('/'))
                }}
              >
                {t('parent')}
              </Button>
              <span>{path || t('root')}</span>
            </div>
          )}
          <div className={css.libraryBody}>
            {catalog.loading || catalog.libraryLoading ? (
              <div className={css.libraryEmpty} role="status" aria-label={t('libraryLoading')}>
                <IconLoadingOutlineRegular size={28} className={css.librarySpinner} />
              </div>
            ) : !session || !hasShownEntries ? (
              <div className={css.libraryEmpty}>
                <div className={css.emptyArtwork} aria-hidden="true">
                  <div className={css.emptyPaper}>
                    <i />
                    <i />
                    <i />
                  </div>
                  <IconFolderOpenRegular size={108} />
                  <IconNewChatOutlineRegular className={css.emptyBubble} size={34} />
                </div>
                <p>
                  {t(
                    !session
                      ? sessions.length
                        ? 'libraryChoose'
                        : 'libraryEmpty'
                      : query || filter !== 'allFiles'
                        ? 'noResults'
                        : 'libraryEmpty',
                  )}
                </p>
              </div>
            ) : (
              <div className={css.libraryGroups}>
                {shownDirectories.length > 0 && (
                  <section className={css.libraryGroup} aria-labelledby="library-folders-heading">
                    <h3 id="library-folders-heading">{t('libraryFolders')}</h3>
                    {renderLibraryEntries(shownDirectories, session)}
                  </section>
                )}
                {attributedGroups.map(group => (
                  <section className={css.libraryGroup} key={group.session.id}
                    aria-labelledby={`library-session-${group.session.id}`}>
                    <h3 id={`library-session-${group.session.id}`}>{group.session.displayTitle}</h3>
                    {renderLibraryEntries(group.entries, group.session.id)}
                  </section>
                ))}
                {unassignedFiles.length > 0 && (
                  <section className={css.libraryGroup} aria-labelledby="library-unassigned-heading">
                    <h3 id="library-unassigned-heading">{t('libraryUnassigned')}</h3>
                    {renderLibraryEntries(unassignedFiles, session)}
                  </section>
                )}
              </div>
            )}
            {session && catalog.files?.truncated && <p>{t('truncated')}</p>}
          </div>
          <p className={css.libraryFootnote}>{t('libraryFootnote')}</p>
        </section>
      ) : page === 'capabilities' && !templates && tab === 'connectors' ? (
        <Connectors t={t} data={data?.connectors ?? []} query={query} writable={form.writable && data !== undefined}
          revision={form.revision} save={props.save} notify={props.actions.show} saveCredentials={props.saveConnectorCredentials}
          editCustom={(row) => { begin('connectors', row) }} remove={(row) => { setDeleting({ kind: 'connectors', entity: row }) }} />
      ) : page === 'capabilities' && templates ? (
        <div className={css.templateGrid} data-expert-templates>
          {EXPERT_TEMPLATES.filter(matches).map((expert) => {
            const installed = data?.experts.some(row => row.slug === expert.slug) ?? false
            return (
              <article className={`${cardStyles.surface} ${cardStyles.catalogSurface} ${css.templateCard}`} key={expert.slug}>
                <header className={css.templateHeader}>
                  <span className={css.templateAvatar} aria-hidden="true">
                    <img src={expertAvatars[expert.slug]} alt="" />
                  </span>
                  <div className={css.templateIdentity}>
                    <h2>{expert.name}</h2>
                    <span className={css.templateId}>{t('agentId')} <code>{expert.slug}</code></span>
                  </div>
                </header>
                <p className={css.templateDescription}>{expert.description}</p>
                <footer className={css.templateFooter}>
                  <span className={css.templateBadge}>{t('agentTemplate')}</span>
                  <Button
                    variant="outline"
                    disabled={!form.writable || busy || installed}
                    onClick={() => {
                      void perform(() => props.save('experts', structuredClone(expert), undefined, form.revision))
                    }}
                  >
                    {installed ? null : <IconPlusOutlineRegular size={16} />}
                    {t(installed ? 'installed' : 'useTemplate')}
                    {installed ? null : <IconChevronRightOutlineRegular size={16} />}
                  </Button>
                </footer>
              </article>
            )
          })}
        </div>
      ) : (
        <>
          {showingSkills && <BuiltinSkills t={t} query={query} />}
          <section aria-label={showingSkills ? t('mySkills') : undefined}>
            {showingSkills && (
              <div className={css.skillSectionHeader}>
                <h2>{t('mySkills')}</h2>
              </div>
            )}
            <div className={showingSkills ? css.skillGrid : css.grid}>
              {rows.filter(matches).map((row) => {
                const roster = catalog.roster.find(preset => preset.id === `workbench-${row.slug}`)
                return (
                  <article className={`${cardStyles.surface} ${cardStyles.catalogSurface} ${css.card} ${showingSkills ? css.skillCard : ''}`} key={row.slug}>
                    <div className={showingSkills ? css.skillCardHeader : css.cardtop}>
                      {showingSkills ? (
                        <>
                          <span className={css.skillIcon} aria-hidden="true"><IconAppsAddOutlineRegular size={26} /></span>
                          <div className={css.skillIdentity}>
                            <h2 className={css.skillTitle}>{row.name}</h2>
                            <span className={css.skillBadge}>/{row.slug}</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className={css.avatar} aria-hidden="true">{row.name.slice(0, 1)}</span>
                          <div className={css.catalogIdentity}>
                            <h2>{row.name}</h2>
                            <small>
                              {'members' in row
                                ? t('teams')
                                : 'content' in row
                                  ? `/${row.slug}`
                                  : 'transport' in row
                                    ? row.transport
                                    : t('myExperts')}
                            </small>
                          </div>
                        </>
                      )}
                    </div>
                    <p className={showingSkills ? css.skillDescription : css.cardDescription}>
                      {'description' in row
                        ? row.description
                        : row.transport === 'stdio'
                          ? row.command
                          : row.url}
                    </p>
                    {'members' in row && (
                      <div className={css.tags}>
                        {row.members.map(slug => (
                          <span key={slug}>
                            {data?.experts.find(expert => expert.slug === slug)?.name ?? slug}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className={showingSkills ? css.skillFooter : css.cardactions}>
                      {(kind === 'experts' || kind === 'teams') && (
                        <Button
                          className={css.cardMainAction}
                          variant="primary"
                          icon={<IconNewChatOutlineRegular size={17} />}
                          disabled={roster === undefined || roster.broken !== undefined}
                          onClick={() => {
                            void Promise.resolve(props.start(row.slug)).catch(() => { setError('loadError') })
                          }}
                        >
                          {t('start')}
                        </Button>
                      )}
                      <Tooltip label={t('edit')}>
                        <Button
                          className={css.cardIconAction}
                          aria-label={t('edit')}
                          icon={<IconEditOutlineRegular size={20} />}
                          disabled={!form.writable}
                          onClick={() => {
                            begin(kind, row)
                          }}
                        >
                          {t('edit')}
                        </Button>
                      </Tooltip>
                      {page !== 'assistants' && (
                        <Tooltip label={t('remove')}>
                          <Button
                            className={css.cardIconAction}
                            aria-label={t('remove')}
                            icon={<IconTrashOutlineRegular size={20} />}
                            disabled={!form.writable}
                            onClick={() => {
                              setDeleting({ kind, entity: row })
                              setError(null)
                            }}
                          >
                            {t('remove')}
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                    {roster?.broken !== undefined && <p className={css.error}>{t('unavailable')}</p>}
                  </article>
                )
              })}
              {!rows.filter(matches).length && (
                <p className={css.empty}>{t(query ? 'noResults' : 'noItems')}</p>
              )}
            </div>
          </section>
        </>
      )}
      <Modal
        open={editing !== null}
        {...(editing?.kind === 'skills' ? { className: css.skillModal } : {})}
        onClose={() => {
          if (!busy) setEditing(null)
        }}
        title={editing?.kind === 'skills' && editing.original === undefined ? t('newSkill') : t('editItem')}
        closeLabel={t('close')}
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setEditing(null)
              }}
            >
              {t('cancel')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={submit}>
              {t('save')}
            </Button>
          </>
        }
      >
        {edit && (
          <div className={editing.kind === 'skills' ? `${css.form} ${css.skillForm}` : css.form}>
            <label>
              {t('name')}
              <Input
                data-modal-autofocus
                value={edit.name}
                onChange={(e) => {
                  update({ name: e.target.value })
                }}
              />
            </label>
            <label>
              {t('slug')}
              <Input
                value={edit.slug}
                onChange={(e) => {
                  update({ slug: e.target.value })
                }}
              />
            </label>
            {'description' in edit && (
              <label>
                {t('description')}
                <Input
                  value={edit.description}
                  onChange={(e) => {
                    update({ description: e.target.value })
                  }}
                />
              </label>
            )}
            {'instructions' in edit && (
              <label>
                {t('instructions')}
                <textarea
                  rows={6}
                  value={edit.instructions}
                  onChange={(e) => {
                    update({ instructions: e.target.value })
                  }}
                />
              </label>
            )}
            {'content' in edit && (
              <>
                <p>{t('skillHint')}</p>
                <label>
                  {t('skillContent')}
                  <textarea
                    rows={14}
                    value={edit.content}
                    placeholder={editing.original === undefined ? t('skillExample') : undefined}
                    onChange={(e) => {
                      update({ content: e.target.value })
                    }}
                  />
                </label>
              </>
            )}
            {choices('skills', data?.skills ?? [])}
            {choices('connectors', data?.connectors ?? [])}
            {choices('members', data?.experts ?? [])}
            {'members' in edit && <p>{t('teamHint')}</p>}
            {'transport' in edit && (
              <>
                <p>{t('connectorHint')}</p>
                <label>
                  {t('transport')}
                  <select
                    aria-label={t('transport')}
                    value={edit.transport}
                    onChange={(e) => {
                      update({
                        transport: e.target.value === 'stdio' ? 'stdio' : 'streamable-http',
                      })
                    }}
                  >
                    <option value="streamable-http">{t('http')}</option>
                    <option value="stdio">{t('stdio')}</option>
                  </select>
                </label>
                {edit.transport === 'streamable-http' ? (
                  <label>
                    {t('url')}
                    <Input
                      value={edit.url}
                      onChange={(e) => {
                        update({ url: e.target.value })
                      }}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      {t('command')}
                      <Input
                        value={edit.command}
                        onChange={(e) => {
                          update({ command: e.target.value })
                        }}
                      />
                    </label>
                    <label>
                      {t('args')}
                      <textarea
                        value={args}
                        onChange={(e) => {
                          setArgs(e.target.value)
                        }}
                      />
                    </label>
                  </>
                )}
                <label className={css.check}>
                  <input
                    type="checkbox"
                    checked={edit.enabled}
                    onChange={(e) => {
                      update({ enabled: e.target.checked })
                    }}
                  />
                  {t('enabled')}
                </label>
              </>
            )}
            {error && (
              <p role="alert" className={css.error}>
                {t(error)}
              </p>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={deleting !== null}
        onClose={() => {
          if (!busy) setDeleting(null)
        }}
        title={t('confirmRemove')}
        closeLabel={t('close')}
        footer={
          <>
            <Button
              disabled={busy}
              onClick={() => {
                setDeleting(null)
              }}
            >
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                if (deleting)
                  void perform(
                    () => props.remove(deleting.kind, deleting.entity.slug),
                    () => {
                      setDeleting(null)
                    },
                  )
              }}
            >
              {t('remove')}
            </Button>
          </>
        }
      >
        <p>{deleting?.entity.name}</p>
        <p>{t('removeHint')}</p>
        {error && (
          <p role="alert" className={css.error}>
            {t(error)}
          </p>
        )}
      </Modal>
    </section>
  )
}
/** Sidebar icon using the established icon set.
 * @param props Sidebar icon seat.
 * @returns Expert icon.
 */
export function WorkbenchIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <IconUsersOutlineRegular size={props.size} />
}

/** Assistant navigation icon.
 * @param props Sidebar icon seat.
 * @returns User icon.
 */
export function AssistantIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <IconUserOutlineRegular size={props.size} />
}
/** Capability navigation icon.
 * @param props Sidebar icon seat.
 * @returns Capability icon.
 */
export function CapabilityIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <IconAppsAddOutlineRegular size={props.size} />
}
/** File library navigation icon.
 * @param props Sidebar icon seat.
 * @returns Folder icon.
 */
export function LibraryIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <IconFolderOpenOutlineRegular size={props.size} />
}
