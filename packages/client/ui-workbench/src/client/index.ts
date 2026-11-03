/** Jingwork-style workbench navigation backed by profile settings and real Agent presets. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  WorkbenchPage,
  WorkbenchIcon,
  AssistantIcon,
  CapabilityIcon,
  LibraryIcon,
  type WorkbenchFace,
} from './page.tsx'
import { AssistantsPage } from './assistants.tsx'
import { AssistantNotice, createAssistantNoticeStore } from './assistant-notice.tsx'
import { PreviewNavigation, type PreviewFace } from './preview-navigation.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { WorkbenchController } from './controller.ts'
import { zh, en, type WorkbenchKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    workbench: WorkbenchKey
  }
}
/** Required browser services. */
export const inject = [
  'slots',
  'locale',
  'configForms',
  'remote',
  'remote.agentPresets',
  'remote.workspaceFiles',
  'uiWorkspace',
  'sidebarRight',
  'layout',
]
/** Register the four workbench pages and their sidebar entries.
 * @param ctx Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register('workbench', { zh, en, ja: en, es: en, fr: en, de: en, ru: en, pt: en }),
    'workbench: dictionaries',
  )
  const controller = new WorkbenchController({
    form: ctx.configForms.get('ui-workbench'),
    listPresets: () => ctx.remote.agentPresets.list(),
    listFiles: (...args) => ctx.remote.workspaceFiles.list(...args),
    statFile: (...args) => ctx.remote.workspaceFiles.stat(...args),
    readFileBytes: (...args) => ctx.remote.workspaceFiles.readBytes(...args),
    beginNavigation: () => ctx.layout.beginNavigation(),
    openSession: (id) => {
      ctx.uiWorkspace.openSession(id)
    },
    openResource: (address) => {
      ctx.sidebarRight.openResource(address)
    },
  })
  ctx.effect(
    () => () => {
      controller.dispose()
    },
    'workbench: pending reads',
  )
  const notices = createAssistantNoticeStore()
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'workbench-assistant-notices', locale: 'workbench', store: notices },
      AssistantNotice,
    ),
  )
  const presetSettings = ctx.configForms.get('agent-preset-registry')
  const t = ctx.locale.bind('workbench')
  const pages = ['assistants', 'experts', 'capabilities', 'library'] as const
  for (const [order, page] of pages.entries()) {
    const id = `workbench-${page}` as MainPanelId
    const Icon = {
      assistants: AssistantIcon,
      experts: WorkbenchIcon,
      capabilities: CapabilityIcon,
      library: LibraryIcon,
    }[page]
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        {
          name: 'main',
          key: id,
          locale: 'workbench',
          store: notices,
          inject: (): WorkbenchFace => ({
            page,
            hooks: { form: controller.form, catalog: controller.source },
            setEnabled: (...args) => controller.setEnabled(...args),
            setDefault: async (slug) => {
              try {
                const accepted = await presetSettings.set('selectedDefault', `workbench-${slug}`)
                if (!accepted) return 'saveError'
                await controller.load()
                return null
              } catch (_error) {
                return 'saveError'
              }
            },
            load: () => controller.load(),
            save: (...args) => controller.save(...args),
            remove: (...args) => controller.remove(...args),

            importData: raw => controller.import(raw),
            files: (...args) => controller.files(...args),
            preview: (...args) => controller.preview(...args),
            download: (...args) => controller.download(...args),
            start: (slug) => {
              ctx.uiWorkspace.startSession(undefined, { agentPreset: `workbench-${slug}` })
            },
          }),
        },
        page === 'assistants' ? AssistantsPage : WorkbenchPage,
      ),
    )
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id, order: order - 40, locale: 'workbench', label: () => t(page) },
        Icon,
      ),
    )
  }
  ctx.slots.inject('conversation.input.overlay', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'workbench-preview-navigation',
        locale: 'workbench',
        inject: (): PreviewFace => ({
          hooks: { catalog: controller.source, mounted: ctx.sidebarRight.mounted },
          completePreview: (request) => {
            controller.completePreview(request)
          },
        }),
      },
      PreviewNavigation,
    ),
  )
  ctx.effect(
    () =>
      ctx.layout.panelInfo.subscribe(() => {
        if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) controller.cancelPreview()
      }),
    'workbench: panel navigation cancellation',
  )
  ctx.effect(
    () =>
      ctx.sidebarRight.mounted.subscribe(() => {
        const mounted = ctx.sidebarRight.mounted.getSnapshot()
        const pending = controller.source.getSnapshot().pendingPreview
        if (mounted !== undefined && pending !== null && mounted !== pending.sessionId)
          controller.cancelPreview()
      }),
    'workbench: session navigation cancellation',
  )
  ctx.on('connection/reset', () => {
    void controller.load()
  })
  ctx.effect(
    () =>
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (namespace === 'ui-workbench' || namespace === 'agent-preset-registry') void controller.load()
      }),
    'workbench: roster invalidations',
  )
}
