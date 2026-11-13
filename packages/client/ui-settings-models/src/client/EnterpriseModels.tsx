/** Settings controls for models authorized by the enterprise backend. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Public native bridge for enterprise model configuration. */
export interface EnterpriseModelBridge {
  /** @returns Current authorized models and the locally saved default selection. */
  models(): Promise<{
    models: { id: string; name: string; provider: string }[]
    defaultModel: string | null
    selectedModel: string | null
  }>
  /** @param model Authorized server model id. @returns After the new-session default is saved. */
  setModel(model: string): Promise<void>
}

/** Native model actions and localized labels supplied by the slot registration. */
export interface EnterpriseModelsInjected {
  /** @returns Current enterprise model directory synchronized into the local adapter. */
  load: EnterpriseModelBridge['models']
  /** @param model Server-owned model id. @returns After the default selection is committed. */
  select: EnterpriseModelBridge['setModel']
  /** @param key Feature-owned copy key. @returns Localized text. */
  t: (key: ModelsKey) => string
}

/** Select the enterprise default while preserving personal provider configuration.
 * @param props Native catalog reads, default-selection writes and localized copy.
 * @returns Enterprise model settings card.
 */
export function EnterpriseModels({ load, select, t }: InjectFace<EnterpriseModelsInjected>) {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<EnterpriseModelBridge['models']>> | null>(null)
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    void load().then((value) => {
      if (!active) return
      setCatalog(value)
      setSelected([value.selectedModel, value.defaultModel].find(id => value.models.some(model => model.id === id)) ?? value.models[0]?.id ?? '')
    }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [load, revision])
  const save = (): void => {
    setSaving(true)
    setError(false)
    void select(selected).then(() => {
      if (!mounted.current) return
      setCatalog(value => value === null ? value : { ...value, selectedModel: selected })
    }).catch(() => { if (mounted.current) setError(true) }).finally(() => { if (mounted.current) setSaving(false) })
  }
  return <section className={styles['enterpriseCard']} aria-busy={loading || saving}>
    <div className={styles['enterpriseHeader']}>
      <h3 className={styles['title']}>{t('enterpriseTitle')}</h3>
      <Button variant="outline" disabled={loading || saving} onClick={() => { setRevision(value => value + 1) }}>{t('enterpriseRefresh')}{loading ? '…' : ''}</Button>
    </div>
    {error && <p role="alert" className={styles['error']}>{t('enterpriseFailed')}</p>}
    {catalog !== null && catalog.models.length === 0 && <p>{t('enterpriseEmpty')}</p>}
    {catalog !== null && catalog.models.length > 0 && <>
      <select aria-label={t('enterpriseTitle')} className={styles['enterpriseSelect']} value={selected}
        disabled={loading || saving} onChange={(event) => { setSelected(event.target.value) }}>
        {catalog.models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}
      </select>
      <div className={styles['enterpriseActions']}>
        <span className={styles['intro']}>{t('enterpriseConversationHint')}</span>
        <Button variant="outline" disabled={loading || saving || !selected || selected === catalog.selectedModel} onClick={save}>
          {t(selected === catalog.selectedModel ? 'enterpriseSelected' : 'enterpriseUse')}
        </Button>
      </div>
    </>}
  </section>
}
