/** Assistant ownership category within the profile. */
export type ExpertCategory = 'personal' | 'enterprise' | 'builtin'

/** Persistent expert, team, skill and connector configuration. Slugs are user-editable configuration keys. */
export type Expert = {
  /** Missing legacy ownership resolves to personal. */
  category?: ExpertCategory
  /** Missing legacy activation resolves to enabled; disabling affects new sessions only. */
  enabled?: boolean
  /** User-editable key used by references and imports. */
  slug: string
  /** Display name shown in the workbench. */
  name: string
  /** Short description shown on the card. */
  description: string
  /** Role instructions included in the preset persona. */
  instructions: string
  /** Custom skill keys whose content augments the persona. */
  skills: string[]
  /** MCP connector keys assigned to this expert. */
  connectors: string[]
}
/** A coordinator's ordered expert roster. */
export type ExpertTeam = {
  /** User-editable key used by references and imports. */
  slug: string
  /** Display name shown in the workbench. */
  name: string
  /** Short description shown on the card. */
  description: string
  /** Role instructions included in the preset persona. */
  instructions: string
  /** Ordered expert keys coordinated by the team. */
  members: string[]
}
/** A user-owned, invocable Markdown skill. */
export type WorkbenchSkill = {
  /** User-editable key used by references and imports. */
  slug: string
  /** Display name shown in the workbench. */
  name: string
  /** Short description shown on the card. */
  description: string
  /** Markdown instructions returned when the skill is invoked. */
  content: string
}
/** Connector configuration; credentials remain in the MCP server's own environment. */
export type Connector = {
  /** User-editable key used by references and imports. */
  slug: string
  /** Display name shown in the workbench. */
  name: string
  /** MCP server transport. */
  transport: 'streamable-http' | 'stdio'
  /** HTTP endpoint; unused for a local process. */
  url: string
  /** Executable name or path for the local server. */
  command: string
  /** Arguments passed individually to the server executable. */
  args: string[]
  /** Whether assigned presets connect to this server. */
  enabled: boolean
}
/** Profile-scoped configuration persisted by Settings. */
export type WorkbenchData = {
  /** Editable individual expert definitions. */
  experts: Expert[]
  /** Editable coordinator definitions referencing experts. */
  teams: ExpertTeam[]
  /** Custom Markdown skills registered with the Host. */
  skills: WorkbenchSkill[]
  /** MCP server definitions available for assignment. */
  connectors: Connector[]
}

/** Read-only skill metadata embedded from the repository's skill directory at build time. */
export interface BuiltinSkill {
  /** Stable skill identifier from YAML frontmatter. */
  readonly name: string
  /** Routing description from the skill's YAML frontmatter. */
  readonly description: string
  /** Repository-relative instruction-file path, independent of the build machine. */
  readonly path: string
  /** Whether the source skill permits explicit human invocation. */
  readonly userInvocable: boolean
  /** Whether the source skill permits model-directed invocation. */
  readonly modelInvocable: boolean
}
