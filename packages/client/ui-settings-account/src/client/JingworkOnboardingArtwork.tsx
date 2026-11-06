/** Theme-aware JingWork interface illustrations with localized text. */
import { FileTypeIcon, IconFolderOpenOutlineRegular, IconNewChatOutlineRegular, IconSendOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopOnboardingProps } from './onboarding-contract.ts'
import { onboardingArtworkEn, onboardingArtworkZh } from './locales/onboarding-artwork.ts'
import mark from './assets/onboarding-jingwork.png'
import css from './JingworkOnboardingArtwork.module.css'

type ArtworkProps = Pick<DesktopOnboardingProps, 'locale' | 't'> & { className?: string | undefined }

/**
 * Draw the introduction's example workbench and local project files.
 * @param props - Active artwork language, localized account copy and layout class.
 * @returns Decorative JingWork workbench preview.
 */
export function JingworkWelcomeArtwork({ locale, t, className = '' }: ArtworkProps) {
  const copy = locale === 'zh' ? onboardingArtworkZh : onboardingArtworkEn
  const files = [
    { title: copy.tasks[0], kind: 'ppt' },
    { title: copy.tasks[1], kind: 'word' },
    { title: copy.tasks[2], kind: 'excel' },
  ] as const
  return <div className={`${css.artwork} ${css.welcome} ${className}`} data-onboarding-artwork="jingwork-welcome" aria-hidden="true">
    <div className={css.window}>
      <WindowControls />
      <div className={css.workbench}>
        <div className={css.sidebar}>
          <Brand name={t('onboardingBrand')} />
          <div className={css.newTask}><IconNewChatOutlineRegular size={16} />{copy.newTask}</div>
          <div className={css.sectionLabel}>{copy.workspace}</div>
          <div className={css.taskList}>{copy.tasks.map((task, index) => <div className={index === 0 ? css.selected : ''} key={task}>{task}</div>)}</div>
        </div>
        <div className={css.canvas}>
          <img src={mark} alt="" className={css.heroMark} />
          <span className={css.heroName}>{t('onboardingBrand')}</span>
          <span className={css.caption}>{copy.ready}</span>
          <div className={css.prompt}>{copy.prompt}<span><IconSendOutlineRegular size={14} /></span></div>
          <div className={css.capabilities}><span>{t('onboardingOffice')}</span><span>{t('onboardingDevelopment')}</span></div>
        </div>
      </div>
    </div>
    <div className={css.files}>
      <div className={css.filesHeading}><IconFolderOpenOutlineRegular size={20} />{copy.files}</div>
      {files.map(file => <div className={css.fileRow} key={file.title}>
        <FileTypeIcon kind={file.kind} size={28} /><span>{file.title}</span>
      </div>)}
    </div>
  </div>
}

/**
 * Draw product-owned account and usage panels without a sample credential or email address.
 * @param props - Active artwork language, localized account copy and layout class.
 * @returns Decorative JingWork account preview.
 */
export function JingworkCreditArtwork({ locale, t, className = '' }: ArtworkProps) {
  const copy = locale === 'zh' ? onboardingArtworkZh : onboardingArtworkEn
  return <div className={`${css.artwork} ${css.credit} ${className}`} data-onboarding-artwork="jingwork-credit" aria-hidden="true">
    <div className={`${css.window} ${css.accountWindow}`}>
      <WindowControls />
      <div className={css.accountSidebar}>
        <Brand name={t('onboardingBrand')} />
        <div className={css.newTask}><IconNewChatOutlineRegular size={16} />{copy.newTask}</div>
        <div className={css.sectionLabel}>{copy.workspace}</div>
        <div className={css.taskList}>{copy.tasks.map(task => <div key={task}>{task}</div>)}</div>
      </div>
    </div>
    <div className={css.account}>
      <div className={css.accountHeading}>{t('settings')}</div>
      <div className={css.profile}><img src={mark} alt="" /><div><strong>{t('onboardingBrand')}</strong><span>{copy.account}</span></div></div>
      <div className={css.balance}>
        <div><span>{t('balance')}</span><strong>{copy.sampleBalance}</strong></div>
        <div className={css.accountActions}><span>{t('usage')}</span><span>{t('topUp')}</span></div>
      </div>
      <div className={css.activity}><span>{copy.activity}</span><div className={css.bars}>{[40, 65, 50, 88, 73, 100, 84].map(height => <span key={height} style={{ height: `${height}%` }} />)}</div></div>
    </div>
  </div>
}

function Brand({ name }: { name: string }) {
  return <div className={css.brand}><img src={mark} alt="" /><span>{name}</span></div>
}

function WindowControls() {
  return <div className={css.windowControls}><span /><span /><span /></div>
}
