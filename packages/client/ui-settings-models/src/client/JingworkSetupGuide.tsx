/** Native JingWork introduction over the shared model and Host settings readers. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm, SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { JingworkSetupSettings } from '../onboarding-config.ts'
import type { ModelsKey } from './locales.ts'
import { providerUsable, type ModelsSettingsState } from './store.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import mascot from './assets/jingwork-mascot.png'
import css from './JingworkSetupGuide.module.css'

/** Shared snapshots and narrow Host operations for the JingWork introduction. */
export interface JingworkSetupGuideInjected {
  hooks: {
    progress: ConfigForm<JingworkSetupSettings>
    models: SnapshotStore<ModelsSettingsState>
    settings: SettingsDescribeFace
  }
  /** Refresh the Models page's provider and credential metadata. @returns completion of that refresh. */
  refreshModels(): Promise<void>
  /** Retry reading the Host settings document. @returns completion of the shared settings read. */
  retrySettings(): Promise<void>
  /** Save and confirm this installation's completion marker. @returns whether Host persistence was confirmed. */
  saveCompletion(): Promise<boolean>
  /** Models-owned localized copy. */
  t: (key: ModelsKey) => string
}

/** Settings coordinator owner props and model-owned guide dependencies. */
export type JingworkSetupGuideProps = PropsRuntime<'settings.onboarding'> & InjectFace<JingworkSetupGuideInjected>

/**
 * Keep the unfinished guide mounted while the user edits the existing Models page.
 * @param props - coordinator navigation, shared snapshots, and persisted completion operations.
 * @returns the current guide page, or no modal while settings is open or saved completion is being accepted.
 */
export function JingworkSetupGuide({
  complete, openSection, settingsOpen, explicit = false, useProgress, useModels, useSettings,
  refreshModels, retrySettings, saveCompletion, t,
}: JingworkSetupGuideProps): ReactNode {
  const progress = useProgress(value => value)
  const models = useModels(value => value)
  const settings = useSettings(value => value)
  const [page, setPage] = useState<'welcome' | 'models'>('welcome')
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<'models' | 'settings' | 'save' | null>(null)
  const [refresh, setRefresh] = useState(0)
  const mounted = useRef(true)
  const finished = useRef(false)
  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])
  const acknowledged = progress.status === 'ready' && progress.value?.jingworkSetupComplete === true
  const unavailable = progress.status === 'unavailable' || (progress.status === 'ready' && !progress.writable)
  const settingsFailed = progress.status === 'unavailable'
    || (progress.status === 'loading' && settings.error !== null) || failure === 'settings'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if ((acknowledged || unavailable) && !explicit && !saving) finish()
  }, [acknowledged, unavailable, explicit, saving, finish])

  useEffect(() => {
    if (page !== 'models' || settingsOpen) return
    let active = true
    void refreshModels().then(() => {
      if (active) setFailure(current => current === 'models' ? null : current)
    }, () => {
      if (active) setFailure(current => current ?? 'models')
    })
    return () => { active = false }
  }, [page, settingsOpen, refreshModels, refresh])

  if (settingsOpen || ((acknowledged || unavailable) && !explicit && !saving)) return null
  if (progress.status === 'loading' && !settingsFailed) return null

  const save = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setFailure(null)
    try {
      const accepted = await saveCompletion()
      if (!mounted.current) return
      if (accepted) finish()
      else setFailure('save')
    } catch (_error) {
      // The Host write can reject after transport failure without confirming persistence.
      if (mounted.current) setFailure('save')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }
  const retryRead = (): void => {
    setFailure(null)
    if (settingsFailed) {
      void retrySettings().catch(() => { if (mounted.current) setFailure('settings') })
    } else {
      setRefresh(value => value + 1)
    }
  }
  const modelFailed = models.status === 'error' || models.credentialError !== null || failure === 'models'
  const ready = models.status === 'ready' && !modelFailed && models.rows.some(providerUsable)
  const writable = progress.status === 'ready' && progress.writable
  let errorKey: ModelsKey | undefined
  if (settingsFailed) errorKey = 'jingworkSettingsError'
  else if (failure === 'save') errorKey = 'jingworkSaveError'
  else if (!writable) errorKey = 'readOnly'
  else if (page === 'models' && modelFailed) errorKey = 'jingworkModelsError'

  return <OnboardingModal key={page} title={t(page === 'welcome' ? 'jingworkWelcomeTitle' : 'jingworkModelsTitle')} focusTitle>
    <div className={css.hero}>
      <img className={css.mascot} src={mascot} width="120" height="120" alt="" />
      <p className={css.description}>{t(page === 'welcome' ? 'jingworkWelcomeDescription' : 'jingworkModelsDescription')}</p>
    </div>
    {page === 'models' && <ol className={css.steps}>
      <li>{t('jingworkProviderStep')}</li>
      <li>{t('jingworkConnectionStep')}</li>
      <li>{t('jingworkSelectionStep')}</li>
    </ol>}
    <div className={css.feedback}>
      {errorKey !== undefined && <p className={css.error} role="alert">{t(errorKey)}</p>}
      {errorKey === undefined && page === 'models' && ready && <p role="status">{t('jingworkModelsReady')}</p>}
      {errorKey === undefined && page === 'models' && (models.status === 'loading' || models.status === 'idle')
        && <div className={css.loading} role="status" aria-label={t('jingworkCheckingModels')}><StateDot state="ongoing" /></div>}
    </div>
    <div className={css.actions}>
      {page === 'models' && <Button variant="outline" disabled={saving} onClick={() => { setPage('welcome') }}>{t('jingworkBack')}</Button>}
      {page === 'models' && <Button variant="outline" disabled={saving || !writable} onClick={() => { void save() }}>{t('jingworkLater')}</Button>}
      {(settingsFailed || (page === 'models' && modelFailed)) && <Button variant="outline" disabled={saving} onClick={retryRead}>{t('retry')}</Button>}
      {unavailable && <Button variant="outline" onClick={finish}>{t('close')}</Button>}
      {page === 'welcome' ? <Button variant="primary" disabled={saving || settingsFailed} onClick={() => { setPage('models') }}>{t('jingworkGetStarted')}</Button>
        : <>
          <Button variant={ready || failure === 'save' ? 'outline' : 'primary'} disabled={saving} onClick={() => { openSection('models') }}>{t('jingworkConfigureModels')}</Button>
          {ready && failure !== 'save' && <Button variant="primary" disabled={saving || !writable} onClick={() => { void save() }}>{t(saving ? 'onboardingSaving' : 'jingworkStart')}</Button>}
        </>}
      {failure === 'save' && <Button variant="primary" disabled={saving} onClick={() => { void save() }}>{t('jingworkRetrySave')}</Button>}
    </div>
  </OnboardingModal>
}
