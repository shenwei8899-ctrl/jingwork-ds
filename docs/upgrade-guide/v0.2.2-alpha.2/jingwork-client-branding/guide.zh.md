---
kind: upgrade-guide
description: "JingWork 安装包包含登录部署配置，并通过原生产品标识选择欢迎页与引导品牌。"
---
# JingWork 安装包登录与产品品牌

[English](guide.md) | 中文

## 变更

JingWork 桌面登录此前需要 `userData/desktop/jingwork.json`。因此，使用独立数据的全新安装在此文件缺失时可能打开 Harness 账号流程。原生欢迎页和通用账号引导也使用 Harness 的展示内容。

JingWork 安装包包含面向 `https://jingwork.openswarm.run` 的 `resources/jingwork-login.json`。原生登录窗口打开该部署现有的登录与注册页面。安装专属的 `desktop/jingwork.json` 优先于安装包默认配置。所选安装包设置缺失或无效，以及覆盖配置无效时，都会拒绝启动。

已安装的产品标识为原生欢迎页和通用桌面引导选择 JingWork 名称、标志与插图。原生 JingWork 授权后，首次使用引导在空白对话中打开，并带用户进入模型设置。关闭设置后返回引导，完成或明确跳过后保存此安装的确认状态。JingWork 账号菜单可在已有对话中打开模型设置或重新查看使用指南。

## 迁移

1. 使用重新构建且适配这台 Mac 芯片的安装包替换已安装的 JingWork 应用。从共享 Harness 数据的构建升级时，请遵循[数据隔离指南](../jingwork-data-isolation/guide.zh.md)。
2. 启动 JingWork，使用现有 JingWork 账号或登录页面中的注册链接。从首次使用引导进入模型设置，选择供应商或自定义 API 并保存配置，关闭设置后完成引导。缺少引导确认标记的既有安装会在下次空白对话中显示引导。账号菜单可随时打开模型设置或使用指南。
3. 对于私有部署，创建或更新 `~/Library/Application Support/JingWork/desktop/jingwork.json`，填写部署的 HTTPS 源地址后重启 JingWork。[原生账号配置规则](../../../../apps/desktop/README.zh.md#local-desktop-settings)说明可用源地址、超时值和失败处理。
4. 如果启动时报认证配置失败，请修正所选覆盖配置，或重新安装包含默认配置的安装包，然后重启 JingWork。
