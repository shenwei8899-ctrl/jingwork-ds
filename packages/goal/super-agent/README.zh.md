---
description: "在当前聊天中启动、监督、暂停、继续和停止持久化的 Super Agent 任务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-super-agent

[English](README.md) | 中文

## 概述

Super Agent 允许你为当前聊天指定完成目标、查看任务清单，并跨轮次持续推进工作。智能体可以通过现有子智能体工具委派独立工作。每个聊天与 `/goal` 共用一个完成目标，执行器沿用部署的权限设置。会话重启后需要明确继续。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

Web bundle 挂载此插件。点击聊天输入框旁的 **Super Agent**，输入目标并发送。命令标签对本次提交生效。聊天中的后续消息用于更正和补充当前任务的要求。

任务卡片展示目标、阶段和可展开的任务清单。暂停会中断主智能体和可达的执行器。继续会沿用同一个目标。停止会取消执行并清除当前目标，同时保留任务卡片、日志历史和已有产物。执行器中断失败时，目标保持暂停，并报告需要检查的执行器。

对应命令为 `/super-agent <objective>`、`/super-agent-pause`、`/super-agent-resume` 和 `/super-agent-stop`。启动任务要求会话空闲且提供 `get_goal`、`update_goal` 和 `todo_write`。已有未完成目标需要先处理。委派能力取决于当前预设的子智能体工具及允许使用的提供方。

自定义组合需要将此插件与目标服务、目标轮次驱动器、命令注册表、工具注册表、系统提示服务、子智能体运行时及会话投影注册表一起挂载。

```yaml
- name: '@deepseek-ai/dsh-super-agent'
```

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

命令创建持久化目标并记录任务身份。私有投影保留最新任务，并折叠其目标变更和完整待办清单更新。现有目标驱动器负责自动续跑。系统提示贡献仅为任务所属智能体提供编排指令。命令控制在变更前比较当前目标引用，并优先中断最深层后代。参见[任务类型](src/types.ts)、[投影](src/projection.ts)和[命令实现](src/index.ts)。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [目标服务](../goal/README.zh.md) — 生命周期、续跑激活和重启行为。
- [目标续跑驱动器](../goal-round-driver/README.zh.md) — 轮次调度和故障限制。
- [目标界面](../../client/ui-goal/README.zh.md) — 输入框控制和进度展示。

<a id="model-experience"></a>
## 模型体验

### 任务编排策略

#### 模型看到的内容

当前目标尚未完成时，任务的系统提示包含以下段落。目标驱动器通过记录到日志的续跑消息提供任务目标。

##### 任务指令

```markdown
You are coordinating the current Super Agent task in this chat.
Understand the requested outcome and inspect the current workspace before acting. For multi-step work, use todo_write to record concrete steps and update their status as work progresses. Delegate independent work with the available subagent tools when it helps, give each worker a bounded assignment, use only workers created for this task, and integrate and verify their results. Complete simple tasks directly.
Use the current session's configured tools, workspace, permissions, and approval policy. Choose tools appropriate to the task, including research, writing, files, and coding. Treat follow-up user messages as corrections or additional requirements for the current task. Use the available question tools to wait for required user decisions that inspection cannot resolve.
Keep the user informed of meaningful progress in this chat. Before marking the goal complete, settle delegated work, verify the entire requested outcome, update the task list, and provide the final result with usable deliverables and any remaining limitations. Read get_goal and use update_goal to record completion. After interruption or resume, inspect existing results and child agents before creating replacement work.
```

#### Token 影响

固定段落随未完成 Super Agent 任务的请求发送。任务清单和子智能体工具结果提供各自的上下文。

#### KV Cache 影响

任务执行期间，该段落保持稳定。启动或完成任务会改变组装后的系统提示，可能使此前可复用的前缀失效。

## 已知限制与延后事项

<a id="known-limitations-and-deferred-work"></a>

- 仅最新任务提供进度卡片。此前任务的命令、目标和结果仍保留在会话历史中。
- 暂停和停止会中断执行。其他系统已经接受的外部操作可能需要人工核实结果。
- 执行器中断使用已配置的子智能体提供方。提供方失败时，任务保持暂停并显示错误。
- 任务共用会话现有的工作区和工具。任务目录、GitHub 接单和飞书接单需要独立的部署功能。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景</summary>

无。

</details>
