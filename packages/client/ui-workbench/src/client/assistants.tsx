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
  IconFolderOpenOutlineRegular,
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
  IconShieldOutlineRegular,
  IconChevronRightOutlineRegular,
  IconPinOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Expert, ExpertCategory, WorkbenchSkill } from '../types.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { AGENT_TOOL_GROUPS } from '../agent-options.ts'
import { resolveExpert } from '../expert.ts'
import { EXPERT_TEMPLATES } from '../defaults.ts'
import type { WorkbenchFace } from './page.tsx'
import type { WorkbenchKey } from './locales.ts'
import type { createAssistantNoticeStore } from './assistant-notice.tsx'
import { saveDownload } from './controller.ts'
import cardStyles from './card.module.css'
import css from './assistants.module.css'
import { builtinSkills } from './builtin-skills.ts'
import { BUILTIN_SKILL_COPY } from './builtin-skill-copy.ts'
import { parseUploadedSkill } from './skill-upload.ts'
import jingworkAgent from './assets/jingwork-agent.png'

type Props = PropsRuntime<'main'> &
  PropsLocale<'workbench'> &
  InjectFace<WorkbenchFace> &
  PropsStore<ReturnType<typeof createAssistantNoticeStore>>
type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
type Editor = {
  generation: number
  draft: Expert
  importedSkills: WorkbenchSkill[]
  original: string | undefined
  revision: number | undefined
  step: WizardStep
  templateName: string | undefined
}
const categories: readonly [ExpertCategory, WorkbenchKey][] = [
  ['enterprise', 'enterpriseAgents'],
  ['personal', 'personalAgents'],
  ['builtin', 'builtinAgents'],
]
const steps = ['agentBasics', 'agentModelConfig', 'agentKnowledge', 'skills', 'connectors', 'agentTools', 'agentSubagents', 'agentReview'] as const

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
  const editorGeneration = useRef(0)
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
  const configuredAgents = (form.value?.experts ?? []).map(resolveExpert)
  const agents = catalog.enterprise === undefined ? configuredAgents : [
    ...configuredAgents.filter(agent => agent.category !== 'enterprise'),
    ...catalog.enterprise.map(resolveExpert),
  ]
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
  const editorSteps = steps
    .map((key, step) => ({ key, step: step as WizardStep }))
    .filter(({ key }) => editor?.original !== undefined || key !== 'connectors')
  const visibleStepIndex = editorSteps.findIndex(({ step }) => step === editor?.step)
  const systemSkills = builtinSkills().map((skill) => {
    const copy = BUILTIN_SKILL_COPY[skill.name]
    return {
      slug: skill.name,
      name: copy ? t(copy.nameKey) : skill.name,
      description: copy ? t(copy.descriptionKey) : skill.description,
      content: skill.content,
    }
  })
  const savedSkills = [...(form.value?.skills ?? []), ...(editor?.importedSkills ?? [])]
  const skillChoices = [
    ...systemSkills.map(skill => savedSkills.find(saved => saved.slug === skill.slug) ?? skill),
    ...savedSkills.filter(skill => !systemSkills.some(system => system.slug === skill.slug)),
  ]
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
    const slug = editing && source ? source.slug : newId()
    const draft: Expert =
      source === undefined
        ? {
          slug,
          name: t('agentDefaultName'),
          description: t('agentDefaultDescription'),
          instructions: t('agentDefaultInstructions'),
          welcomeMessage: t('agentDefaultWelcome'),
          color: '#EEEDFF',
          quickPrompts: [],
          tools: [...AGENT_TOOL_GROUPS],
          subagents: [],
          knowledge: '',
          skills: [],
          connectors: [],
          category: 'personal',
          enabled: true,
        }
        : {
          ...structuredClone(source),
          knowledge: resolveExpert(source).knowledge,
          slug,
          name: editing || source.category === 'builtin' ? source.name : t('agentCopyName', { name: source.name }),
          category: 'personal',
          enabled: editing ? resolveExpert(source).enabled : true,
        }
    setEditor({
      generation: ++editorGeneration.current,
      draft,
      importedSkills: [],
      original: editing ? source?.slug : undefined,
      revision: form.revision,
      step: 0,
      templateName: editing ? undefined : source?.name ?? t('agentDefaultName'),
    })
    setError(null)
  }
  const update = (patch: Partial<Expert>) => {
    if (editor) setEditor({ ...editor, draft: { ...editor.draft, ...patch } })
    setError(null)
  }
  const validate = (step: number): boolean => {
    if (!editor) return false
    const slug = editor.draft.slug
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
    if (step === 0 && editor.draft.quickPrompts?.some(card => !card.title.trim() || !card.prompt.trim())) { setError('agentCardRequired'); return false }
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
      const nextStep = editorSteps[visibleStepIndex + 1]?.step
      if (nextStep !== undefined) setEditor({ ...editor, step: nextStep })
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
      name: editor.draft.name.trim(),
      description: editor.draft.description.trim(),
      instructions: editor.draft.instructions.trim(),
    }
    const result = await props.save('experts', draft, editor.original, editor.revision,
      editor.importedSkills.filter(skill => draft.skills.includes(skill.slug)))
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
    const experts = [agent]
    const included = new Set([agent.slug])
    for (const selected of experts) {
      for (const child of data.experts.filter(row => selected.subagents?.includes(row.slug))) {
        if (included.has(child.slug)) continue
        included.add(child.slug)
        experts.push(child)
      }
    }
    const payload = {
      experts,
      teams: [],
      skills: data.skills.filter(skill => experts.some(expert => expert.skills.includes(skill.slug))),
      connectors: data.connectors.filter(connector => experts.some(expert => expert.connectors.includes(connector.slug))),
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
  return (
    <>
      {editor && draft && (
        <section
          className={css.editorPage}
          role="region"
          aria-label={t(editor.original === undefined ? 'newAgent' : 'editAgent')}
          data-agent-editor
          onKeyDown={(event) => {
            if (
              event.key === 'Escape' &&
              !event.defaultPrevented &&
              !event.nativeEvent.isComposing
            ) {
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
              {editorSteps.map(({ key, step }) => {
                const Icon =
                  key === 'agentBasics'
                    ? IconInfoOutlineRegular
                    : key === 'agentModelConfig'
                      ? IconThinkOutlineRegular
                      : key === 'skills'
                        ? IconAppsAddOutlineRegular
                        : key === 'agentKnowledge'
                          ? IconFolderOpenOutlineRegular
                          : key === 'connectors'
                            ? IconCordisPluginOutlineRegular
                            : IconChecklistOutlineRegular
                return (
                  <button
                    key={key}
                    aria-label={t(key)}
                    aria-current={editor.step === step ? 'step' : undefined}
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
                {editor.step === 2 ? (
                  <div className={css.knowledgeHeading}>
                    <h2 className={css.editorSectionTitle} ref={stepHeading} tabIndex={-1}>
                      {t(steps[editor.step])}
                    </h2>
                    <Button size="sm" variant="outline" onClick={() => { void props.load() }}>
                      <IconRefreshOutlineRegular size={16} />
                      {t('refresh')}
                    </Button>
                  </div>
                ) : (
                  <h2
                    className={editor.step === 0 ? css.screenReaderHeading : css.editorSectionTitle}
                    ref={stepHeading}
                    tabIndex={-1}
                  >
                    {t(steps[editor.step])}
                  </h2>
                )}
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
                      <div
                        className={css.editorAvatar}
                        style={{ backgroundColor: draft.color }}
                        aria-hidden="true"
                      >
                        {draft.avatar ? (
                          <img src={draft.avatar} alt="" />
                        ) : (
                          <img src={jingworkAgent} alt="" />
                        )}
                      </div>
                      <div>
                        <strong>{t('agentAvatar')}</strong>
                        <label className={css.avatarUpload}>
                          {t('agentChangeAvatar')}
                          <input
                            type="file"
                            className={css.screenReaderHeading}
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              event.target.value = ''
                              if (!file) return
                              if (
                                file.size > 5 * 1024 * 1024 ||
                                !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
                                  file.type,
                                )
                              ) {
                                setError('agentAvatarInvalid')
                                return
                              }
                              const reader = new FileReader()
                              reader.onload = () => {
                                const avatar = reader.result
                                if (typeof avatar === 'string')
                                  setEditor(current =>
                                    current?.generation === editor.generation
                                      ? { ...current, draft: { ...current.draft, avatar } }
                                      : current,
                                  )
                              }
                              reader.onerror = () => {
                                if (editorGeneration.current === editor.generation) setError('agentAvatarInvalid')
                              }
                              reader.readAsDataURL(file)
                            }}
                          />
                        </label>
                        <p className={css.hint}>{t('agentAvatarHint')}</p>
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
                          onChange={(event) => {
                            update({ name: event.target.value })
                          }}
                        />
                      </label>
                      <label>
                        {t('agentId')}
                        <Input
                          aria-label={t('agentId')}
                          value={draft.slug}
                          disabled={editor.original !== undefined}
                          maxLength={32}
                          onChange={(event) => {
                            update({ slug: event.target.value.toLowerCase() })
                          }}
                        />
                        <small className={css.hint}>{t('agentIdHint')}</small>
                      </label>
                      <label>
                        {t('description')}
                        <textarea
                          aria-label={t('description')}
                          rows={4}
                          maxLength={65536}
                          value={draft.description}
                          onChange={(event) => {
                            update({ description: event.target.value })
                          }}
                        />
                      </label>
                    </div>
                    <label>
                      {t('agentWelcome')}
                      <textarea
                        aria-label={t('agentWelcome')}
                        rows={2}
                        maxLength={65536}
                        value={draft.welcomeMessage ?? ''}
                        onChange={(event) => {
                          update({ welcomeMessage: event.target.value })
                        }}
                      />
                      <small className={css.hint}>{t('agentWelcomeHint')}</small>
                    </label>
                    <section className={css.homeConfig}>
                      <h3>{t('agentHomeConfig')}</h3>
                      <p className={css.hint}>{t('agentHomeHint')}</p>
                      <div className={css.shortcutHeader}>
                        <strong>{t('agentQuickCards')}</strong>
                        <Button
                          variant="outline"
                          disabled={(draft.quickPrompts?.length ?? 0) >= 20}
                          onClick={() => {
                            update({
                              quickPrompts: [
                                ...(draft.quickPrompts ?? []),
                                {
                                  id: randomUUID(),
                                  title: t('agentCardDefaultTitle'),
                                  description: '',
                                  prompt: t('agentCardDefaultPrompt'),
                                },
                              ],
                            })
                          }}
                        >
                          {t('agentAddCard')}
                        </Button>
                      </div>
                      {(draft.quickPrompts?.length ?? 0) === 0 && (
                        <div className={css.shortcutExample}>
                          <h3>{t('agentExampleTitle')}</h3>
                          <p>{t('agentExampleDescription')}</p>
                          <p>{t('agentExamplePrompt')}</p>
                          <Button
                            variant="outline"
                            onClick={() => {
                              update({
                                quickPrompts: [
                                  {
                                    id: randomUUID(),
                                    title: t('agentExampleTitle'),
                                    description: t('agentExampleDescription'),
                                    prompt: t('agentExamplePrompt'),
                                  },
                                ],
                              })
                            }}
                          >
                            {t('agentUseExample')}
                          </Button>
                        </div>
                      )}
                      {draft.quickPrompts?.map(card => (
                        <div className={css.shortcutEditor} key={card.id}>
                          <label>
                            {t('agentCardTitle')}
                            <Input
                              aria-label={t('agentCardTitle')}
                              maxLength={120}
                              value={card.title}
                              onChange={(event) => {
                                update({
                                  quickPrompts: (draft.quickPrompts ?? []).map(row =>
                                    row.id === card.id
                                      ? { ...row, title: event.target.value }
                                      : row,
                                  ),
                                })
                              }}
                            />
                          </label>
                          <label>
                            {t('description')}
                            <Input
                              aria-label={t('agentCardDescription')}
                              value={card.description}
                              onChange={(event) => {
                                update({
                                  quickPrompts: (draft.quickPrompts ?? []).map(row =>
                                    row.id === card.id
                                      ? { ...row, description: event.target.value }
                                      : row,
                                  ),
                                })
                              }}
                            />
                          </label>
                          <label>
                            {t('agentCardPrompt')}
                            <textarea
                              aria-label={t('agentCardPrompt')}
                              rows={3}
                              maxLength={65536}
                              value={card.prompt}
                              onChange={(event) => {
                                update({
                                  quickPrompts: (draft.quickPrompts ?? []).map(row =>
                                    row.id === card.id
                                      ? { ...row, prompt: event.target.value }
                                      : row,
                                  ),
                                })
                              }}
                            />
                          </label>
                          <Button
                            variant="outline"
                            onClick={() => {
                              update({
                                quickPrompts: (draft.quickPrompts ?? []).filter(
                                  row => row.id !== card.id,
                                ),
                              })
                            }}
                          >
                            {t('agentRemoveCard')}
                          </Button>
                        </div>
                      ))}
                    </section>
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
                    <label>
                      {t('agentDefaultModel')}
                      <select
                        aria-label={t('agentDefaultModel')}
                        value={draft.model ? JSON.stringify(draft.model) : ''}
                        onChange={(event) => {
                          const model = catalog.models?.groups
                            .flatMap(group =>
                              group.models.map(item => ({ provider: group.id, model: item.id })),
                            )
                            .find(item => JSON.stringify(item) === event.target.value)
                          const { model: _previous, ...rest } = draft
                          setEditor({ ...editor, draft: model ? { ...rest, model } : rest })
                        }}
                      >
                        <option value="">{t('agentModelAuto')}</option>
                        {draft.model &&
                          !catalog.models?.groups.some(
                            group =>
                              group.id === draft.model?.provider &&
                              group.models.some(item => item.id === draft.model?.model),
                          ) && (
                          <option value={JSON.stringify(draft.model)}>
                            {draft.model.provider} / {draft.model.model}
                          </option>
                        )}
                        {catalog.models?.groups.map(group => (
                          <optgroup key={group.id} label={group.name}>
                            {group.models.map(model => (
                              <option
                                key={model.id}
                                value={JSON.stringify({ provider: group.id, model: model.id })}
                              >
                                {model.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    {catalog.models?.failures.map(failure => (
                      <p key={failure.id} className={css.hint}>
                        {failure.name} · {failure.message}
                      </p>
                    ))}
                    <p className={css.hint}>{t('agentRuntimeHint')}</p>
                  </>
                )}
                {editor.step === 2 && (
                  <>
                    <p className={css.hint}>{t('agentKnowledgeHint')}</p>
                    {catalog.knowledgeBases === undefined ? (
                      <p role="status">{t('knowledgeBackendUnavailable')}</p>
                    ) : catalog.knowledgeBases.length === 0 ? (
                      <p>{t('knowledgeBackendEmpty')}</p>
                    ) : (
                      <div className={css.knowledgeGrid}>
                        {catalog.knowledgeBases.map((base) => {
                          const selected = draft.knowledgeBases?.includes(base.id) ?? false
                          return (
                            <label
                              className={`${cardStyles.surface} ${css.knowledgeCard} ${selected ? css.knowledgeCardSelected : ''}`}
                              key={base.id}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(event) => {
                                  update({ knowledgeBases: event.target.checked
                                    ? [...(draft.knowledgeBases ?? []), base.id]
                                    : (draft.knowledgeBases ?? []).filter(id => id !== base.id) })
                                }}
                              />
                              <span className={css.knowledgeCardContent}>
                                <Tooltip label={base.name} side="bottom" delayMs={400} onlyWhenClipped maxWidth={360}>
                                  <strong>{base.name}</strong>
                                </Tooltip>
                                {base.description && (
                                  <Tooltip label={base.description} side="bottom" delayMs={400} onlyWhenClipped maxWidth={360}>
                                    <small>{base.description}</small>
                                  </Tooltip>
                                )}
                              </span>
                            </label>
                          )
                        })}
                        {(draft.knowledgeBases ?? [])
                          .filter(id => catalog.knowledgeBases?.some(base => base.id === id) !== true)
                          .map(id => (
                            <label
                              className={`${cardStyles.surface} ${css.knowledgeCard} ${css.knowledgeCardSelected}`}
                              key={id}
                            >
                              <input type="checkbox" checked onChange={() => {
                                update({ knowledgeBases: (draft.knowledgeBases ?? []).filter(value => value !== id) })
                              }} />
                              <span className={css.knowledgeCardContent}>
                                <Tooltip label={id} side="bottom" delayMs={400} onlyWhenClipped maxWidth={360}>
                                  <strong>{id}</strong>
                                </Tooltip>
                                <small>{t('knowledgeNoAccess')}</small>
                              </span>
                            </label>
                          ))}
                      </div>
                    )}
                  </>
                )}
                {editor.step === 3 && (
                  <>
                    <p className={css.hint}>{t('agentSkillHint')}</p>
                    <label className={css.skillUpload}>
                      {t('agentUploadSkill')}
                      <input
                        type="file"
                        accept=".md,text/markdown"
                        disabled={!canWrite}
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (!file) return
                          const generation = editor.generation
                          setBusy(true)
                          setError(null)
                          void (async () => {
                            try {
                              if (file.size > 262144) throw new Error('Skill file exceeds the upload limit')
                              const skill = parseUploadedSkill(await file.text(), file.name)
                              if (skillChoices.some(item => item.slug === skill.slug)) {
                                if (editorGeneration.current === generation) setError('duplicate')
                                return
                              }
                              setEditor((current) => {
                                if (current?.generation !== generation) return current
                                return {
                                  ...current,
                                  importedSkills: [...current.importedSkills, skill],
                                  draft: { ...current.draft, skills: [...current.draft.skills, skill.slug] },
                                }
                              })
                            } catch (_error) {
                              if (editorGeneration.current === generation) setError('agentSkillUploadError')
                            } finally {
                              setBusy(false)
                            }
                          })()
                        }}
                      />
                    </label>
                    <div className={css.skillGrid}>
                      {skillChoices.map(skill => (
                        <label className={css.option} key={skill.slug}>
                          <input
                            type="checkbox"
                            checked={draft.skills.includes(skill.slug)}
                            onChange={(event) => {
                              const selected = event.target.checked
                              setEditor(current => current && ({
                                ...current,
                                importedSkills: selected && !savedSkills.some(item => item.slug === skill.slug)
                                  ? [...current.importedSkills, skill] : current.importedSkills,
                                draft: {
                                  ...current.draft,
                                  skills: selected ? [...current.draft.skills, skill.slug]
                                    : current.draft.skills.filter(slug => slug !== skill.slug),
                                },
                              }))
                              setError(null)
                            }}
                          />
                          <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                {editor.step === 4 && (
                  <>
                    <p className={css.hint}>
                      {t('agentConnectorHint')}
                    </p>
                    {form.value?.connectors.length ===
                      0 && <div className={css.selectionEmpty}>{t('agentCapabilitiesEmpty')}</div>}
                    {form.value?.connectors.map(
                      (item) => {
                        const field = 'connectors'
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
                                {t(item.transport === 'stdio' ? 'stdio' : 'http')}
                              </small>
                              {'enabled' in item && !item.enabled && (
                                <small>{t('agentConnectorDisabled')}</small>
                              )}
                            </span>
                          </label>
                        )
                      },
                    )}
                  </>
                )}
                {editor.step === 5 && (
                  <>
                    <p className={css.hint}>{t('agentToolsHint')}</p>
                    {AGENT_TOOL_GROUPS.map(group => (
                      <label className={css.option} key={group}>
                        <input
                          type="checkbox"
                          checked={(draft.tools ?? AGENT_TOOL_GROUPS).includes(group)}
                          onChange={(event) => {
                            update({
                              tools: event.target.checked
                                ? [...(draft.tools ?? AGENT_TOOL_GROUPS), group]
                                : (draft.tools ?? AGENT_TOOL_GROUPS).filter(
                                  item => item !== group,
                                ),
                            })
                          }}
                        />
                        {t(`agentTool_${group}`)}
                      </label>
                    ))}
                  </>
                )}
                {editor.step === 6 && (
                  <>
                    <p className={css.hint}>{t('agentSubagentsHint')}</p>
                    <label className={css.option}>
                      <input type="checkbox" checked={draft.subagents === undefined} onChange={(event) => {
                        if (event.target.checked) {
                          const { subagents: _selected, ...rest } = draft
                          setEditor({ ...editor, draft: rest })
                        } else {
                          update({ subagents: [] })
                        }
                      }} />
                      {t('agentInheritSubagents')}
                    </label>
                    {agents
                      .filter(
                        agent =>
                          agent.slug !== draft.slug &&
                          agent.enabled &&
                          agent.category !== 'enterprise',
                      )
                      .map(agent => (
                        <label className={css.option} key={agent.slug}>
                          <input
                            type="checkbox"
                            checked={draft.subagents?.includes(agent.slug) ?? false}
                            disabled={draft.subagents === undefined}
                            onChange={(event) => {
                              update({
                                subagents: event.target.checked
                                  ? [...(draft.subagents ?? []), agent.slug]
                                  : draft.subagents?.filter(slug => slug !== agent.slug) ?? [],
                              })
                            }}
                          />
                          <span>
                            <strong>{agent.name}</strong>
                            <small>{agent.description}</small>
                          </span>
                        </label>
                      ))}
                  </>
                )}
                {editor.step === 7 && (
                  <>
                    <div className={css.summary}>
                      <h2>{draft.name}</h2>
                      <p>{draft.description || t('agentNoDescription')}</p>
                      <dl>
                        <dt>{t('agentId')}</dt>
                        <dd>{draft.slug}</dd>
                        <dt>{t('instructions')}</dt>
                        <dd className={css.instructionPreview}>{draft.instructions}</dd>
                        <dt>{t('agentDefaultModel')}</dt>
                        <dd>
                          {draft.model
                            ? `${draft.model.provider} / ${draft.model.model}`
                            : t('agentModelAuto')}
                        </dd>
                        <dt>{t('agentWelcome')}</dt>
                        <dd>{draft.welcomeMessage || t('agentNone')}</dd>
                        <dt>{t('agentQuickCards')}</dt>
                        <dd>
                          {draft.quickPrompts?.map(card => card.title).join('、') ||
                            t('agentNone')}
                        </dd>
                        <dt>{t('agentTools')}</dt>
                        <dd>
                          {(draft.tools ?? AGENT_TOOL_GROUPS)
                            .map(group =>
                              t(`agentTool_${group}`),
                            )
                            .join('、') || t('agentNone')}
                        </dd>
                        <dt>{t('agentSubagents')}</dt>
                        <dd>
                          {draft.subagents === undefined ? t('agentInheritSubagents') : draft.subagents
                            .map(slug => agents.find(agent => agent.slug === slug)?.name)
                            .join('、') || t('agentNone')}
                        </dd>
                        <dt>{t('skills')}</dt>
                        <dd>
                          {draft.skills
                            .map(
                              slug =>
                                skillChoices.find(skill => skill.slug === slug)?.name,
                            )
                            .join('、') || t('agentNone')}
                        </dd>
                        <dt>{t('agentKnowledge')}</dt>
                        <dd className={css.instructionPreview}>
                          {(draft.knowledgeBases ?? []).map(id => catalog.knowledgeBases?.find(base => base.id === id)?.name ?? id).join(', ') || t('agentNone')}
                        </dd>
                        {editor.original !== undefined && (
                          <>
                            <dt>{t('connectors')}</dt>
                            <dd>
                              {draft.connectors
                                .map(
                                  slug =>
                                    form.value?.connectors.find(connector => connector.slug === slug)
                                      ?.name,
                                )
                                .join('、') || t('agentNone')}
                            </dd>
                          </>
                        )}
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
            <span>
              {t('agentStep', { step: String(visibleStepIndex + 1), total: String(editorSteps.length) })}
            </span>
            <Button variant="outline" disabled={busy} onClick={closeEditor}>
              {t('cancel')}
            </Button>
            {editor.step > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const previousStep = editorSteps[visibleStepIndex - 1]?.step
                  if (previousStep !== undefined) selectStep(previousStep)
                }}
              >
                {t('agentBack')}
              </Button>
            )}
            {visibleStepIndex < editorSteps.length - 1 ? (
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
        <section
          className={`${css.panel} ${
            category === 'enterprise' ? css.enterprisePanel : category === 'personal' ? css.personalPanel : ''
          }`}
          aria-label={t('agentCatalog')}
        >
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
          {category === 'enterprise' && (
            <p className={css.enterpriseIntro}>{t('enterpriseAccessHint')}</p>
          )}
          <div className={css.toolbar}>
            <Input
              className={`${css.search}`}
              icon={<IconSearchOutlineRegular size={18} />}
              aria-label={t(category === 'enterprise' ? 'enterpriseSearch' : 'agentSearch')}
              placeholder={t(category === 'enterprise' ? 'enterpriseSearch' : 'agentSearch')}
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
              className={css.refresh}
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
                const remoteEnterprise =
                  catalog.enterprise !== undefined && agent.category === 'enterprise'
                const ready =
                  remoteEnterprise ||
                  (saved && agent.enabled && roster !== undefined && !roster.broken)
                const editable = agent.category === 'personal'
                return (
                  <article
                    className={`${cardStyles.surface} ${view === 'cards' ? cardStyles.catalogSurface : ''} ${css.card} ${remoteEnterprise ? css.enterpriseCard : ''} ${
                      highlight === agent.slug ? css.highlight : ''
                    }`}
                    key={agent.slug}
                    role={view === 'table' ? 'row' : undefined}
                  >
                    <div className={css.cardHeader} role={view === 'table' ? 'cell' : undefined}>
                      <div
                        className={css.avatar}
                        aria-hidden="true"
                      >
                        {agent.avatar ? (
                          <img src={agent.avatar} alt="" />
                        ) : (
                          <img src={jingworkAgent} alt="" />
                        )}
                      </div>
                      <div className={css.identity}>
                        <h2>{agent.name}</h2>
                        <div className={css.identifier}>
                          <span>
                            {t('agentIdentifier', {
                              id: remoteEnterprise
                                ? agent.slug.slice('jingwork-enterprise:'.length)
                                : agent.slug,
                            })}
                          </span>
                          <Tooltip label={t('agentCopyId')}>
                            <Button
                              className={css.copyId}
                              size="sm"
                              aria-label={t('agentCopyId')}
                              onClick={() => {
                                void writeClipboard(
                                  remoteEnterprise
                                    ? agent.slug.slice('jingwork-enterprise:'.length)
                                    : agent.slug,
                                ).then((accepted) => {
                                  props.actions.show(
                                    accepted ? 'agentIdCopied' : 'agentCopyFailed',
                                    accepted,
                                  )
                                })
                              }}
                            >
                              <IconCopyOutlineRegular size={16} />
                              {t('agentCopyId')}
                            </Button>
                          </Tooltip>
                        </div>
                        <div className={css.badges}>
                          <span className={ready ? css.ready : css.status}>
                            {remoteEnterprise
                              ? t('enterpriseAuthorized')
                              : t(
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
                          {remoteEnterprise && (
                            <span className={css.enterpriseBadge}>{t('enterpriseRoleLabel')}</span>
                          )}
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
                    {remoteEnterprise && (
                      <div className={css.enterpriseMetadata}>
                        <span>
                          <IconRefreshOutlineRegular size={15} />
                          {t('enterpriseRoleSource')}
                        </span>
                        <span>
                          <IconShieldOutlineRegular size={15} />
                          {t('enterpriseNativeRuntime')}
                        </span>
                      </div>
                    )}
                    <div className={css.cardFooter} role={view === 'table' ? 'cell' : undefined}>
                      {remoteEnterprise && (
                        <span className={css.enterpriseAccount}>{t('enterpriseAccountHint')}</span>
                      )}
                      <div className={css.cardActions}>
                        {editable ? (
                          <>
                            <Tooltip label={t('edit')}>
                              <Button
                                size="sm"
                                aria-label={t('edit')}
                                icon={<IconEditOutlineRegular size={20} />}
                                disabled={!canWrite}
                                onClick={() => {
                                  begin(agent, true)
                                }}
                              >
                                {t('edit')}
                              </Button>
                            </Tooltip>
                            <Tooltip label={t('agentDuplicate')}>
                              <Button
                                size="sm"
                                aria-label={t('agentDuplicate')}
                                icon={<IconCopyOutlineRegular size={20} />}
                                disabled={!canWrite}
                                onClick={() => {
                                  begin(agent)
                                }}
                              >
                                {t('agentDuplicate')}
                              </Button>
                            </Tooltip>
                            <Tooltip label={t('agentExport')}>
                              <Button
                                size="sm"
                                aria-label={t('agentExport')}
                                icon={<IconDownloadOutlineRegular size={20} />}
                                onClick={() => {
                                  exportAgent(agent)
                                }}
                              >
                                {t('agentExport')}
                              </Button>
                            </Tooltip>
                            <Tooltip label={t('remove')}>
                              <Button
                                size="sm"
                                aria-label={t('remove')}
                                icon={<IconTrashOutlineRegular size={20} />}
                                disabled={!canWrite}
                                onClick={() => {
                                  setDeleting(agent)
                                  setError(null)
                                }}
                              >
                                {t('remove')}
                              </Button>
                            </Tooltip>
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
                        {!remoteEnterprise && !roster?.isDefault && ready && (
                          <Tooltip label={t('agentMakeDefault')}>
                            <Button
                              size="sm"
                              aria-label={t('agentMakeDefault')}
                              icon={<IconPinOutlineRegular size={20} />}
                              disabled={!canWrite}
                              onClick={() => {
                                void action(() => props.setDefault(agent.slug), 'agentDefaultSaved')
                              }}
                            >
                              {t('agentMakeDefault')}
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                      {saved && (
                        <Button
                          className={`${css.agentStart} ${remoteEnterprise ? css.enterpriseStart : ''}`}
                          variant={remoteEnterprise ? 'primary' : 'outline'}
                          icon={<IconNewChatOutlineRegular size={17} />}
                          disabled={!ready || busy}
                          onClick={() => {
                            setBusy(true)
                            void Promise.resolve(props.start(agent.slug))
                              .catch(() => {
                                props.actions.show('loadError', false)
                              })
                              .finally(() => {
                                setBusy(false)
                              })
                          }}
                        >
                          {t(remoteEnterprise ? 'enterpriseStart' : 'start')}
                          {remoteEnterprise && <IconChevronRightOutlineRegular size={17} />}
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
          {deleting && catalog.roster.some(row => row.id === `workbench-${deleting.slug}` && row.isDefault) && (
            <p>{t('agentRemoveDefaultHint')}</p>
          )}
        </Modal>
      </div>
    </>
  )
}
