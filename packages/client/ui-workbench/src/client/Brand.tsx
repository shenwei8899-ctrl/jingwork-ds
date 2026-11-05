/** JingWork identity shared by the expanded sidebar and collapsed rail. */
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import jingworkMark from './assets/jingwork-agent.png'
import css from './brand.module.css'

/** Render the existing JingWork artwork at the size requested by the sidebar.
 * @param props Sidebar mark geometry.
 * @returns JingWork brand image.
 */
export function JingworkBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <img src={jingworkMark} width={size} height={size} alt="" className={css.mark} />
}

/** Render the two-line JingWork brand name.
 * @param props Workbench locale binding.
 * @returns Chinese product name above the English brand.
 */
export function JingworkBrandName({ t }: PropsLocale<'workbench'>) {
  return <span className={css.name}>
    <span className={css.title}>{t('brandTitle')}</span>
    <span className={css.subtitle}>{t('brandSubtitle')}</span>
  </span>
}
