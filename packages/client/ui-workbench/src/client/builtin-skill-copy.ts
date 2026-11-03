/** Locale keys for the repository skill catalog. */
import type { WorkbenchKey } from './locales.ts'

/** Chinese and English display metadata is owned by the workbench dictionaries. */
export const BUILTIN_SKILL_COPY: Readonly<Record<string, { nameKey: WorkbenchKey; descriptionKey: WorkbenchKey }>> =
  {
    'agent-experience': {
      nameKey: 'builtinAgentExperienceName',
      descriptionKey: 'builtinAgentExperienceDescription',
    },
    'cordis-styling-nitpicking': {
      nameKey: 'builtinCordisStylingNitpickingName',
      descriptionKey: 'builtinCordisStylingNitpickingDescription',
    },
    'dsh-archive-agent-notes': {
      nameKey: 'builtinDshArchiveAgentNotesName',
      descriptionKey: 'builtinDshArchiveAgentNotesDescription',
    },
    'dsh-ci-test-reliability': {
      nameKey: 'builtinDshCiTestReliabilityName',
      descriptionKey: 'builtinDshCiTestReliabilityDescription',
    },
    'dsh-client-ui-ux': { nameKey: 'builtinDshClientUiUxName', descriptionKey: 'builtinDshClientUiUxDescription' },
    'dsh-code-review': { nameKey: 'builtinDshCodeReviewName', descriptionKey: 'builtinDshCodeReviewDescription' },
    'dsh-create-upgrade-guide': {
      nameKey: 'builtinDshCreateUpgradeGuideName',
      descriptionKey: 'builtinDshCreateUpgradeGuideDescription',
    },
    'dsh-doc': { nameKey: 'builtinDshDocName', descriptionKey: 'builtinDshDocDescription' },
    'dsh-error-handling': {
      nameKey: 'builtinDshErrorHandlingName',
      descriptionKey: 'builtinDshErrorHandlingDescription',
    },
    'dsh-find-simplifications': {
      nameKey: 'builtinDshFindSimplificationsName',
      descriptionKey: 'builtinDshFindSimplificationsDescription',
    },
    'dsh-merging-stacked-prs': {
      nameKey: 'builtinDshMergingStackedPrsName',
      descriptionKey: 'builtinDshMergingStackedPrsDescription',
    },
    'dsh-official-plugin-artwork': {
      nameKey: 'builtinDshOfficialPluginArtworkName',
      descriptionKey: 'builtinDshOfficialPluginArtworkDescription',
    },
    'dsh-pr-description': {
      nameKey: 'builtinDshPrDescriptionName',
      descriptionKey: 'builtinDshPrDescriptionDescription',
    },
    'dsh-pre-push-checks': {
      nameKey: 'builtinDshPrePushChecksName',
      descriptionKey: 'builtinDshPrePushChecksDescription',
    },
    'dsh-prose-standard': {
      nameKey: 'builtinDshProseStandardName',
      descriptionKey: 'builtinDshProseStandardDescription',
    },
    'dsh-responsive-ui': {
      nameKey: 'builtinDshResponsiveUiName',
      descriptionKey: 'builtinDshResponsiveUiDescription',
    },
    'dsh-session-projection': {
      nameKey: 'builtinDshSessionProjectionName',
      descriptionKey: 'builtinDshSessionProjectionDescription',
    },
    'dsh-speed-up-perf': {
      nameKey: 'builtinDshSpeedUpPerfName',
      descriptionKey: 'builtinDshSpeedUpPerfDescription',
    },
    'dsh-translate-docs': {
      nameKey: 'builtinDshTranslateDocsName',
      descriptionKey: 'builtinDshTranslateDocsDescription',
    },
    'dsh-trim-cot-leakage': {
      nameKey: 'builtinDshTrimCotLeakageName',
      descriptionKey: 'builtinDshTrimCotLeakageDescription',
    },
    'record-browser-gif': {
      nameKey: 'builtinRecordBrowserGifName',
      descriptionKey: 'builtinRecordBrowserGifDescription',
    },
  }
