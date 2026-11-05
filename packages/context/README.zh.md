---
description: "context 组概览：不定义工具、为每次请求添加持久且模型可见上下文的插件，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# context/ — 请求上下文插件

[English](README.md) | 中文

## 概述

context 组通过工作区指令、原样保留的参考资料、文件提及、有界会话引用、时间和 tmux 位置提供模型可见上下文，不定义工具。`agent-instructions` 随 `dsh-base` 挂载；其他贡献方由所选组合挂载。指令和引用消息进入持久的 user 角色历史；配置的知识资料进入已记录的系统提示。各包 README 负责其配置和行为说明。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`agent-instructions/`](agent-instructions/README.zh.md) | 将 `AGENTS.md`、`CLAUDE.md` 工作区指令加载到上下文，并在文件编辑后刷新 | — |
| [`knowledge/`](knowledge/README.zh.md) | 将配置的参考资料作为原样保留的系统提示区段提供给模型 | — |
| [`session-reference/`](session-reference/README.zh.md) | 引用其他会话：提及一个会话，其有界只读快照即成为上下文 | `ctx.sessionReferenceResolver` |
| [`file-reference/`](file-reference/README.zh.md) | 发现 `@file` 提及，并提供由宿主支持的 UI 共用的提及语法 | `ctx.fileReferences` |
| [`file-reference-local/`](file-reference-local/README.zh.md) | `@file` 提及的本地工作区补全提供方 | — |
| [`time-context/`](time-context/README.zh.md) | 每个步骤的当前时间、浏览器时区与经过时长 | — |
| [`tmux-context/`](tmux-context/README.zh.md) | agent 所在的 tmux 会话、窗口与窗格位置 | — |
| [`harness-dev-context/`](harness-dev-context/README.zh.md) | 以运行时上下文给出 harness checkout 与 Web GUI URL，使系统提示词跨进程保持稳定 | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [会话引用子系统](../../docs/subsystems/session-reference.zh.md)——规范的提及 URI、快照语义与稳定的错误分类体系。
- [工作区上下文决策记录](../../.agents/notes/archived/feature/2026-06-24-workspace-context.md)——指令上下文为何按 agent 和会话两个维度隔离并持久记录。
- [生成的配置目录](../../docs/config-catalog.zh.md)——本组各包接受的全部配置字段。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
