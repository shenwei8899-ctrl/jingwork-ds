import { describe, expect, it } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { desktopPresentationProduct, desktopProductName, desktopWelcomeLocale } from '../src/product-presentation.ts'

describe('Desktop product presentation', () => {
  it('supplies native product names for renderer titles', () => {
    expect(desktopProductName('jingwork')).toBe('JingWork')
    expect(desktopProductName('harness')).toBe('DeepSeek Harness')
  })
  it.each([
    [[], 'harness'],
    [['electron', '--dsh-desktop-product=harness'], 'harness'],
    [['electron', '--dsh-desktop-product=jingwork'], 'jingwork'],
    [['electron', '--dsh-jingwork-account'], 'harness'],
  ] as const)('resolves native renderer arguments %j', (args, expected) => {
    expect(desktopPresentationProduct(args)).toBe(expected)
  })

  it.each(['', 'other'])('rejects unsupported native renderer product %j', (product) => {
    expect(() => desktopPresentationProduct([`--dsh-desktop-product=${product}`])).toThrow('unsupported renderer product')
  })

  it.each(['en', 'zh-CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])('localizes JingWork welcome without mutating %s', (language) => {
    const harness = resolveDesktopLocale(language)
    const jingwork = desktopWelcomeLocale(harness, 'jingwork')
    expect(jingwork.messages).toMatchObject({ welcomeTitle: 'JingWork', welcomeBrand: 'JingWork', welcomeTaglineBrand: 'JingWork' })
    expect(jingwork.messages.welcomeKeyDescription).not.toContain('Harness')
    expect(jingwork.messages.welcomeSignIn).toBe(harness.messages.welcomeSignIn)
    expect(harness.messages.welcomeBrand).toBe('DeepSeek Harness')
    expect(desktopWelcomeLocale(harness, 'harness')).toBe(harness)
  })
})
