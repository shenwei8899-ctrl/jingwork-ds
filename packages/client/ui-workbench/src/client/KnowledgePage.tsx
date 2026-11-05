/** Profile-owned assistant reference material with revision-fenced editing. */
import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { Expert } from '../types.ts'
import { resolveExpert } from '../expert.ts'
import type { WorkbenchKey } from './locales.ts'
import css from './page.module.css'

type Draft = {
  expert: Expert
  content: string
  revision: number | undefined
}

/** Edit the reference text saved with each configured assistant.
 * @param props Framework-bound profile settings and assistant commands.
 * @returns The knowledge list and its retained editing draft.
 */
export function KnowledgePage(props: FactoryComponentPropsOf<'workbench.knowledge'>) {
  const { t } = props
  const form = props.useForm(snapshot => snapshot)
  const catalog = props.useCatalog(snapshot => snapshot)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<WorkbenchKey | null>(null)
  const [busy, setBusy] = useState(false)
  const conflict = draft !== null && draft.revision !== form.revision
  useEffect(() => {
    void props.load()
  }, [props.load])
  const rows = (form.value?.experts ?? []).map(resolveExpert).filter(expert =>
    `${expert.name} ${expert.description} ${expert.knowledge}`
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  const close = () => {
    if (busy) return
    setDraft(null)
    setError(null)
  }
  const save = async () => {
    if (draft === null || busy || conflict) return
    setBusy(true)
    const failure = await props.save(
      'experts',
      { ...draft.expert, knowledge: draft.content },
      draft.expert.slug,
      draft.revision,
    )
    setBusy(false)
    if (failure !== null) {
      setError(failure)
      return
    }
    setDraft(null)
    setError(null)
    props.actions.show('knowledgeSaved', true)
  }
  return (
    <section className={css.page}>
      <header className={css.header}>
        <div>
          <h1>{t('agentKnowledge')}</h1>
          <p>{t('knowledgeManageIntro')}</p>
        </div>
        <Button onClick={() => { void props.load() }}>{t('refresh')}</Button>
      </header>
      {catalog.error && <p role="alert" className={css.error}>{t(catalog.error)}</p>}
      <div className={css.toolbar}>
        <Input aria-label={t('search')} placeholder={t('search')} value={query}
          onChange={(event) => { setQuery(event.target.value) }} />
      </div>
      {form.value === undefined ? <p role="status">{t('notConfigured')}</p> : rows.length === 0 ? (
        <p className={css.empty}>{t(query.trim() ? 'noResults' : 'knowledgeEmpty')}</p>
      ) : (
        <div className={css.grid}>
          {rows.map(expert => (
            <article className={css.card} key={expert.slug}>
              <h2>{expert.name}</h2>
              <p>{expert.knowledge.trim() ? expert.knowledge.slice(0, 220) : t('knowledgeUnassigned')}</p>
              <div className={css.cardactions}>
                <Button disabled={!form.writable} onClick={() => {
                  setDraft({ expert: structuredClone(expert), content: expert.knowledge, revision: form.revision })
                  setError(null)
                }}>{t('edit')}</Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={draft !== null} title={t('agentKnowledge')} closeLabel={t('close')} onClose={close}
        footer={<>
          <Button variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button>
          <Button variant="primary" disabled={busy || !form.writable || conflict} onClick={() => { void save() }}>{t('save')}</Button>
        </>}
      >
        {draft && <div className={css.form}>
          <h3>{draft.expert.name}</h3>
          <p>{t('knowledgeEditHint')}</p>
          {conflict && !busy && <p role="alert" className={css.error}>{t('knowledgeVersionConflict')}</p>}
          {error && <p role="alert" className={css.error}>{t(error)}</p>}
          <label>
            {t('agentKnowledgeContent')}
            <textarea aria-label={t('agentKnowledgeContent')} data-modal-autofocus rows={14} maxLength={65536} disabled={busy}
              value={draft.content} onChange={(event) => {
                setDraft({ ...draft, content: event.target.value })
                setError(null)
              }} />
          </label>
        </div>}
      </Modal>
    </section>
  )
}
