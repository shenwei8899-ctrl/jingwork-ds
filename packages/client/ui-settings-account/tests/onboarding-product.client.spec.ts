import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { en, zh, ja, es, fr, de, ru, pt } from '../src/client/locales.ts'
import { onboardingProductCopy } from '../src/client/onboarding-product.ts'

it.each([en, zh, ja, es, fr, de, ru, pt])('resolves JingWork branding in every supported onboarding language', (copy) => {
  const translate = onboardingProductCopy(key => copy[key], 'jingwork')
  expect(translate('onboardingBrand')).toBe('JingWork')
  for (const key of ['onboardingIntroduction', 'onboardingCreditDescription', 'onboardingProcessDescription', 'onboardingNoCreditDescription'] as const) {
    expect(translate(key)).toContain('JingWork')
    expect(translate(key)).not.toContain('DeepSeek Harness')
  }
})

it('keeps the Harness locale binding unchanged', () => {
  const translate = (key: keyof typeof en) => en[key]
  expect(onboardingProductCopy(translate, 'harness')).toBe(translate)
})

it('scopes the JingWork responsive layout and uses theme-owned artwork colors', () => {
  const page = readFileSync(new URL('../src/client/DesktopOnboarding.module.css', import.meta.url), 'utf8')
  const artwork = readFileSync(new URL('../src/client/JingworkOnboardingArtwork.module.css', import.meta.url), 'utf8')
  expect(page).toContain(".page[data-product='jingwork'] { --page-padding: clamp(24px, 5vw, 64px); overflow: auto; }")
  expect(page).toContain('@media (max-width: 800px)')
  expect(page).toContain(".page[data-product='jingwork'] .purposeCards, .page[data-product='jingwork'] .processCards { grid-template-columns: minmax(0, 1fr); }")
  expect(artwork).toContain('color: var(--dsw-alias-label-primary)')
  expect(artwork).toContain('background: var(--dsw-alias-bg-layer-3)')
  expect(artwork).toContain('var(--dsw-alias-state-done-primary)')
  expect(artwork).not.toMatch(/#[a-f\d]{3,8}\b/i)
})
