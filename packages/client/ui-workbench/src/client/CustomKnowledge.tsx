/** Authorized MCP knowledge choices retain connector identity and cancel stale catalog requests. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { Connector, Expert } from '../types.ts'
import type { WorkbenchFace } from './page.tsx'
import cardStyles from './card.module.css'
import css from './assistants.module.css'

type Selection = NonNullable<Expert['customKnowledgeBases']>
type Catalog = { connector: string; name: string; result: Awaited<ReturnType<WorkbenchFace['listConnectorKnowledge']>> }

/** Display compatible MCP knowledge bases below a labeled divider.
 * @param props Saved connectors, draft selection and authenticated Host catalog reader.
 * @returns Selectable custom knowledge cards and per-connector failures.
 */
export function CustomKnowledge(props: PropsLocale<'workbench'> & {
  connectors: readonly Connector[]
  selected: Selection
  revision: number | undefined
  list: WorkbenchFace['listConnectorKnowledge']
  onChange: (selection: Selection) => void
}) {
  const { t } = props
  const [catalogs, setCatalogs] = useState<Catalog[] | null>(null)
  const [attempt, setAttempt] = useState(0)
  const signature = JSON.stringify(props.connectors
    .filter(row => row.enabled && !row.builtin && row.transport === 'streamable-http')
    .map(({ slug, name, url }) => ({ slug, name, url })))
  useEffect(() => {
    const controller = new AbortController()
    const connectors: { slug: string; name: string; url: string }[] = JSON.parse(signature)
    setCatalogs(null)
    void Promise.all(connectors.map(async row => ({
      connector: row.slug, name: row.name,
      result: await props.list(row.url, row.slug, controller.signal),
    }))).then((results) => { if (!controller.signal.aborted) setCatalogs(results) })
    return () => { controller.abort() }
  }, [signature, props.revision, props.list, attempt])
  const bases = (catalogs ?? []).flatMap(catalog => catalog.result.bases.map(base => ({
    ...base, connector: catalog.connector, source: catalog.name,
  })))
  const missing = props.selected.filter(base => !bases.some(row => row.connector === base.connector && row.id === base.id))
  return <section className={css.customKnowledge} aria-label={t('customKnowledge')}>
    <div className={css.customKnowledgeHeader}>
      <h3>{t('customKnowledge')}</h3>
      <Button disabled={catalogs === null} onClick={() => { setAttempt(value => value + 1) }}>{t('refresh')}</Button>
    </div>
    {catalogs === null ? <p role="status">{t('customKnowledgeLoading')}</p> : <>
      {catalogs
        .filter(catalog => catalog.result.status === 'failed' || catalog.result.status === 'upstream-error')
        .map(catalog => (
          <p role="alert" key={catalog.connector}>{catalog.name} · {t(catalog.result.status === 'upstream-error' ? 'customKnowledgeUpstreamFailed' : 'customKnowledgeFailed')}</p>
        ))}
      {bases.length === 0 && catalogs.every(catalog =>
        catalog.result.status !== 'failed' && catalog.result.status !== 'upstream-error') && <p>{t('customKnowledgeEmpty')}</p>}
      <div className={css.knowledgeGrid}>
        {bases.map((base) => {
          const selected = props.selected.some(row => row.connector === base.connector && row.id === base.id)
          return <label key={JSON.stringify([base.connector, base.id])} className={`${cardStyles.surface} ${css.knowledgeCard} ${selected ? css.knowledgeCardSelected : ''}`}>
            <input type="checkbox" checked={selected} onChange={(event) => {
              props.onChange(event.target.checked ? [...props.selected, { connector: base.connector, id: base.id, name: base.name }]
                : props.selected.filter(row => row.connector !== base.connector || row.id !== base.id))
            }} />
            <span className={css.knowledgeCardContent}>
              <strong>{base.name}</strong>
              <small>{base.source} · {base.description || base.id}</small>
            </span>
          </label>
        })}
        {missing.map(base => <label key={JSON.stringify([base.connector, base.id])} className={`${cardStyles.surface} ${css.knowledgeCard} ${css.knowledgeCardSelected}`}>
          <input type="checkbox" checked onChange={() => { props.onChange(props.selected.filter(row => row.connector !== base.connector || row.id !== base.id)) }} />
          <span className={css.knowledgeCardContent}><strong>{base.name}</strong><small>{t('knowledgeNoAccess')}</small></span>
        </label>)}
      </div>
    </>}
  </section>
}
