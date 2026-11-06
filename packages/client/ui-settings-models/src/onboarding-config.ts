/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

/** Device-local completion of the JingWork model introduction. */
export interface JingworkSetupSettings {
  jingworkSetupComplete: boolean
}

/** Onboarding options after schema defaults are applied. */
export interface Config {
  /** Offer the browser API-key step when no native shell owns credential onboarding. */
  credentialOnboarding: boolean
  /** Whether this installation completed or explicitly skipped the JingWork model guide. */
  jingworkSetupComplete: Volatile<boolean>
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config = z.object({
  credentialOnboarding: z.boolean().default(true),
  jingworkSetupComplete: z.boolean().default(false).volatile(),
})

/** Host entry carrying the JingWork guide's durable completion marker. */
export const JINGWORK_SETUP_NAMESPACE = 'ui-settings-models'

/** Page-global key carrying only the public onboarding options. */
export const ONBOARDING_CONFIG_GLOBAL = '__DSH_MODELS_ONBOARDING__'
