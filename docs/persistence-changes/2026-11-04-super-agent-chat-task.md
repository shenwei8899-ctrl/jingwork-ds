---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-04-super-agent-chat-task

English | [中文](2026-11-04-super-agent-chat-task.zh.md)

## Summary

Records a Super Agent chat task's completion-goal identity and objective in super-agent/start.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing sessions have no task marker and keep their existing goal behavior. The event has a distinct discriminator and does not alter existing payloads. New readers recover task identity from the new event. Older readers refuse the required unknown discriminator instead of resuming a task with missing orchestration policy. The current writer format is retained.

<a id="verification"></a>
## Verification

The Super Agent unit tests exercise command creation, progress recovery, lifecycle controls, and command disposal. The authored Web recorded-session scenario exercises start, pause, resume, stop, completion, and reload through the shipped Web profile with scripted model responses.

<a id="dev-note"></a>
## Dev Note

None.
