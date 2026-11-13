---
description: "Assistant creation and management, expert teams, custom skills, MCP connectors, and workspace files."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

With native Jingwork login, the enterprise catalog is read from `/api/agent` using the current account’s encrypted device credential. Refresh replaces the remote catalog without copying definitions into personal settings. Starting an enterprise agent reads its latest authorized name, description and role prompt, synchronizes an enterprise preset through revision-fenced Harness settings, and opens a native Harness conversation after activation. Execution uses Harness models and tools. Jingwork model, knowledge, skill, MCP and subagent bindings are owned by its backend and are excluded from this role synchronization.

The enterprise catalog uses responsive cards with an adaptive column count with authorized-state badges, role synchronization details and a native-chat action. Its Jingwork brand image is bundled through the package asset export.

The assistant catalog starts with its category tabs and a compact search/action row.

The sidebar uses the JingWork icon and displays 竞网蓝鲸 above JingWork. The collapsed rail keeps the same icon. Expanded branding is centered with a 40 px mark and a 12 px gap before the name.

## Summary

Create personal assistants, copy built-in templates, choose profile-provided enterprise assistants, and start chats from the Web or desktop workbench. Browse built-in repository skills and manage teams, custom skills, MCP connectors and workspace files alongside the assistants. Configuration is saved in the profile's `ui-workbench` Settings entry.

For Know-compatible connectors, Test connection also calls `know_list_kb` and validates the returned catalog before reporting success. An upstream authorization failure fails the test even when tool discovery succeeds.

Host connector entry points are bundled independently so their published files include every runtime import.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Assistants has three categories: Enterprise agents, My agents and Built-in agents. Enterprise definitions are supplied by the profile or its administrator and are read-only on this page. The Built-in agents tab supplies six templates; creating from a template makes a separate personal copy. The toolbar offers a New agent action. Search by name, description or ID, and switch between card and table views.

Expert templates use compact cards, with role-specific bundled portraits, name and identifier, a full description, a template badge and the add action. The grid fills the available width and adapts its column count with a 300px minimum card width, shrinking to fit narrower containers. Added templates keep their visible status. Narrow windows use one column. Skills and connectors use the same compact card dimensions and responsive grid as expert templates. Enterprise, personal and built-in agent cards use these dimensions and surfaces too, with wrapping action controls. Built-in skill details share the skill editor’s dialog width, scrollable content spacing and footer actions.

The assistant editor fills the main content area beside the application sidebar. Step navigation stays beside the scrollable form, and the action footer remains visible. Narrow windows place the steps above the form.

Create a personal assistant through seven steps covering basic information, model configuration, knowledge base, skills, runtime tools, subagents and review. Editing an existing assistant also includes connector selection. IDs are generated automatically, are unique across assistants and teams, and stay fixed when editing. Names and instructions are required. Select existing skills, review the configuration, and choose whether to enable the assistant after saving. A failed save keeps the draft open; a successful save returns to My agents and highlights the saved assistant.

New personal assistants start with an editable general-expert name and everyday-work description in the interface language. Copies and edits retain their existing values.

Upload a PNG, JPEG, WebP or GIF avatar up to 5 MB and configure chat-home prompt cards. Cards send their configured prompt as a user message. Select a catalog model or follow the Harness default. The selected default is recorded for a fresh Session and leaves existing Session model choices intact. Tool groups control the preset’s file, web, shell, planning and interaction tools under the deployment’s sandbox and approval policy. Selected subagents become the delegation tool’s preset allowlist. Remove references before disabling or deleting a selected child. JSON export includes referenced child definitions and their assigned skills and connectors.

In Knowledge base, select one or more knowledge bases configured in the management backend. A divider labeled Custom knowledge bases lists authorized bases from enabled custom HTTP MCP connectors exposing `know_list_kb` and `know_query_kb`. Each saved `customKnowledgeBases` assignment contains its connector namespace, base identifier and display name. New sessions register read-only search restricted to the selected bases, with the deployment knowledge timeout and response-size limits. MCP credentials stay in the Host store. Upstream catalog failures remain visible and preserve existing selections; remove assignments before disabling their connector. Deleting a connector removes its knowledge assignments. The catalog uses compact responsive cards with a highlighted selected state. Native Jingwork login supplies the current account’s authorized catalog; Refresh reloads it. Empty catalogs and unavailable login have visible guidance. Saved `knowledgeBases` identifiers survive editing, duplication and JSON import or export. New sessions mount `knowledge_search`, which accepts only assigned identifiers and checks backend access on every query. Existing literal `knowledge` text remains supported. Profiles without the native backend connection cannot retrieve managed knowledge.

`knowledgeRetrieval.timeoutMs` and `knowledgeRetrieval.maxBytes` configure query limits, defaulting to 15000 ms and 262144 bytes. The native credential owner supplies a private loopback relay to the Host through `DSH_KNOWLEDGE_URL` and `DSH_KNOWLEDGE_TOKEN`; backend credentials stay out of assistant settings.

Assistant, expert template, skill and connector cards share 18px corners, 16px padding and consistent borders and shadows. Agent cards use a pale blue-to-violet gradient, with a stronger tinted gradient on pointer hover or keyboard focus; avatar backgrounds remain transparent. The assistant list uses the expert catalog’s page spacing and an unframed content area. Assistant card grids fill the available width, using a 280px minimum column width to automatically add or remove columns, with wrapping actions in narrow windows. Personal assistant actions include edit, duplicate, export and delete. Export includes the assistant's assigned skills and connectors. Enabled assistants with a healthy preset can start chats or become the default. Disabling removes the assistant and teams containing it from the new-session roster without deleting their configuration or existing sessions. Deleting the selected default assistant or team first restores the system default. If deletion then fails, the assistant remains and a notice asks you to retry. Choose another default before disabling the default assistant or a member of the default team.

In Experts & teams, edit team instructions and select members. The capability catalog groups its title and description above a compact category and search toolbar. It supplies editable Markdown skills invoked with `/key`, and HTTP or local-process MCP connectors. Connectors start only when enabled and assigned to a mounted expert or team. Local commands use a separate JSON arguments array; server credentials use the Host environment.

The Skills tab separates Built-in skills and My skills. Cards adapt their column count to the available width, with an icon, title, metadata badge, two-line description and footer actions. Full descriptions are available in details or the custom skill editor. Built-in skills list the repository's `.agents/skills/*/SKILL.md` entries with Chinese names and descriptions in the Chinese locale; search also matches the original skill identifier. Open read-only details to inspect the source path and whether manual or model invocation is permitted by its metadata. Create, edit or delete custom skills under My skills. The agent editor displays all packaged built-in skills and saved skills as selectable cards. Upload a Markdown file with `name` and optional `description` YAML frontmatter, or use a plain Markdown filename as its identifier. Instruction bodies accept up to 65,536 characters. Selected built-in and uploaded definitions are copied into profile skills in the same revision-fenced save as the agent. Canceling the draft discards staged uploads.

The connector page groups enabled and built-in connectors. Enabled custom HTTP connector cards load the current MCP tool count; opening the list shows every tool name and full description. Failed catalog reads offer retry, and leaving the card cancels the read. Configure connector opens a custom Streamable HTTP MCP form with a name, service URL and required `Authorization` and optional `X-Linker-Api-Key` values. Test connection negotiates MCP and reads the tool catalog on the Host, reports success or failure, and leaves configuration unsaved. The deployment controls its timeout through `connectorTest.timeoutMs` (15000 ms by default). Saving enables the connector and stores its authentication headers separately from exported configuration. An empty authentication field retains its saved value during editing and testing; each header can be replaced independently. The custom form prefills `https://aim.hnjing.com/know/mcp`; users can edit the address. Authorization accepts a key and automatically adds `Bearer `, while complete Bearer values remain supported. Previously saved bearer keys remain supported. Its bundled catalog includes Tencent Docs, IMA, Meeting, News, Lexiang, Weiyun, WeRead, personal email and QQ Music. Vendor authorization pages supply tokens or API keys. Credentials are stored separately through the local DSH credential provider and are excluded from configuration exports. Select an enabled connector in an assistant before starting a new session. Official remote MCP servers load through `mcp-client`. IMA, News, WeRead, QQ Music and IMAP/SMTP use native adapters. Gateway calls resolve current credentials for each request. remote MCP credentials apply when a new session loads. HTTP and mailbox failures stop the operation without automatic retries. A failed mutation may have completed remotely. Removing a connector removes its assignments and retains its stored credential for later cleanup through credential settings.

Export configuration as JSON for backup. Import replaces the four collections atomically after validating keys, members, skill references, and connector settings. Concurrent edits are fenced by the Settings revision. Remove an expert from its teams before deleting it. Already running sessions retain their preset generation; restoring a session after restart uses the preset's current definition.

In Library, the complete authorized session catalog includes unopened history, and the most recent workspace opens automatically. Refresh reloads the session choices and selected directory. Files in the selected workspace are grouped by the Session whose durable log records a successful mutation or explicit delivery; files with no recorded owner appear under Unassigned files, while folders remain shared navigation. An older summary without ownership data is reconstructed from that Session's log without activating its Agent, and an incomplete read leaves the files visible with a notice. Use the creation panel, filename search and All, Images, Documents, Video, Audio and Other category buttons. Counts describe the selected workspace and current directory. The Images category shows contained thumbnails in a responsive grid, with filenames, file sizes, preview and download actions. Clicking a thumbnail opens the existing image viewer; failed thumbnails keep their file actions available. The panel expands with the file list, long filenames wrap, and narrow windows place file actions below the filename. Select a session workspace, browse directories, search names, filter file types, preview files with the existing document viewer, or download complete files within the Host read limit. Session access and filesystem policy still apply. Deleting workbench configuration does not delete sessions or files.

Other presentation hosts render the `workbench.assistants`, `workbench.library` and `workbench.knowledge` Component Factories with no input properties. The `workbench.resources` Factory accepts `kind` as `experts`, `skills` or `connectors`. These pages share the workbench controller and profile settings with the normal panels. The knowledge page edits each assistant's reference text with the captured Settings revision and retains its draft after a rejected save. A revision conflict disables saving and asks the user to copy the draft, cancel and reopen the editor.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host registers enabled presets with `agentPresets` and skills with `skills.registerProvider`. A team is registered only when all its members are enabled. The workbench supplies the Jingwork logo to the sidebar and new-session heading. The Client registers four keyed `main` panels and sidebar entries for assistants, capabilities and the library; its injected controller uses shared Settings forms and workspace-file remotes. Preset updates retire previous generations through the registry. Configuration lives in the profile rather than browser storage; definitions without ownership or activation metadata resolve to personal and enabled.

The Client build scans repository skill frontmatter into a metadata-only catalog; typed workbench dictionaries own localized display text. This catalog does not embed skill instruction bodies.

<a id="model-experience"></a>
## Model Experience

### Expert instructions, skills and knowledge

#### What the model sees

The selected expert's `instructions` and assigned skills' `content` enter the persona prefix. Knowledge text enters a separate reference section without prompt-variable interpolation. A team includes its instructions, each member's role and knowledge, and guidance to delegate through `subagent`; custom skill invocations return their Markdown body through the skill provider.

#### Token effect

Instruction tokens grow with the chosen role, team membership, selected skill contents and knowledge text. Invoked skill content adds tokens when requested. Configuration exports, built-in skill metadata and library listings add no model input.

#### KV Cache effect

A running session retains its composed preset generation. Editing an expert, team, assigned skill or knowledge text changes later sessions' system prompt and can invalidate prefix reuse there. Invoking a custom skill adds its current content through the skill system.

### Tool selection

#### What the model sees

Expert presets mount filesystem, shell, skill, web, todo, presentation and subagent tools. Enabled connectors assigned to the expert add the MCP server's discovered tools. Teams combine their members' connector assignments.

#### Token effect

Tool-schema tokens depend on the composed preset and the connected servers' advertised tools. Disabled or unassigned connectors contribute no tools.

#### KV Cache effect

Changing connector assignments or enabled state changes later preset generations' tool schemas. Already running sessions retain their composed generation; server-side tool-list changes follow the MCP client's refresh behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Enterprise categories describe profile-owned definitions; this package does not supply an enterprise identity or authorization service. Assistant activation controls preset availability for new sessions, rather than a persistent running process.
- Displaying a built-in skill does not install or register its instructions. Actual availability and invocation depend on skill discovery in each session workspace.
- Knowledge base accepts reference text; it does not upload files or build a retrieval index.
- The library lists one session workspace at a time. It does not index file contents. Custom HTTP connectors accept Authorization and X-Linker-Api-Key values stored in the local credential provider. Per-server environment overrides are configured outside this editor. Enabling an MCP connector does not guarantee its server is reachable; preset diagnostics report activation failures.

<a id="dev-note"></a>
### Dev Note

Configuration validation and composition tests live in `tests/presets.host.spec.ts`. The package uses separate Host and Client compiler programs and the shared client bundle preset.
