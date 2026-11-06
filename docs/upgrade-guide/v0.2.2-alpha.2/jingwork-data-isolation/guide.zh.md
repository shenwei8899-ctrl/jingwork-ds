---
kind: upgrade-guide
description: "JingWork macOS 安装包使用全新的产品专属数据目录和 jingwork 终端命令。"
---
# JingWork macOS 数据与命令隔离

[English](guide.md) | 中文

## 变更

JingWork macOS 安装包此前与 Harness 共用 Electron 浏览器数据和 `~/.dsh` profile。共用的实例锁与 profile 锁阻止了两个应用同时运行。

JingWork 使用应用 ID `com.jingwork.desktop`，将 Electron 数据存储在 `~/Library/Application Support/JingWork` 下，将应用数据存储在 `~/.jingwork` 下，将全局技能与指令存储在 `~/.jingwork/agents` 下。启动流程在获取实例锁前选择这些目录，并覆盖继承的 `DSH_HOME` 与 `DSH_AGENTS_HOME`。首次启动会打开全新的本地数据，需要重新设置账号与提供方。

macOS 终端命令为 `jingwork`，应用打开链接为 `jingwork://open`。

## 迁移

1. 如果旧版 JingWork 安装了 `/usr/local/bin/dsh`，请在替换应用前，通过旧版应用的命令管理对话框移除其 `dsh` 注册。
2. 完全退出 JingWork，使用重新构建且适配这台 Mac 芯片的应用替换 `/Applications/JingWork.app`。
3. 启动 JingWork，登录账号、配置所需提供方凭据，并安装所需插件与技能。新的工作区从空白本地历史开始。
4. 如果使用 Desktop 终端命令，请打开重建后的 JingWork 命令管理对话框注册 `jingwork`。打开新终端并运行 `jingwork --version`。Harness 的 `dsh` 注册通过 Harness 单独管理。
5. 同时打开 DeepSeek Harness 和 JingWork。确认两个窗口都保持可用，且新建的 JingWork 会话仅出现在 JingWork 中。目录位置与项目文件共享范围见[安装归属参考](../../../../apps/desktop/README.zh.md#installation-ownership)。
