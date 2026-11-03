---
description: "Assistant creation and management, expert teams, custom skills, MCP connectors, and workspace files."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

Create personal assistants, copy built-in templates, choose profile-provided enterprise assistants, and start chats from the Web or desktop workbench. Browse built-in repository skills and manage teams, custom skills, MCP connectors and workspace files alongside the assistants. Configuration is saved in the profile's `ui-workbench` Settings entry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Assistants has three categories: Enterprise agents, My agents and Built-in agents. Enterprise definitions are supplied by the profile or its administrator and are read-only on this page. Built-in agents supply six templates; creating from a template makes a separate personal copy. Search by name, description or ID, and switch between card and table views.

The assistant editor fills the main content area beside the application sidebar. Step navigation stays beside the scrollable form, and the action footer remains visible. Narrow windows place the steps above the form.

Create or edit a personal assistant through five steps: basic information, instructions, skills, connectors and review. Leave the optional ID blank to use a generated ID, or enter an ID before creation; IDs must be unique across assistants and teams and stay fixed when editing. Names and instructions are required. Select existing skills and connectors, review the configuration, and choose whether to enable the assistant after saving. A failed save keeps the draft open; a successful save returns to My agents and highlights the saved assistant.

Personal assistant actions include edit, duplicate, export and delete. Export includes the assistant's assigned skills and connectors. Enabled assistants with a healthy preset can start chats or become the default. Disabling removes the assistant and teams containing it from the new-session roster without deleting their configuration or existing sessions. Choose another default before disabling or deleting the default assistant, a default team, or a member of that team.

In Experts & teams, edit team instructions and select members. The capability catalog supplies editable Markdown skills invoked with `/key`, and HTTP or local-process MCP connectors. Connectors start only when enabled and assigned to a mounted expert or team. Local commands use a separate JSON arguments array; server credentials use the Host environment.

The Skills tab separates Built-in skills and My skills. Built-in skills list the repository's `.agents/skills/*/SKILL.md` entries with Chinese names and descriptions in the Chinese locale; search also matches the original skill identifier. Open read-only details to inspect the source path and whether manual or model invocation is permitted by its metadata. Create, edit or delete custom skills under My skills.

Export configuration as JSON for backup. Import replaces the four collections atomically after validating keys, members, skill references, and connector settings. Concurrent edits are fenced by the Settings revision. Remove an expert from its teams before deleting it. Existing sessions retain their preset generation.

In Library, use the creation panel, filename search and All, Images, Documents, Video, Audio and Other category buttons. Counts describe the selected session and current directory. Select a session workspace, browse directories, search names, filter file types, preview files with the existing document viewer, or download complete files within the Host read limit. Session access and filesystem policy still apply. Deleting workbench configuration does not delete sessions or files.

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host registers enabled presets with `agentPresets` and skills with `skills.registerProvider`. A team is registered only when all its members are enabled. The Client registers four keyed `main` panels and sidebar entries; its injected controller uses shared Settings forms and workspace-file remotes. Preset updates retire previous generations through the registry. Configuration lives in the profile rather than browser storage; definitions without ownership or activation metadata resolve to personal and enabled.

The Client build scans repository skill frontmatter into a metadata-only catalog; typed workbench dictionaries own localized display text. This catalog does not embed skill instruction bodies.

<a id="model-experience"></a>
## Model Experience

### Expert instructions and skills

#### What the model sees

The selected expert's `instructions` and assigned skills' `content` enter the persona prefix. A team includes its instructions and each member's role, with guidance to delegate through `subagent`; custom skill invocations return their Markdown body through the skill provider.

#### Token effect

Instruction tokens grow with the chosen role, team membership and selected skill contents. Invoked skill content adds tokens when requested. Configuration exports, built-in skill metadata and library listings add no model input.

#### KV Cache effect

A session retains its composed preset generation. Editing an expert, team or assigned skill changes later sessions' persona prefix and can invalidate prefix reuse there. Invoking a custom skill adds its current content through the skill system.

### Tool selection

#### What the model sees

Expert presets mount filesystem, shell, skill, web, todo, presentation and subagent tools. Enabled connectors assigned to the expert add the MCP server's discovered tools. Teams combine their members' connector assignments.

#### Token effect

Tool-schema tokens depend on the composed preset and the connected servers' advertised tools. Disabled or unassigned connectors contribute no tools.

#### KV Cache effect

Changing connector assignments or enabled state changes later preset generations' tool schemas. Existing sessions retain their composed generation; server-side tool-list changes follow the MCP client's refresh behavior.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Enterprise categories describe profile-owned definitions; this package does not supply an enterprise identity or authorization service. Assistant activation controls preset availability for new sessions, rather than a persistent running process.
- Displaying a built-in skill does not install or register its instructions. Actual availability and invocation depend on skill discovery in each session workspace.
- The library lists one session workspace at a time. It does not index file contents. MCP authentication headers and per-server environment overrides are configured outside this editor. Enabling an MCP connector does not guarantee its server is reachable; preset diagnostics report activation failures.

<a id="dev-note"></a>
### Dev Note

Configuration validation and composition tests live in `tests/presets.host.spec.ts`. The package uses separate Host and Client compiler programs and the shared client bundle preset.
