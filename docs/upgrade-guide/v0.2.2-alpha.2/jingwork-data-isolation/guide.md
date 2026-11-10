---
kind: upgrade-guide
description: "JingWork desktop packages use fresh product-owned data directories and product-specific launchers."
---
# JingWork desktop data and command isolation

English | [中文](guide.zh.md)

## Change

JingWork macOS packages previously shared Harness's Electron browser data and `~/.dsh` profile. The shared instance and profile locks prevented both applications from running together.

JingWork uses application ID `com.jingwork.desktop`, Electron data under `~/Library/Application Support/JingWork`, application data under `~/.jingwork`, and global skills and instructions under `~/.jingwork/agents`. Startup selects these directories before acquiring the instance lock and overrides inherited `DSH_HOME` and `DSH_AGENTS_HOME`. The first launch opens fresh local data and requires account and provider setup.

The macOS terminal command is `jingwork`, and the application open link is `jingwork://open`.

Unsigned Windows packages select JingWork with `com.jingwork.desktop`, Electron data under `%APPDATA%/JingWork`, and application data under `%USERPROFILE%/.jingwork`. Its `dsh.cmd` terminal command starts `JingWork.exe` with the private data directories. The first launch opens the JingWork sign-in and setup flow.

## Migration

1. If the older JingWork installed `/usr/local/bin/dsh`, use that application's command-management dialog to remove its `dsh` registration before replacing the application.
2. Fully quit the installed application. On macOS, replace `/Applications/JingWork.app` with the rebuilt application for the Mac's processor. On Windows, install the rebuilt JingWork EXE and launch its JingWork shortcut.
3. Start JingWork, sign in, configure the required provider credentials, and install the required plugins and skills. The new workspace starts with an empty local history.
4. If you use the Desktop terminal command, open the rebuilt JingWork's command-management dialog to register `jingwork`. Open a new terminal and run `jingwork --version`. Manage Harness's `dsh` registration separately from Harness.
5. Open DeepSeek Harness and JingWork together. Confirm that both windows remain available and that new JingWork conversations appear only in JingWork. See the [installation ownership reference](../../../../apps/desktop/README.md#installation-ownership) for the directory locations and project-file sharing scope.
