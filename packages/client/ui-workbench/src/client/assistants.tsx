/** Assistant catalog and one revision-fenced creation and editing wizard. */
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  writeClipboard,
  Input,
  Modal,
  Tooltip,
  IconCloseOutlineRegular,
  IconInfoOutlineRegular,
  IconThinkOutlineRegular,
  IconCordisPluginOutlineRegular,
  IconChecklistOutlineRegular,
  Switch,
  IconUsersOutlineRegular,
  IconUserOutlineRegular,
  IconAppsAddOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  IconPlusOutlineRegular,
  IconCopyOutlineRegular,
  IconDownloadOutlineRegular,
  IconEditOutlineRegular,
  IconTrashOutlineRegular,
  IconNewChatOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Expert, ExpertCategory } from '../types.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { resolveExpert } from '../expert.ts'
import { EXPERT_TEMPLATES } from '../defaults.ts'
import type { WorkbenchFace } from './page.tsx'
import type { WorkbenchKey } from './locales.ts'
import type { createAssistantNoticeStore } from './assistant-notice.tsx'
import { saveDownload } from './controller.ts'
import css from './assistants.module.css'

type Props = PropsRuntime<'main'> &
  PropsLocale<'workbench'> &
  InjectFace<WorkbenchFace> &
  PropsStore<ReturnType<typeof createAssistantNoticeStore>>
type WizardStep = 0 | 1 | 2 | 3 | 4
type Editor = {
  draft: Expert
  original: string | undefined
  revision: number | undefined
  step: WizardStep
  generatedSlug: string
  templateName: string | undefined
}
const categories: readonly [ExpertCategory, WorkbenchKey][] = [
  ['enterprise', 'enterpriseAgents'],
  ['personal', 'personalAgents'],
  ['builtin', 'builtinAgents'],
]
const steps = ['agentBasics', 'agentInstructions', 'skills', 'connectors', 'agentReview'] as const

/** Render real profile agents with personal creation, template copying and activation controls.
 * @param props Slot-provided configuration, registry diagnostics and commands.
 * @returns Assistant catalog, page editor and deletion dialog.
 */
export function AssistantsPage(props: Props) {
  const { t } = props
  const form = props.useForm(state => state)
  const catalog = props.useCatalog(state => state)
  const [category, setCategory] = useState<ExpertCategory>('personal')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleting, setDeleting] = useState<Expert | null>(null)
  const [error, setError] = useState<WorkbenchKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const instructionField = useRef<HTMLTextAreaElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const editorScroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (editor?.step !== undefined) {
      stepHeading.current?.focus()
      editorScroll.current?.scrollTo({ top: 0 })
    } else if (returnFocus.current !== null) {
      returnFocus.current.focus()
      returnFocus.current = null
    }
  }, [editor?.step])
  useEffect(() => {
    void props.load()
  }, [props.load])
  const agents = (form.value?.experts ?? []).map(resolveExpert)
  const builtin = [
    ...EXPERT_TEMPLATES.map(
      template =>
        agents.find(agent => agent.slug === template.slug && agent.category === 'builtin') ??
        resolveExpert({ ...template, category: 'builtin', enabled: true }),
    ),
    ...agents.filter(
      agent =>
        agent.category === 'builtin' && !EXPERT_TEMPLATES.some(template => template.slug === agent.slug),
    ),
  ]
  const rows = (category === 'builtin' ? builtin : agents).filter(
    agent =>
      agent.category === category &&
      `${agent.name} ${agent.description} ${agent.slug}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  )
  const canWrite = form.writable && !busy
  const newId = () => {
    let slug: string
    do {
      slug = `agent-${randomUUID().slice(0, 8)}`
    } while (
      agents.some(agent => agent.slug === slug) ||
      form.value?.teams.some(team => team.slug === slug)
    )
    return slug
  }
  const begin = (source?: Expert, editing = false) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const generatedSlug = editing && source ? source.slug : newId()
    const draft: Expert =
      source === undefined
        ? {
          slug: '',
          name: '',
          description: '',
          instructions: '',
          skills: [],
          connectors: [],
          category: 'personal',
          enabled: true,
        }
        : {
          ...structuredClone(source),
          slug: editing ? source.slug : '',
          name: editing ? source.name : t('agentCopyName', { name: source.name }),
          category: 'personal',
          enabled: editing ? resolveExpert(source).enabled : true,
        }
    setEditor({
      draft,
      original: editing ? source?.slug : undefined,
      revision: form.revision,
      step: 0,
      generatedSlug,
      templateName: editing ? undefined : source?.name,
    })
    setError(null)
  }
  const update = (patch: Partial<Expert>) => {
    if (editor) setEditor({ ...editor, draft: { ...editor.draft, ...patch } })
    setError(null)
  }
  const validate = (step: number): boolean => {
    if (!editor) return false
    const slug = editor.draft.slug.trim() || editor.generatedSlug
    if (step === 0 && !editor.draft.name.trim()) {
      setError('agentNameRequired')
      nameField.current?.focus()
      return false
    }
    if (step === 0 && !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(slug)) {
      setError('invalid')
      return false
    }
    if (
      step === 0 &&
      (agents.some(agent => agent.slug === slug && agent.slug !== editor.original) ||
        form.value?.teams.some(team => team.slug === slug))
    ) {
      setError('duplicate')
      return false
    }
    if (step === 1 && !editor.draft.instructions.trim()) {
      setError('agentInstructionsRequired')
      instructionField.current?.focus()
      return false
    }
    return true
  }
  const advance = () => {
    if (editor && validate(editor.step)) {
      setError(null)
      setEditor({ ...editor, step: ([1, 2, 3, 4, 4] as const)[editor.step] })
    }
  }
  const submit = async () => {
    if (!editor || busy) return
    for (const step of [0, 1] as const) {
      if (!validate(step)) {
        setEditor({ ...editor, step })
        return
      }
    }
    setBusy(true)
    const draft = {
      ...editor.draft,
      slug: editor.draft.slug.trim() || editor.generatedSlug,
      name: editor.draft.name.trim(),
      description: editor.draft.description.trim(),
      instructions: editor.draft.instructions.trim(),
    }
    const result = await props.save('experts', draft, editor.original, editor.revision)
    setBusy(false)
    if (result) {
      setError(result)
      return
    }
    setEditor(null)
    setCategory('personal')
    setQuery('')
    setHighlight(draft.slug)
    props.actions.show('agentSaved', true)
  }
  const action = async (run: () => Promise<WorkbenchKey | null>, success: WorkbenchKey) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await run()
      props.actions.show(result ?? success, result === null)
    } catch (_error) {
      props.actions.show('saveError', false)
    } finally {
      setBusy(false)
    }
  }
  const exportAgent = (agent: Expert) => {
    const data = form.value
    if (!data) return
    const payload = {
      experts: [agent],
      teams: [],
      skills: data.skills.filter(skill => agent.skills.includes(skill.slug)),
      connectors: data.connectors.filter(connector => agent.connectors.includes(connector.slug)),
    }
    saveDownload(
      `${agent.slug}.json`,
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    )
    props.actions.show('agentExported', true)
  }
  const closeEditor = () => {
    if (!busy) {
      setEditor(null)
      setError(null)
    }
  }
  const selectStep = (step: WizardStep) => {
    if (!editor || busy) return
    if (step > editor.step) {
      for (const required of [0, 1] as const) {
        if (required >= step) break
        if (!validate(required)) {
          setEditor({ ...editor, step: required })
          return
        }
      }
    }
    setError(null)
    setEditor({ ...editor, step })
  }
  const draft = editor?.draft
  const resolvedId = draft?.slug.trim() || editor?.generatedSlug || ''
  return (
    <>
      {editor && draft && (
        <section
          className={css.editorPage}
          role="region"
          aria-label={t(editor.original === undefined ? 'newAgent' : 'editAgent')}
          data-agent-editor
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.stopPropagation()
              closeEditor()
            }
          }}
        >
          <header className={css.editorHeader} data-agent-editor-header>
            <Tooltip label={t('agentCloseDraft')}>
              <Button
                className={css.editorClose}
                aria-label={t('agentCloseDraft')}
                disabled={busy}
                icon={<IconCloseOutlineRegular size={24} />}
                onClick={closeEditor}
              />
            </Tooltip>
            <h1>
              {editor.original !== undefined
                ? t('editAgent')
                : editor.templateName
                  ? t('agentCreateFromTemplate', { name: editor.templateName })
                  : t('newAgent')}
            </h1>
          </header>
          <div className={css.editorBody}>
            <nav className={css.steps} aria-label={t('agentCreationSteps')}>
              {steps.map((key, index) => {
                const step = ([0, 1, 2, 3, 4] as const)[index]
                const Icon =
                  key === 'agentBasics'
                    ? IconInfoOutlineRegular
                    : key === 'agentInstructions'
                      ? IconThinkOutlineRegular
                      : key === 'skills'
                        ? IconAppsAddOutlineRegular
                        : key === 'connectors'
                          ? IconCordisPluginOutlineRegular
                          : IconChecklistOutlineRegular
                return (
                  <button
                    key={key}
                    aria-label={t(key)}
                    aria-current={editor.step === index ? 'step' : undefined}
                    disabled={busy}
                    onClick={() => {
                      if (step !== undefined) selectStep(step)
                    }}
                  >
                    <Icon size={20} />
                    <span>{t(key)}</span>
                  </button>
                )
              })}
            </nav>
            <div className={css.editorScroll} ref={editorScroll} data-agent-editor-scroll>
              <div className={css.form}>
                <h2
                  className={editor.step === 0 ? css.screenReaderHeading : css.editorSectionTitle}
                  ref={stepHeading}
                  tabIndex={-1}
                >
                  {t(steps[editor.step])}
                </h2>
                {error && (
                  <p className={css.formError} role="alert">
                    {t(error)}
                  </p>
                )}
                {editor.step === 0 && (
                  <>
                    {editor.templateName && (
                      <p className={css.templateNotice}>
                        <IconInfoOutlineRegular size={18} />
                        {t('agentSelectedTemplate', { name: editor.templateName })}
                      </p>
                    )}
                    <div className={css.editorProfile}>
                      <div className={css.editorAvatar} aria-hidden="true">
                        {Array.from(draft.name.trim())[0] ?? <IconUserOutlineRegular size={32} />}
                      </div>
                      <div>
                        <strong>{t('agentProfile')}</strong>
                        <p className={css.hint}>{t('agentProfileHint')}</p>
                      </div>
                    </div>
                    <div className={css.basicFields}>
                      <label>
                        {t('name')}
                        <Input
                          ref={nameField}
                          aria-label={t('name')}
                          aria-required="true"
                          maxLength={120}
                          value={draft.name}
                          onChange={(event) =>{  update({ name: event.target.value }) }}
                        />
                      </label>
                      <label>
                        {t(editor.original === undefined ? 'agentOptionalId' : 'agentId')}
                        <Input
                          aria-label={t('agentId')}
                          placeholder={t('agentIdPlaceholder')}
                          maxLength={32}
                          value={draft.slug}
                          readOnly={editor.original !== undefined}
                          onChange={(event) =>{  update({ slug: event.target.value }) }}
                        />
                        <span className={css.hint}>
                          {t(editor.original === undefined ? 'agentOptionalIdHint' : 'agentIdHint')}
                        </span>
                      </label>
                      <label className={css.fullField}>
                        {t('description')}
                        <textarea
                          aria-label={t('description')}
                          rows={4}
                          maxLength={65536}
                          value={draft.description}
                          onChange={(event) =>{  update({ description: event.target.value }) }}
                        />
                      </label>
                    </div>
                  </>
                )}
                {editor.step === 1 && (
                  <>
                    <label>
                      {t('instructions')}
                      <textarea
                        ref={instructionField}
                        aria-label={t('instructions')}
                        rows={10}
                        maxLength={65536}
                        value={draft.instructions}
                        onChange={(event) => {
                          update({ instructions: event.target.value })
                        }}
                      />
                    </label>
                    <p className={css.hint}>{t('agentRuntimeHint')}</p>
                  </>
                )}
                {(editor.step === 2 || editor.step === 3) && (
                  <>
                    <p className={css.hint}>
                      {t(editor.step === 2 ? 'agentSkillHint' : 'agentConnectorHint')}
                    </p>
                    {(editor.step === 2 ? form.value?.skills : form.value?.connectors)?.length === 0 && (
                      <div className={css.selectionEmpty}>{t('agentCapabilitiesEmpty')}</div>
                    )}
                    {(editor.step === 2 ? form.value?.skills : form.value?.connectors)?.map((item) => {
                      const field = editor.step === 2 ? 'skills' : 'connectors'
                      return (
                        <label className={css.option} key={item.slug}>
                          <input
                            type="checkbox"
                            checked={draft[field].includes(item.slug)}
                            onChange={(event) => {
                              update({
                                [field]: event.target.checked
                                  ? [...draft[field], item.slug]
                                  : draft[field].filter(slug => slug !== item.slug),
                              })
                            }}
                          />
                          <span>
                            <strong>{item.name}</strong>
                            <small>
                              {'description' in item
                                ? item.description
                                : t(item.transport === 'stdio' ? 'stdio' : 'http')}
                            </small>
                            {'enabled' in item && !item.enabled && (
                              <small>{t('agentConnectorDisabled')}</small>
                            )}
                          </span>
                        </label>
                      )
                    })}
                  </>
                )}
                {editor.step === 4 && (
                  <>
                    <div className={css.summary}>
                      <h2>{draft.name}</h2>
                      <p>{draft.description || t('agentNoDescription')}</p>
                      <dl>
                        <dt>{t('agentId')}</dt>
                        <dd>{resolvedId}</dd>
                        <dt>{t('instructions')}</dt>
                        <dd className={css.instructionPreview}>{draft.instructions}</dd>
                        <dt>{t('skills')}</dt>
                        <dd>
                          {draft.skills
                            .map(slug => form.value?.skills.find(skill => skill.slug === slug)?.name)
                            .join('、') || t('agentNone')}
                        </dd>
                        <dt>{t('connectors')}</dt>
                        <dd>
                          {draft.connectors
                            .map(
                              slug =>
                                form.value?.connectors.find(connector => connector.slug === slug)?.name,
                            )
                            .join('、') || t('agentNone')}
                        </dd>
                      </dl>
                    </div>
                    <label className={css.option}>
                      <input
                        type="checkbox"
                        checked={resolveExpert(draft).enabled}
                        onChange={(event) => {
                          update({ enabled: event.target.checked })
                        }}
                      />
                      {t('agentEnableAfterSave')}
                    </label>
                    <p className={css.hint}>{t('agentRuntimeHint')}</p>
                  </>
                )}
              </div>
            </div>
          </div>
          <footer className={css.wizardFooter} data-agent-editor-footer>
            <span>{t('agentStep', { step: String(editor.step + 1), total: String(steps.length) })}</span>
            <Button variant="outline" disabled={busy} onClick={closeEditor}>
              {t('cancel')}
            </Button>
            {editor.step > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>{  selectStep(([0, 0, 1, 2, 3] as const)[editor.step]) }}
              >
                {t('agentBack')}
              </Button>
            )}
            {editor.step < steps.length - 1 ? (
              <Button variant="primary" disabled={busy} onClick={advance}>
                {t('agentNext')}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={!canWrite}
                onClick={() => {
                  void submit()
                }}
              >
                {t(editor.original === undefined ? 'agentCreate' : 'save')}
              </Button>
            )}
          </footer>
        </section>
      )}
      <div className={css.page} hidden={editor !== null}>
        <header className={css.header}>
          <h1>{t('assistants')}</h1>
          <p>{t('agentIntro')}</p>
        </header>
        <section className={css.panel} aria-label={t('agentCatalog')}>
          <div className={css.tabs} role="tablist" aria-label={t('agentCategories')}>
            {categories.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={category === key}
                onClick={() => {
                  setCategory(key)
                  setQuery('')
                  setHighlight(null)
                }}
              >
                {key === 'enterprise' ? (
                  <IconUsersOutlineRegular size={20} />
                ) : key === 'personal' ? (
                  <IconUserOutlineRegular size={20} />
                ) : (
                  <IconAppsAddOutlineRegular size={20} />
                )}
                {t(label)}
              </button>
            ))}
          </div>
          <div className={css.toolbar}>
            <span className={css.count}>{t('agentCount', { count: String(rows.length) })}</span>
            <Input
              className={`${css.search}`}
              icon={<IconSearchOutlineRegular size={18} />}
              aria-label={t('agentSearch')}
              placeholder={t('agentSearch')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
            />
            <div className={css.viewSwitch} role="group" aria-label={t('agentView')}>
              <Button
                aria-pressed={view === 'cards'}
                onClick={() => {
                  setView('cards')
                }}
              >
                {t('agentCards')}
              </Button>
              <Button
                aria-pressed={view === 'table'}
                onClick={() => {
                  setView('table')
                }}
              >
                {t('agentTable')}
              </Button>
            </div>
            <Button
              variant="outline"
              icon={<IconRefreshOutlineRegular size={18} />}
              disabled={busy}
              onClick={() => {
                void props.load()
              }}
            >
              {t('refresh')}
            </Button>
            {category !== 'enterprise' && (
              <>
                <Button
                  variant="primary"
                  icon={<IconPlusOutlineRegular size={18} />}
                  disabled={!canWrite}
                  onClick={() => {
                    begin()
                  }}
                >
                  {t('newAgent')}
                </Button>
                <Button
                  variant="outline"
                  disabled={!canWrite}
                  onClick={() => {
                    setCategory('builtin')
                    setQuery('')
                  }}
                >
                  {t('agentFromBuiltin')}
                </Button>
              </>
            )}
          </div>
          {catalog.error && (
            <div className={css.notice} role="alert">
              {t(catalog.error)}
              <Button
                onClick={() => {
                  void props.load()
                }}
              >
                {t('refresh')}
              </Button>
            </div>
          )}
          {form.value === undefined ? (
            <div className={css.empty} role="status">
              {t('notConfigured')}
            </div>
          ) : rows.length === 0 ? (
            <div className={css.empty}>
              <IconUserOutlineRegular size={52} />
              <h2>
                {t(
                  query
                    ? 'noResults'
                    : category === 'enterprise'
                      ? 'enterpriseEmpty'
                      : category === 'personal'
                        ? 'personalEmpty'
                        : 'noItems',
                )}
              </h2>
              <p>{t(category === 'enterprise' ? 'enterpriseHint' : 'agentEmptyHint')}</p>
              {category === 'personal' && (
                <Button
                  variant="primary"
                  disabled={!canWrite}
                  onClick={() => {
                    begin()
                  }}
                >
                  {t('agentFirst')}
                </Button>
              )}
            </div>
          ) : (
            <div
              className={view === 'cards' ? css.grid : css.table}
              data-agent-view={view}
              role={view === 'table' ? 'table' : undefined}
            >
              {view === 'table' && (
                <div className={css.tableHeader} role="row">
                  <span role="columnheader">{t('name')}</span>
                  <span role="columnheader">{t('description')}</span>
                  <span role="columnheader">{t('agentActions')}</span>
                </div>
              )}
              {rows.map((agent) => {
                const roster = catalog.roster.find(row => row.id === `workbench-${agent.slug}`)
                const saved = agents.some(
                  item => item.slug === agent.slug && item.category === agent.category,
                )
                const ready = saved && agent.enabled && roster !== undefined && !roster.broken
                const editable = agent.category === 'personal'
                return (
                  <article
                    className={`${css.card} ${highlight === agent.slug ? css.highlight : ''}`}
                    key={agent.slug}
                    role={view === 'table' ? 'row' : undefined}
                  >
                    <div className={css.cardHeader} role={view === 'table' ? 'cell' : undefined}>
                      <div className={css.avatar} aria-hidden="true">
                        {Array.from(agent.name)[0]}
                      </div>
                      <div className={css.identity}>
                        <h2>{agent.name}</h2>
                        <div className={css.identifier}>
                          <span>{t('agentIdentifier', { id: agent.slug })}</span>
                          <Button
                            size="sm"
                            aria-label={t('agentCopyId')}
                            onClick={() => {
                              void writeClipboard(agent.slug).then((accepted) => {
                                props.actions.show(accepted ? 'agentIdCopied' : 'agentCopyFailed', accepted)
                              })
                            }}
                          >
                            <IconCopyOutlineRegular size={14} />
                            {t('agentCopyId')}
                          </Button>
                        </div>
                        <div className={css.badges}>
                          <span className={ready ? css.ready : css.status}>
                            {t(
                              !saved
                                ? 'agentTemplate'
                                : !agent.enabled
                                  ? 'agentDisabled'
                                  : ready
                                    ? 'ready'
                                    : roster?.broken
                                      ? 'unavailable'
                                      : 'configuring',
                            )}
                          </span>
                          {saved && roster?.isDefault && (
                            <span className={css.status}>{t('agentDefault')}</span>
                          )}
                        </div>
                      </div>
                      {editable && (
                        <Switch
                          label={t('agentEnable')}
                          checked={agent.enabled}
                          disabled={!canWrite || roster?.isDefault === true}
                          onChange={(enabled) => {
                            void action(
                              () => props.setEnabled(agent.slug, enabled, form.revision),
                              enabled ? 'agentEnabled' : 'agentDisabled',
                            )
                          }}
                        />
                      )}
                    </div>
                    <p className={css.description} role={view === 'table' ? 'cell' : undefined}>
                      {agent.description || t('agentNoDescription')}
                    </p>
                    <div className={css.cardFooter} role={view === 'table' ? 'cell' : undefined}>
                      <div className={css.cardActions}>
                        {editable ? (
                          <>
                            <Button
                              size="sm"
                              icon={<IconEditOutlineRegular size={16} />}
                              disabled={!canWrite}
                              onClick={() => {
                                begin(agent, true)
                              }}
                            >
                              {t('edit')}
                            </Button>
                            <Button
                              size="sm"
                              icon={<IconCopyOutlineRegular size={16} />}
                              disabled={!canWrite}
                              onClick={() => {
                                begin(agent)
                              }}
                            >
                              {t('agentDuplicate')}
                            </Button>
                            <Button
                              size="sm"
                              icon={<IconDownloadOutlineRegular size={16} />}
                              onClick={() => {
                                exportAgent(agent)
                              }}
                            >
                              {t('agentExport')}
                            </Button>
                            <Button
                              size="sm"
                              icon={<IconTrashOutlineRegular size={16} />}
                              disabled={!canWrite || roster?.isDefault === true}
                              onClick={() => {
                                setDeleting(agent)
                                setError(null)
                              }}
                            >
                              {t('remove')}
                            </Button>
                          </>
                        ) : (
                          agent.category === 'builtin' && (
                            <Button
                              size="sm"
                              disabled={!canWrite}
                              onClick={() => {
                                begin(agent)
                              }}
                            >
                              {t('agentFromTemplate')}
                            </Button>
                          )
                        )}
                        {!roster?.isDefault && ready && (
                          <Button
                            size="sm"
                            disabled={!canWrite}
                            onClick={() => {
                              void action(() => props.setDefault(agent.slug), 'agentDefaultSaved')
                            }}
                          >
                            {t('agentMakeDefault')}
                          </Button>
                        )}
                      </div>
                      {saved && (
                        <Button
                          variant="outline"
                          icon={<IconNewChatOutlineRegular size={17} />}
                          disabled={!ready || busy}
                          onClick={() => {
                            props.start(agent.slug)
                          }}
                        >
                          {t('start')}
                        </Button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

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
                disabled={!canWrite}
                onClick={() => {
                  if (deleting)
                    void action(async () => {
                      const result = await props.remove('experts', deleting.slug)
                      if (!result) {
                        setDeleting(null)
                        await props.load()
                      }
                      return result
                    }, 'agentDeleted')
                }}
              >
                {t('remove')}
              </Button>
            </>
          }
        >
          <p>{deleting?.name}</p>
          <p>{t('removeHint')}</p>
        </Modal>
      </div>
    </>
  )
}
