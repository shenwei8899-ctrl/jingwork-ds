/** Sidebar menu for the account validated by the native Jingwork login. */
import { useRef, useState } from 'react'
import { Menu, Toast, IconUserOutlineMedium, IconSettingsOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LogoutIcon } from './LogoutIcon.tsx'
import css from './AccountMenu.module.css'

/** Public native account presentation and local sign-out operation. */
export interface JingworkAccountMenuInjected {
  /** Native account name, without credentials. */
  hooks: { identity: HostObservable<string | null> }
  /** Remove the local account session and return to native login. */
  signOut: () => Promise<void>
}

/** Render the Jingwork account and shared application settings.
 * @param props Settings navigation and native account operations.
 * @returns Sidebar account launcher.
 */
export function JingworkAccountMenu({ wide, openSettings, settingsShortcut, useIdentity, signOut, t }:
  PropsRuntime<'settings.launcher'> & PropsLocale<'settings.account'> & InjectFace<JingworkAccountMenuInjected>) {
  const name = useIdentity(value => value)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <div className={css.root}>
    {failed && <Toast text={t('failed')} onDone={() => { setFailed(false) }} />}
    <Menu open={open} side="top" portal autoFocus className={css.anchor}
      anchor={<button ref={trigger} type="button" className={css.trigger} data-collapsed={!wide}
        aria-label={t('menu')} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
        <IconUserOutlineMedium size={16} />
        {wide && <span className={css.label}>{name ?? t('loading')}</span>}
      </button>}
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
        { id: 'signout', label: t('signOut'), icon: <LogoutIcon />, disabled: busy },
      ]}
      onClose={() => { setOpen(false) }} onSelect={(id) => {
        setOpen(false)
        if (id === 'settings') { trigger.current?.focus(); openSettings(); return }
        setBusy(true)
        void signOut().catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
      }} />
  </div>
}
