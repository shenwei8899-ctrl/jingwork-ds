/** Build real Agent compositions from expert and team configuration. */
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Expert, WorkbenchData } from './types.ts'
import { resolveExpert } from './expert.ts'

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
 * @returns A scoped Agent preset; access policy remains owned by the deployment.
 */
export function expertPreset(expert: Expert, data: WorkbenchData): PresetDefinition {
  const extra = data.skills
    .filter(skill => expert.skills.includes(skill.slug))
    .map(skill => `\n\n## ${skill.name}\n${skill.content}`)
    .join('')
  const tools = [
    ['agent-instructions', { maxBytes: 65536 }],
    ['time-context', {}],
    ['tool-fs', { applyPatch: false }],
    ['tool-fs-search', { sampleOverCapGlobResults: false }],
    ['skill-filesystem', {}],
    ['tool-skill', {}],
    ['tool-web', { fetch: true }],
    ['tool-todo', { allowParallelInProgress: true }],
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
      ...tools.map(([name, config]) => ({ id: name, name: `@deepseek-ai/dsh-${name}`, config })),
      ...data.connectors
        .filter(connector => connector.enabled && expert.connectors.includes(connector.slug))
        .map(connector => ({
          id: `mcp-${connector.slug}`,
          name: '@deepseek-ai/dsh-mcp-client',
          config: {
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
 * @returns Scoped compositions for experts and teams.
 * @throws When slugs repeat or a team references a removed expert.
 */
export function workbenchPresets(data: WorkbenchData): PresetDefinition[] {
  const keys = [...data.experts, ...data.teams].map(row => row.slug)
  if (new Set(keys).size !== keys.length) throw new Error('Workbench expert and team slugs must be unique')
  const resolved = data.experts.map(resolveExpert)
  const experts = resolved.filter(expert => expert.enabled).map(expert => expertPreset(expert, data))
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
          skills: [...new Set(members.flatMap(member => member.skills))],
          connectors: [...new Set(members.flatMap(member => member.connectors))],
        },
        data,
      )]
    }),
  ]
}
