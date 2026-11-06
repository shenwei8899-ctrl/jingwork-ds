/** Product identity applied to locale-owned introduction copy. */
import type { AccountKey } from './locales.ts'

/** Immutable Desktop product supplied by its native preload. */
export type OnboardingProduct = 'harness' | 'jingwork'

/**
 * Resolve product names inside the existing localized onboarding sentences.
 * @param translate - Account locale binding.
 * @param product - Installed Desktop product.
 * @returns Locale binding with the installed product's name.
 */
export function onboardingProductCopy(
  translate: (key: AccountKey) => string,
  product: OnboardingProduct,
): (key: AccountKey) => string {
  return product === 'harness' ? translate : key => translate(key).replaceAll('DeepSeek Harness', 'JingWork')
}
