/** Assistant ownership category within the profile. */
export type ExpertCategory = 'personal' | 'enterprise' | 'builtin'

/** Runtime capability groups supported by the assistant preset. */
export type AgentToolGroup = 'files' | 'web' | 'shell' | 'tasks' | 'interaction'

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
  /** Literal Markdown reference material; missing legacy values resolve to empty text. */
  knowledge?: string
  /** Backend knowledge base identifiers selected for retrieval. */
  knowledgeBases?: string[]
  /** Custom MCP knowledge bases selected for read-only retrieval. */
  customKnowledgeBases?: {
    /** Assigned custom MCP connector key. */
    connector: string
    /** Knowledge base key returned by its connector. */
    id: string
    /** Name shown in the expert's knowledge selection. */
    name: string
  }[]
  /** Optional uploaded raster avatar, stored as a validated data URL. */
  avatar?: string
  /** Optional card accent in hexadecimal RGB notation. */
  color?: string
  /** Welcome heading displayed before the first message. */
  welcomeMessage?: string
  /** Chat-home shortcuts; omission displays no cards. */
  quickPrompts?: AgentQuickPrompt[]
  /** Default provider and model for a Session with no recorded model choice. */
  model?: {
    /** Registered provider route. */
    provider: string
    /** Model identifier owned by the provider. */
    model: string
  }
  /** Enabled runtime tool groups; omission retains the standard tool set. */
  tools?: AgentToolGroup[]
  /** Allowed child expert keys; omission retains inherited delegation. */
  subagents?: string[]
  /** Custom skill keys whose content augments the persona. */
  skills: string[]
  /** MCP connector keys assigned to this expert. */
  connectors: string[]
}
/** A chat-home shortcut with editable display text and submitted prompt. */
export type AgentQuickPrompt = {
  /** Stable key retained while editing and reordering cards. */
  id: string
  /** Card heading. */
  title: string
  /** Supporting card text. */
  description: string
  /** User message inserted into the composer. */
  prompt: string
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
/** Connector settings; HTTP bearer keys stay in the Host credential store. */
export type Connector = {
  /** User-editable key used by references and imports. */
  slug: string
  /** Display name shown in the workbench. */
  name: string
  /** Bundled adapter identity, absent for a custom MCP server. */
  builtin?: string
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

/** Skill metadata and instructions embedded from the repository's skill directory at build time. */
export interface BuiltinSkill {
  /** Markdown instructions copied into an assistant when selected. */
  readonly content: string
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
