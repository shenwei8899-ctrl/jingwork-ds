---
kind: upgrade-guide
description: "JingWork macOS packages use fresh product-owned data directories and the jingwork terminal command."
---
# JingWork macOS data and command isolation

English | [中文](guide.zh.md)

## Change

JingWork macOS packages previously shared Harness's Electron browser data and `~/.dsh` profile. The shared instance and profile locks prevented both applications from running together.

JingWork uses application ID `com.jingwork.desktop`, Electron data under `~/Library/Application Support/JingWork`, application data under `~/.jingwork`, and global skills and instructions under `~/.jingwork/agents`. Startup selects these directories before acquiring the instance lock and overrides inherited `DSH_HOME` and `DSH_AGENTS_HOME`. The first launch opens fresh local data and requires account and provider setup.

The macOS terminal command is `jingwork`, and the application open link is `jingwork://open`.

## Migration

1. Fully quit JingWork and replace `/Applications/JingWork.app` with the rebuilt application for the Mac's processor.
2. Start JingWork, sign in, configure the required provider credentials, and install the required plugins and skills. The new workspace starts with an empty local history.
3. If you use the Desktop terminal command, open JingWork's command-management dialog to register `jingwork`. Open a new terminal and run `jingwork --version`.
4. Open DeepSeek Harness and JingWork together. Confirm that both windows remain available and that new JingWork conversations appear only in JingWork. See the [installation ownership reference](../../../../apps/desktop/README.md#installation-ownership) for the directory locations and project-file sharing scope.
