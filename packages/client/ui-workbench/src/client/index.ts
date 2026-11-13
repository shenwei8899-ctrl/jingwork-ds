/** Jingwork-style workbench navigation backed by profile settings and real Agent presets. */
import workbenchRemote from '@deepseek-ai/dsh-client-ui-workbench/remote'
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
import { JingworkBrandMark, JingworkBrandName } from './Brand.tsx'
import { AgentHome } from './AgentHome.tsx'
import { AssistantsPage } from './assistants.tsx'
import { AssistantsFactory, LibraryFactory, ResourcesFactory } from './factories.tsx'
import { KnowledgePage } from './KnowledgePage.tsx'
import { AssistantNotice, createAssistantNoticeStore } from './assistant-notice.tsx'
import { PreviewNavigation, type PreviewFace } from './preview-navigation.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { connectorCredentialRef } from '../connector-catalog.ts'
import { WorkbenchController } from './controller.ts'
import { zh, en, type WorkbenchKey } from './locales.ts'

type WorkbenchFactoryDefinition = {
  scope: 'root'
  inject: WorkbenchFace
  locale: 'workbench'
  store: ReturnType<typeof createAssistantNoticeStore>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    workbench: WorkbenchKey
  }
  interface SlotFactoryMap {
    /** Assistant catalog and creation flow over the profile's workbench settings. */
    'workbench.assistants': WorkbenchFactoryDefinition
    /** One editable resource collection backed by the profile's workbench settings. */
    'workbench.resources': WorkbenchFactoryDefinition & {
      props: { kind: 'experts' | 'skills' | 'connectors' }
    }
    /** Workspace file browsing through existing access and preview commands. */
    'workbench.library': WorkbenchFactoryDefinition
    /** Reference material saved with each configured assistant. */
    'workbench.knowledge': WorkbenchFactoryDefinition
  }
}
/** Required browser services. */
export const inject = [
  'slots',
  'sessions',
  'conversation',
  'locale',
  'configForms',
  'remote',
  'remote.agentPresets',
  'remote.credentials',
  'remote.session',
  'remote.workspaceFiles',
  'uiWorkspace',
  'sidebarRight',
  'layout',
]
/** Register workbench pages and the assistant, capability and library navigation entries.
 * @param ctx Browser plugin context.
 * @returns Once the connector Remote namespace is mounted.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(workbenchRemote)
  ctx.effect(() => unmount, 'workbench: connector Remote')
  ctx.inject(['remote.workbenchConnectors'], registerWorkbench)
}

function registerWorkbench(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register('workbench', { zh, en, ja: en, es: en, fr: en, de: en, ru: en, pt: en }),
    'workbench: dictionaries',
  )
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, JingworkBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: 'workbench' }, JingworkBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, JingworkBrandMark))
  const jingwork = (globalThis as typeof globalThis & {
    dshJingwork?: {
      knowledgeBases: () => Promise<{ id: string; name: string; description: string }[]>
      agents: () => Promise<{ id: string; name: string; description: string }[]>
      openAgent: (id: string) => Promise<string>
      logOperation?: (operation: string, outcome: 'success' | 'failed') => Promise<void>
    }
  }).dshJingwork
  const audit = (operation: string, result: unknown): void => {
    void jingwork?.logOperation?.(operation, result === null ? 'success' : 'failed').catch((_error: unknown) => {
      console.warn('Desktop operation log could not be queued. Check native log storage.')
    })
  }
  const enterprisePrefix = 'jingwork-enterprise:'
  const presetSettings = ctx.configForms.get<{ default: string; selectedDefault?: string }>('agent-preset-registry')
  const controller = new WorkbenchController({
    restoreDefault: async (preset) => {
      const snapshot = presetSettings.getSnapshot()
      if (snapshot.value?.selectedDefault !== preset || snapshot.value.default === preset) return 'defaultInUse'
      const accepted = await presetSettings.mutate([{ op: 'unset', path: ['selectedDefault'] }], snapshot.revision)
      return accepted ? null : 'saveError'
    },
    ...(jingwork === undefined ? {} : {
      listKnowledgeBases: () => jingwork.knowledgeBases(),
      listEnterprise: async () => (await jingwork.agents()).map(agent => ({
        slug: enterprisePrefix + agent.id, name: agent.name, description: agent.description,
        category: 'enterprise' as const, enabled: true, instructions: '', skills: [], connectors: [],
      })),
    }),
    form: ctx.configForms.get('ui-workbench'),
    listSessions: (...args) => ctx.remote.session.list(...args),
    readSessionProjections: (...args) => ctx.remote.session.projections(...args),
    listModels: () => ctx.remote.session.modelCatalog(),
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
  const t = ctx.locale.bind('workbench')
  const face = (page: WorkbenchFace['page']): WorkbenchFace => ({
    page,
    hooks: { form: controller.form, catalog: controller.source },
    listConnectorKnowledge: async (url, slug, signal) => {
      try {
        const result = await ctx.remote.workbenchConnectors.listKnowledge(url, slug, signal)
        return result.ok ? result.value : { status: 'failed', bases: [] }
      } catch (_error: unknown) {
        return { status: 'failed', bases: [] }
      }
    },
    listConnectorTools: async (url, slug, signal) => {
      try {
        const result = await ctx.remote.workbenchConnectors.listTools(url, slug, signal)
        return result.ok ? result.value : { status: 'failed', tools: [] }
      } catch (_error: unknown) {
        return { status: 'failed', tools: [] }
      }
    },
    testConnector: async (url, key, slug, linkerApiKey) => {
      try {
        const result = await ctx.remote.workbenchConnectors.test(url, key, slug, linkerApiKey)
        if (!result.ok) return 'connectorTestFailed'
        return result.value === 'connected' ? 'connectorTestConnected' : result.value === 'invalid' ? 'connectorInvalid' : 'connectorTestFailed'
      } catch (_error: unknown) {
        return 'connectorTestFailed'
      }
    },
    saveConnectorCredentials: async (slug, value) => {
      try {
        if ('authorization' in value || 'linker_api_key' in value) {
          const result = await ctx.remote.workbenchConnectors.saveCredentials(slug, value.authorization ?? '', value.linker_api_key ?? '')
          return result.ok && result.value ? null : 'connectorCredentialError'
        }
        const result = await ctx.remote.credentials.set(connectorCredentialRef(slug), JSON.stringify(value))
        return result.ok ? null : 'connectorCredentialError'
      } catch (_error: unknown) {
        return 'connectorCredentialError'
      }
    },
    setEnabled: async (...args) => {
      const result = await controller.setEnabled(...args)
      audit('settings_change', result)
      return result
    },
    setDefault: async (slug) => {
      try {
        const accepted = await presetSettings.set('selectedDefault', `workbench-${slug}`)
        if (!accepted) { audit('settings_change', 'saveError'); return 'saveError' }
        await controller.load()
        audit('settings_change', null)
        return null
      } catch (_error) {
        audit('settings_change', 'saveError')
        return 'saveError'
      }
    },
    load: () => controller.load(),
    loadLibrary: () => controller.loadLibrary(),
    save: async (...args) => {
      const result = await controller.save(...args)
      audit(args[0] === 'experts' ? 'agent_save' : 'settings_change', result)
      return result
    },
    remove: async (...args) => {
      const result = await controller.remove(...args)
      audit(args[0] === 'experts' ? 'agent_remove' : 'settings_change', result)
      return result
    },
    importData: async (raw) => {
      const result = await controller.import(raw)
      audit('config_import', result)
      return result
    },
    files: (...args) => controller.files(...args),
    preview: (...args) => controller.preview(...args),
    download: (...args) => controller.download(...args),
    start: (slug) => {
      if (jingwork !== undefined && slug.startsWith(enterprisePrefix)) {
        return jingwork.openAgent(slug.slice(enterprisePrefix.length)).then((agentPreset) => {
          ctx.uiWorkspace.startSession(undefined, { agentPreset })
          audit('session_start', null)
        })
      }
      ctx.uiWorkspace.startSession(undefined, { agentPreset: `workbench-${slug}` })
      audit('session_start', null)
    },
  })
  ctx.slots.registerFactory({
    name: 'workbench.assistants', scope: 'root', locale: 'workbench', store: notices,
    inject: () => face('assistants'),
  }, AssistantsFactory)
  ctx.slots.registerFactory({
    name: 'workbench.resources', scope: 'root', locale: 'workbench', store: notices,
    inject: () => face('capabilities'),
  }, ResourcesFactory)
  ctx.slots.registerFactory({
    name: 'workbench.library', scope: 'root', locale: 'workbench', store: notices,
    inject: () => face('library'),
  }, LibraryFactory)
  ctx.slots.registerFactory({
    name: 'workbench.knowledge', scope: 'root', locale: 'workbench', store: notices,
    inject: () => face('assistants'),
  }, KnowledgePage)
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
          inject: () => face(page),
        },
        page === 'assistants' ? AssistantsPage : WorkbenchPage,
      ),
    )
    if (page !== 'experts') {
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id, order: order - 40, locale: 'workbench', label: () => t(page) },
          Icon,
        ),
      )
    }
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'workbench-agent-home', locale: 'workbench',
    inject: sessionId => ({
      hooks: { form: controller.form },
      sendPrompt: (prompt: string) => {
        const scope = ctx.sessions.scope(sessionId)
        if (!scope) throw new Error('Session is no longer available')
        const input = ctx.conversation.input.for(scope)
        input.setDraft(prompt)
        input.submit('queue', 'click')
      },
    }),
  }, AgentHome))
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
