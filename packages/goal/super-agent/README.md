---
description: "Start, supervise, pause, resume, and stop a persistent Super Agent task in the current chat."
kind: "package-reference"
---

# @deepseek-ai/dsh-super-agent

English | [中文](README.zh.md)

## Summary

Super Agent lets you give the current chat a completion objective, follow its task list, and keep work moving across turns. The agent can delegate independent work through the existing subagent tools. Each chat shares one completion goal with `/goal`, and workers retain the deployment's permissions. A restarted session requires explicit resume.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this plugin. Click **Super Agent** beside the chat input, enter an objective, and send it. The command chip applies to that submission. Later messages in the chat supply corrections and additional requirements for the current task.

The task card shows the objective, phase, and expandable task list. Pause interrupts the main agent and reachable workers. Resume continues the same objective. Stop cancels execution and clears the current goal while retaining the task card, logged history, and existing outputs. A failed worker interruption leaves the goal paused and reports the workers that require inspection.

The equivalent commands are `/super-agent <objective>`, `/super-agent-pause`, `/super-agent-resume`, and `/super-agent-stop`. Starting a task requires an idle session with `get_goal`, `update_goal`, and `todo_write` available. Another unfinished goal must be resolved first. Delegation depends on the current preset's subagent tools and permitted providers.

A custom composition mounts the plugin beside the goal service, goal-round driver, command registry, tool registry, system prompt service, subagent runtime, and session projection registry.

```yaml
- name: '@deepseek-ai/dsh-super-agent'
```

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The command starts a persisted goal and records its task identity. A private projection retains the latest task and folds its goal changes and whole-list todo updates. The existing goal driver owns automatic continuation. The system-prompt contribution supplies orchestration instructions only to the task's owning agent. Command controls compare the current goal reference before changing it and interrupt descendants deepest first. See [task types](src/types.ts), [projection](src/projection.ts), and [command implementation](src/index.ts).

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Goal service](../goal/README.md) — lifecycle, continuation activation, and restart behavior.
- [Goal continuation driver](../goal-round-driver/README.md) — round scheduling and failure containment.
- [Goal UI](../../client/ui-goal/README.md) — composer controls and progress presentation.

<a id="model-experience"></a>
## Model Experience

### Task orchestration policy

#### What the model sees

The task's system prompt contains the following section while its current goal remains unfinished. The goal driver supplies the objective through its logged continuation messages.

##### Task instructions

```markdown
You are coordinating the current Super Agent task in this chat.
Understand the requested outcome and inspect the current workspace before acting. For multi-step work, use todo_write to record concrete steps and update their status as work progresses. Delegate independent work with the available subagent tools when it helps, give each worker a bounded assignment, use only workers created for this task, and integrate and verify their results. Complete simple tasks directly.
Use the current session's configured tools, workspace, permissions, and approval policy. Choose tools appropriate to the task, including research, writing, files, and coding. Treat follow-up user messages as corrections or additional requirements for the current task. Use the available question tools to wait for required user decisions that inspection cannot resolve.
Keep the user informed of meaningful progress in this chat. Before marking the goal complete, settle delegated work, verify the entire requested outcome, update the task list, and provide the final result with usable deliverables and any remaining limitations. Read get_goal and use update_goal to record completion. After interruption or resume, inspect existing results and child agents before creating replacement work.
```

#### Token effect

The fixed section accompanies requests for an unfinished Super Agent task. Task-list and subagent tool results contribute their own context.

#### KV Cache effect

The section is stable during a task. Starting or completing a task changes the assembled system prompt and can invalidate its previously reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the latest task has a progress card. Earlier task commands, goals, and results remain in session history.
- Pause and stop interrupt execution. External operations already accepted by another system can require manual outcome verification.
- Worker interruption uses the configured subagent providers. A provider failure leaves the task paused with a visible error.
- Tasks share the session's existing workspace and tools. Task directories, GitHub intake, and Feishu intake require separate deployment features.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
