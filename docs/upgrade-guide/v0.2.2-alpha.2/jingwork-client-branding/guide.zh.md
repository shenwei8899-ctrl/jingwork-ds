---
kind: upgrade-guide
description: "JingWork 安装包包含登录部署配置，并通过原生产品标识选择欢迎页与引导品牌。"
---
# JingWork 安装包登录与产品品牌

[English](guide.md) | 中文

## 变更

JingWork 桌面登录此前需要 `userData/desktop/jingwork.json`。因此，使用独立数据的全新安装在此文件缺失时可能打开 Harness 账号流程。原生欢迎页和通用账号引导也使用 Harness 的展示内容。

JingWork 安装包包含面向 `https://jingwork.openswarm.run` 的 `resources/jingwork-login.json`。原生登录窗口打开该部署现有的登录与注册页面。安装专属的 `desktop/jingwork.json` 优先于安装包默认配置。所选安装包设置缺失或无效，以及覆盖配置无效时，都会拒绝启动。

已安装的产品标识为原生欢迎页和通用桌面引导选择 JingWork 名称、标志与插图。原生 JingWork 账号部署在授权后打开工作区，并跳过通用的 DeepSeek 额度、用途和过程引导流程。

## 迁移

1. 使用重新构建且适配这台 Mac 芯片的安装包替换已安装的 JingWork 应用。从共享 Harness 数据的构建升级时，请遵循[数据隔离指南](../jingwork-data-isolation/guide.zh.md)。
2. 启动 JingWork，使用现有 JingWork 账号或登录页面中的注册链接。确认授权后会打开工作区，且侧边栏显示 JingWork 账号。
3. 对于私有部署，创建或更新 `~/Library/Application Support/JingWork/desktop/jingwork.json`，填写部署的 HTTPS 源地址后重启 JingWork。[原生账号配置规则](../../../../apps/desktop/README.zh.md#local-desktop-settings)说明可用源地址、超时值和失败处理。
4. 如果启动时报认证配置失败，请修正所选覆盖配置，或重新安装包含默认配置的安装包，然后重启 JingWork。
