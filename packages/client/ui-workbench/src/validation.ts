/** Validate imported configuration and references before Settings writes. */
import { builtinConnector } from './connector-catalog.ts'
import z from '@deepseek-ai/schemastery'
import { agentOptionSchema } from './agent-options.ts'
import type { WorkbenchData } from './types.ts'
const slug = z
  .string()
  .pattern(/^[a-z0-9][a-z0-9_-]{0,31}$/)
  .required()
const name = z.string().min(1).max(120).required()
const text = z.string().max(65536).required()
/** Complete editable data accepted by configuration import. */
const schema = z.object({
  experts: z
    .array(
      z.object({
        slug,
        category: z.union(['personal', 'enterprise', 'builtin']),
        enabled: z.boolean(),
        name,
        description: text,
        instructions: z.string().min(1).max(65536).required(),
        ...agentOptionSchema,
        knowledge: z.string().max(65536).default(''),
        skills: z.array(slug).required(),
        connectors: z.array(slug).required(),
      }),
    )
    .required(),
  teams: z
    .array(
      z.object({
        slug,
        name,
        description: text,
        instructions: z.string().min(1).max(65536).required(),
        members: z.array(slug).min(1).required(),
      }),
    )
    .required(),
  skills: z
    .array(z.object({ slug, name, description: text, content: z.string().min(1).max(65536).required() }))
    .required(),
  connectors: z
    .array(
      z.object({
        slug,
        name,
        builtin: z.string(),
        transport: z.union(['streamable-http', 'stdio']).required(),
        url: text,
        command: text,
        args: z.array(String).required(),
        enabled: z.boolean().required(),
      }),
    )
    .required(),
})
/** Parse configuration and reject duplicate keys, missing references and invalid connectors.
 * @param input Configuration from a JSON file, editor or profile.
 * @returns Validated editable configuration.
 * @throws When any entity or reference is invalid.
 */
export function validateWorkbench(input: unknown): WorkbenchData {
  const data: WorkbenchData = z.resolve(input, schema, {})[0] as WorkbenchData
  for (const rows of [[...data.experts, ...data.teams], data.skills, data.connectors]) {
    if (new Set(rows.map(row => row.slug)).size !== rows.length) throw new Error('Duplicate workbench key')
  }
  const references = (selected: string[], available: { slug: string }[]) => {
    if (new Set(selected).size !== selected.length || selected.some(key => !available.some(row => row.slug === key)))
      throw new Error('Invalid workbench reference')
  }
  for (const expert of data.experts) {
    for (const base of expert.customKnowledgeBases ?? []) {
      if (!data.connectors.some(connector => connector.slug === base.connector && !connector.builtin && connector.transport === 'streamable-http' && connector.enabled)) throw new Error('Custom knowledge requires an enabled HTTP connector')
    }
    references(expert.subagents ?? [], data.experts)
    if (expert.enabled !== false && expert.subagents?.some(slug => data.experts.find(row => row.slug === slug)?.enabled === false)) throw new Error('Subagent must be enabled')
    if (expert.subagents?.includes(expert.slug)) throw new Error('Assistant cannot delegate to itself')
    if (expert.tools && new Set(expert.tools).size !== expert.tools.length) throw new Error('Duplicate tool group')
    if (expert.quickPrompts && new Set(expert.quickPrompts.map(card => card.id)).size !== expert.quickPrompts.length) throw new Error('Duplicate shortcut key')
    references(expert.skills, data.skills)
    references(expert.connectors, data.connectors)
  }
  for (const team of data.teams) references(team.members, data.experts)
  for (const connector of data.connectors) {
    if (connector.builtin !== undefined) {
      if (!builtinConnector(connector.builtin)) throw new Error('Unknown built-in connector')
    } else if (connector.transport === 'streamable-http') {
      if (!['http:', 'https:'].includes(new URL(connector.url).protocol)) throw new Error('Connector must use HTTP')
    } else if (!connector.command.trim()) throw new Error('Connector command is required')
  }
  return data
}
