/** Profile-persisted experts, teams, skills and MCP-backed Agent compositions. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { agentOptionSchema } from './agent-options.ts'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { SkillCandidate } from '@deepseek-ai/dsh-skill'
import { defaultWorkbench } from './defaults.ts'
import { validateWorkbench } from './validation.ts'
import { workbenchPresets, type KnowledgeRetrievalPolicy } from './presets.ts'
import { resolveExpert } from './expert.ts'
import type { Expert, WorkbenchData } from './types.ts'

/** Workbench configuration is edited through the shared Settings revision fence. */
export interface Config {
  /** Deployment limits for backend knowledge queries. */
  knowledgeRetrieval: KnowledgeRetrievalPolicy
  /** Individual expert definitions and capability assignments. */
  experts: Volatile<WorkbenchData['experts']>
  /** Coordinator instructions and expert membership. */
  teams: Volatile<WorkbenchData['teams']>
  /** Custom invocable Markdown skills. */
  skills: Volatile<WorkbenchData['skills']>
  /** MCP server settings; credentials remain in the Host environment. */
  connectors: Volatile<WorkbenchData['connectors']>
}
const slug = z
  .string()
  .pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/)
  .required()
const text = z.string().max(65536).required()
const defaults = defaultWorkbench()
/** Schemas also validate configuration arriving from another browser or a profile edit. */
export const Config = z.object({
  knowledgeRetrieval: z.object({
    timeoutMs: z.number().step(1).min(1).default(15000),
    maxBytes: z.number().step(1).min(1).default(262144),
  }).default({}),
  experts: z
    .array(
      z.object({
        slug,
        category: z.union(['personal', 'enterprise', 'builtin']),
        enabled: z.boolean(),
        name: z.string().min(1).max(120).required(),
        description: text,
        instructions: text,
        ...agentOptionSchema,
        knowledge: z.string().max(65536).default(''),
        skills: z.array(String).default([]),
        connectors: z.array(String).default([]),
      }) as z<Expert>,
    )
    .default(defaults.experts.map(expert => ({ ...expert, knowledge: expert.knowledge ?? '' })))
    .volatile(),
  teams: z
    .array(
      z.object({
        slug,
        name: z.string().min(1).max(120).required(),
        description: text,
        instructions: text,
        members: z.array(String).min(1).required(),
      }),
    )
    .default(defaults.teams)
    .volatile(),
  skills: z
    .array(z.object({ slug, name: z.string().min(1).max(120).required(), description: text, content: text }))
    .default([])
    .volatile(),
  connectors: z
    .array(
      z.object({
        slug,
        name: z.string().min(1).max(120).required(),
        builtin: z.string(),
        transport: z.union(['streamable-http', 'stdio']).required(),
        url: z.string().default(''),
        command: z.string().default(''),
        args: z.array(String).default([]),
        enabled: z.boolean().default(false),
      }),
    )
    .default([])
    .volatile(),
})
/** Services the workbench uses without replacing their persistence or policy. */
export const inject = ['settings', 'agentPresets', 'skills']

/** Mount configuration-owned skill discovery and serialized preset revisions.
 * @param ctx Host plugin context.
 * @param config Live, schema-validated configuration.
 * @returns Initial preset registration completion.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  ctx.effect(() => ctx.settings.configure({ auto: false }), 'workbench: settings presentation')
  const snapshot = (): WorkbenchData => ({
    experts: config.experts.get().map(({ skills, connectors, tools, subagents, quickPrompts, knowledgeBases, ...row }) => resolveExpert({
      ...row, skills: [...skills], connectors: [...connectors],
      ...(knowledgeBases ? { knowledgeBases: [...knowledgeBases] } : {}),
      ...(tools ? { tools: [...tools] } : {}),
      ...(subagents ? { subagents: [...subagents] } : {}),
      ...(quickPrompts ? { quickPrompts: quickPrompts.map(card => ({ ...card })) } : {}),
    })),
    teams: config.teams.get().map(row => ({ ...row, members: [...row.members] })),
    skills: config.skills.get().map(row => ({ ...row })),
    connectors: config.connectors.get().map(row => ({ ...row, args: [...row.args] })),
  })
  ctx.on('agent/created', ({ agent }) => {
    const preset = ctx.agentPresets.composedPreset(agent.ctx) ?? agent.session.header.agentPreset
    const expert = snapshot().experts.find(row => `workbench-${row.slug}` === preset)
    if (expert?.model && agent.session.seq === 0) agent.model.select(expert.model)
  })
  const mounted = new Map<string, { json: string; dispose: () => Promise<void> }>()
  let closed = false
  const isClosed = (): boolean => closed
  let tail: Promise<void> = Promise.resolve()
  const reconcile = (): Promise<void> => {
    const data = validateWorkbench(snapshot())
    const definitions = workbenchPresets(data, config.knowledgeRetrieval)
    const next = new Map(definitions.map(definition => [definition.id, definition]))
    tail = tail
      .catch((error: unknown) => {
        ctx.logger.error(error)
      })
      .then(async () => {
        if (isClosed()) return
        for (const [id, mountedPreset] of mounted) {
          if (JSON.stringify(next.get(id)) === mountedPreset.json) continue
          await mountedPreset.dispose()
          mounted.delete(id)
        }
        for (const definition of definitions) {
          if (isClosed()) return
          if (mounted.has(definition.id)) continue
          const dispose = await ctx.agentPresets.register(definition)
          mounted.set(definition.id, { json: JSON.stringify(definition), dispose })
        }
      })
    return tail
  }
  ctx.effect(
    () => async () => {
      closed = true
      await tail.catch((error: unknown) => {
        ctx.logger.error(error)
      })
      await Promise.all([...mounted.values()].map(preset => preset.dispose()))
      mounted.clear()
    },
    'workbench: preset generations',
  )
  ctx.skills.registerProvider((control) => {
    const summary = (skill: WorkbenchData['skills'][number]): SkillCandidate => ({
      name: skill.slug,
      description: skill.description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'workbench',
      source: 'custom',
      rank: 500,
      locator: skill.slug,
    })
    ctx.on('loader/volatile-update', () => {
      control.invalidate()
    })
    return {
      name: 'workbench',
      list: () => Promise.resolve(config.skills.get().map(skill => summary(skill))),
      get: (candidate) => {
        const skill = config.skills.get().find(row => row.slug === candidate.name)
        if (skill === undefined) return Promise.resolve(undefined)
        const { rank: _rank, locator: _locator, ...meta } = summary(skill)
        return Promise.resolve({ ...meta, content: skill.content })
      },
    }
  })
  ctx.on('loader/volatile-update', () => {
    void reconcile().catch((error: unknown) => {
      ctx.logger.error(error)
    })
  })
  await reconcile()
}
