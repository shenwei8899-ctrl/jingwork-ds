---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-04-super-agent-chat-task

[English](2026-11-04-super-agent-chat-task.md) | 中文

## 概述

通过 super-agent/start 记录 Super Agent 聊天任务的完成目标身份和任务目标。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-04-super-agent-chat-task
baseline: false
changes:
  - root: "event:super-agent/start"
    previous: null
    after: "97cbebea5290d1606c09a2c63368409e327b942bf8f34eb1cc2286d7e39ba4c9"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有会话没有任务标记，沿用原有目标行为。新事件具有独立判别字段，不改变已有载荷。新读取器根据新事件恢复任务身份。旧读取器拒绝无法识别的必需判别字段，避免在缺少编排策略时继续任务。保留当前写入格式版本。

<a id="verification"></a>
## 验证

Super Agent 单元测试覆盖命令创建、进度恢复、生命周期控制和命令卸载。使用脚本化模型响应的 Web 手工编写录制会话场景，通过随产品提供的 Web profile 覆盖启动、暂停、继续、停止、完成和刷新恢复。

<a id="dev-note"></a>
## 开发备注

无。
