/** Build real Agent compositions from expert and team configuration. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Expert, WorkbenchData } from './types.ts'
import { AGENT_TOOL_GROUPS } from './agent-options.ts'
import { resolveExpert } from './expert.ts'

/** Deployment limits applied to backend knowledge retrieval. */
export interface KnowledgeRetrievalPolicy {
  /** Per-query timeout in milliseconds. */
  timeoutMs: number
  /** Maximum response bytes supplied to the model. */
  maxBytes: number
}

/** Stable preset key shared by navigation and the Host registry.
 * @param slug User-configured expert or team key.
 * @returns The workbench-owned preset id.
 */
export function workbenchPreset(slug: string): string {
  return `workbench-${slug}`
}

/** Compose an expert with standard filesystem, shell, skill, search and delegation tools.
 * @param expert Configured expert.
 * @param data Profile configuration containing selected skills and connectors.
 * @param knowledgePolicy Deployment retrieval limits.
 * @returns A scoped Agent preset; access policy remains owned by the deployment.
 */
export function expertPreset(
  expert: Expert,
  data: WorkbenchData,
  knowledgePolicy: KnowledgeRetrievalPolicy = { timeoutMs: 15000, maxBytes: 262144 },
): PresetDefinition {
  const resolved = resolveExpert(expert)
  const extra = data.skills
    .filter(skill => expert.skills.includes(skill.slug))
    .map(skill => `\n\n## ${skill.name}\n${skill.content}`)
    .join('')
  const selectedTools = expert.tools ?? AGENT_TOOL_GROUPS
  const tools = [
    ['agent-instructions', { maxBytes: 65536 }],
    ['time-context', {}],
    ['tool-fs', { applyPatch: false }],
    ['tool-fs-search', { sampleOverCapGlobResults: false }],
    ['skill-filesystem', {}],
    ['tool-skill', {}],
    ['tool-web', { fetch: true }],
    ['tool-todo', { allowParallelInProgress: true }],
    ['tool-goal', {}],
    ['tool-ask-user', {}],
    ['tool-present', {}],
    [process.platform === 'win32' ? 'tool-pwsh' : 'tool-bash', {}],
    ['tool-subagent-control', {}],
    ['tool-subagent', { provider: 'spawn', toolName: 'subagent', modelSelection: true, modelDiscovery: true }],
  ] as const
  return {
    id: workbenchPreset(expert.slug),
    name: expert.name,
    description: expert.description,
    plugins: [
      { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: expert.instructions + extra } },
      ...resolved.knowledge.trim() || expert.knowledgeBases?.length ? [{
        id: 'knowledge',
        name: '@deepseek-ai/dsh-knowledge',
        config: { content: resolved.knowledge, ...(expert.knowledgeBases?.length ? {
          retrieval: { bases: expert.knowledgeBases, urlEnv: 'DSH_KNOWLEDGE_URL', tokenEnv: 'DSH_KNOWLEDGE_TOKEN',
            ...knowledgePolicy },
        } : {}) },
      }] : [],
      ...tools.filter(([name]) => {
        if (['tool-fs', 'tool-fs-search', 'skill-filesystem', 'tool-skill'].includes(name)) return selectedTools.includes('files')
        if (name === 'tool-web') return selectedTools.includes('web')
        if (name === 'tool-bash' || name === 'tool-pwsh') return selectedTools.includes('shell')
        if (name === 'tool-todo' || name === 'tool-goal') return selectedTools.includes('tasks')
        if (name === 'tool-ask-user' || name === 'tool-present') return selectedTools.includes('interaction')
        if (name === 'tool-subagent' || name === 'tool-subagent-control') return expert.subagents === undefined || expert.subagents.length > 0
        return true
      }).map(([name, config]) => ({
        id: name, name: `@deepseek-ai/dsh-${name}`,
        config: name === 'tool-subagent' && expert.subagents !== undefined
          ? { ...config, allowedAgentPresets: expert.subagents.map(workbenchPreset) }
          : config,
      })),
      ...data.connectors
        .filter(connector => expert.customKnowledgeBases?.some(base => base.connector === connector.slug))
        .map(connector => ({
          id: `knowledge-${connector.slug}`, name: '@deepseek-ai/dsh-client-ui-workbench/mcp-knowledge',
          config: {
            serverName: connector.slug,
            url: connector.url,
            timeoutMs: knowledgePolicy.timeoutMs,
            maxBytes: knowledgePolicy.maxBytes,
            bases: expert.customKnowledgeBases
              ?.filter(base => base.connector === connector.slug)
              .map(({ id, name }) => ({ id, name })) ?? [],
          },
        })),
      ...data.connectors
        .filter(connector => connector.enabled && expert.connectors.includes(connector.slug))
        .map(connector => ({
          id: `mcp-${connector.slug}`,
          name: connector.builtin
            ? '@deepseek-ai/dsh-client-ui-workbench/connector'
            : connector.transport === 'streamable-http'
              ? '@deepseek-ai/dsh-client-ui-workbench/custom-connector'
              : '@deepseek-ai/dsh-mcp-client',
          config: connector.builtin ? {
            kind: connector.builtin, serverName: connector.slug,
          } : {
            transport: connector.transport,
            serverName: connector.slug,
            ...(connector.transport === 'streamable-http'
              ? { url: connector.url }
              : { command: connector.command, args: connector.args }),
            failOnStartupError: true,
          },
        })),
    ],
  }
}

/** Compose enabled assistants and teams whose members are all enabled.
 * @param data Validated profile configuration.
 * @param knowledgePolicy Deployment retrieval limits.
 * @returns Scoped compositions for experts and teams.
 * @throws When slugs repeat or a team references a removed expert.
 */
export function workbenchPresets(data: WorkbenchData, knowledgePolicy?: KnowledgeRetrievalPolicy): PresetDefinition[] {
  const keys = [...data.experts, ...data.teams].map(row => row.slug)
  if (new Set(keys).size !== keys.length) throw new Error('Workbench expert and team slugs must be unique')
  const resolved = data.experts.map(resolveExpert)
  const experts = resolved.filter(expert => expert.enabled).map(expert => expertPreset(expert, data, knowledgePolicy))
  return [
    ...experts,
    ...data.teams.flatMap((team) => {
      const members = team.members.map((slug) => {
        const member = resolved.find(expert => expert.slug === slug)
        if (member === undefined) throw new Error(`Team ${team.slug} references missing expert ${slug}`)
        return member
      })
      if (members.some(member => !member.enabled)) return []
      return [expertPreset(
        {
          slug: team.slug,
          name: team.name,
          description: team.description,
          instructions: `${team.instructions}\n\n你是专家团队的协调者。成员职责如下：\n${members.map(member => `### ${member.name}\n${member.instructions}`).join('\n\n')}\n\n需要并行工作时，使用 subagent 工具将子任务和对应成员职责交给子智能体。核验并汇总成员结果；不要把尚未执行的分工写成已完成。`,
          customKnowledgeBases: [...new Map(
            members.flatMap(member => member.customKnowledgeBases ?? [])
              .map(base => [JSON.stringify([base.connector, base.id]), base]),
          ).values()],
          knowledgeBases: [...new Set(members.flatMap(member => member.knowledgeBases ?? []))],
          knowledge: members
            .filter(member => member.knowledge.trim())
            .map(member => `### ${member.name}\n${member.knowledge}`)
            .join('\n\n'),
          skills: [...new Set(members.flatMap(member => member.skills))],
          connectors: [...new Set(members.flatMap(member => member.connectors))],
        },
        data,
        knowledgePolicy,
      )]
    }),
  ]
}
