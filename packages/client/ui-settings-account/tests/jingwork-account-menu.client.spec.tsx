// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../src/client/index.ts'
import { JingworkAccountMenu } from '../src/client/JingworkAccountMenu.tsx'
import { en, zh, type AccountKey } from '../src/client/locales.ts'

type MenuProps = Parameters<typeof JingworkAccountMenu>[0]

afterEach(() => { cleanup() })

function mount(copy: Record<AccountKey, string> = en, overrides: Partial<MenuProps> = {}) {
  const props: MenuProps = {
    ...({} as GlobalStandardProps),
    wide: true, settingsOpen: false, guideAvailable: true,
    openSettings: vi.fn(), openSection: vi.fn(), openOnboarding: vi.fn(),
    useIdentity: selector => selector('jingwork-user'),
    signOut: vi.fn(async () => {}),
    t: key => copy[key as AccountKey],
    ...overrides,
  }
  const view = render(<JingworkAccountMenu {...props} />)
  return { props, view }
}

it.each([en, zh])('shows permanent settings, models, guide and sign-out entries', async (copy) => {
  mount(copy, { settingsShortcut: { keys: ['⌘', ','], aria: 'Meta+,' } })
  fireEvent.click(screen.getByRole('button', { name: copy.menu }))
  const menu = screen.getByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual([
    `${copy.settings}⌘,`, copy.modelSettings, copy.usageGuide, copy.signOut,
  ])
  const settings = within(menu).getByRole('menuitem', { name: copy.settings })
  expect(settings.getAttribute('aria-keyshortcuts')).toBe('Meta+,')
  await expect(`${menu.textContent}\n`).toMatchFileSnapshot(`./expected/jingwork-menu-${copy === en ? 'en' : 'zh'}.txt`)
})

for (const copy of [en, zh]) {
  for (const destination of ['settings', 'models', 'guide'] as const) {
    it(`opens ${destination} from the ${copy === en ? 'English' : 'Chinese'} menu after restoring trigger focus`, () => {
      const focused = () => { expect(document.activeElement).toBe(screen.getByRole('button', { name: copy.menu })) }
      const openSettings = vi.fn(focused)
      const openSection = vi.fn((_id: string) => { focused() })
      const openOnboarding = vi.fn((_id: string) => { focused() })
      const { props } = mount(copy, { openSettings, openSection, openOnboarding })
      fireEvent.click(screen.getByRole('button', { name: copy.menu }))
      const label = destination === 'settings' ? copy.settings : destination === 'models' ? copy.modelSettings : copy.usageGuide
      fireEvent.click(screen.getByRole('menuitem', { name: label }))
      expect(screen.queryByRole('menu')).toBeNull()
      expect(openSettings).toHaveBeenCalledTimes(destination === 'settings' ? 1 : 0)
      expect(openSection).toHaveBeenCalledTimes(destination === 'models' ? 1 : 0)
      expect(openOnboarding).toHaveBeenCalledTimes(destination === 'guide' ? 1 : 0)
      if (destination === 'models') expect(openSection).toHaveBeenCalledWith('models')
      if (destination === 'guide') expect(openOnboarding).toHaveBeenCalledWith('jingwork-setup')
      expect(props.signOut).not.toHaveBeenCalled()
    })
  }
}

it.each([en, zh])('keeps Models available in Harness opt-in auth while omitting the JingWork guide', (copy) => {
  const { props } = mount(copy, { guideAvailable: false })
  fireEvent.click(screen.getByRole('button', { name: copy.menu }))
  expect(screen.queryByRole('menuitem', { name: copy.usageGuide })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: copy.modelSettings }))
  expect(props.openSection).toHaveBeenCalledWith('models')
})

it('shows loading identity in the expanded sidebar and keeps its collapsed menu accessible', () => {
  const { props, view } = mount(en, { useIdentity: selector => selector(null) })
  expect(screen.getByText(en.loading)).toBeTruthy()
  view.rerender(<JingworkAccountMenu {...props} wide={false} />)
  expect(screen.queryByText(en.loading)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.menu }))
  expect(screen.getByRole('menuitem', { name: en.modelSettings })).toBeTruthy()
})

it('disables repeated sign-out while the native operation is pending', async () => {
  const pending = Promise.withResolvers<undefined>()
  const signOut = vi.fn(() => pending.promise)
  const { props } = mount(en, { signOut })
  try {
    fireEvent.click(screen.getByRole('button', { name: en.menu }))
    fireEvent.click(screen.getByRole('menuitem', { name: en.signOut }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.menu }))
    expect(screen.getByRole('menuitem', { name: en.signOut }).hasAttribute('disabled')).toBe(true)
  } finally {
    await act(async () => { pending.resolve(undefined) })
  }
  expect(screen.getByRole('menuitem', { name: en.signOut }).hasAttribute('disabled')).toBe(false)
  expect(props.openSettings).not.toHaveBeenCalled()
  expect(props.openSection).not.toHaveBeenCalled()
  expect(props.openOnboarding).not.toHaveBeenCalled()
})

it('reports a failed native sign-out through the existing account feedback', async () => {
  mount(zh, { signOut: vi.fn(async () => { throw new Error('native sign-out failed') }) })
  fireEvent.click(screen.getByRole('button', { name: zh.menu }))
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: zh.signOut })) })
  expect(screen.getByText(zh.failed)).toBeTruthy()
  expect(screen.queryByRole('menu')).toBeNull()
})
