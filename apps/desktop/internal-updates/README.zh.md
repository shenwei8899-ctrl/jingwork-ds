---
description: "构建和发布未签名的 JingWork Windows x64 安装包，支持后台下载和用户确认后重启安装。"
---

# Windows 内部更新

[English](README.md) | 中文

## 概述

内部发布使用未签名的 Windows x64 安装包，无需购买或下发代码签名证书。已安装应用在后台下载可用更新，并保留重启操作入口。安装需要用户确认，并正常收尾运行中的任务。此显式 JingWork 模式与签名发布和离线开发构建分开。

## 目录

- [构建与发布](#build-and-publish)
- [安装与信任](#installation-and-trust)
- [验证](#verification)

## 构建与发布 {#build-and-publish}

使用具备[打包工具链](../packaging/README.zh.md)的 Windows x64 机器。在 `apps/desktop/.env.windows` 中填写以下公开配置，将示例源站替换为企业下载服务：

```dotenv
DSH_DESKTOP_APP_ID=com.jingwork.desktop
DSH_DESKTOP_PRODUCT=jingwork
DSH_DESKTOP_AUTO_UPDATE_ENV=production
DOWNLOAD_PROD_ORIGIN=https://updates.example.com
```

也可使用现有 `test` 部署和机器预设；测试环境需要 `DOWNLOAD_TEST_ORIGIN` 和 `DOWNLOAD_TEST_RELEASE_ID`。内部打包不读取预设中的签名凭据。通过命令选择此模式，不从继承的环境变量开启：

```sh
pnpm --dir apps/desktop run package:win:x64:internal --build-version auto
```

目标在 `.desktop-build/targets/win-x64/internal-artifacts/` 下写入 `*-internal.exe`、对应 blockmap、渠道 YAML 和完成记录。打包或组装运行时失败会阻止完成记录生成。`--unsigned` 仍为离线开发模式，不能与 `--internal-update` 同时使用。

配置现有[发布凭据](../publishing/README.zh.md)，然后发布更新源和过渡安装包：

```sh
pnpm --dir apps/desktop run upload:win:x64:internal
pnpm --dir apps/desktop run upload:latest:win:x64:internal
```

生产环境使用 `jingwork/internal/feeds/win-x64/` 和 `jingwork/internal/bin/win-x64/`；stable 二进制增加 `/stable`。测试对象在 `jingwork/` 下增加发布 ID。过渡安装包 URL 为 `/desktop/jingwork-internal-latest-windows-x64.exe`。HTTPS 服务必须提供这些路径。上传校验完成记录、模式、版本、目标、大小和 SHA-512，先发送二进制和 blockmap，再发送 YAML。内部上传不创建签名发布标签。

## 安装与信任 {#installation-and-trust}

每台员工电脑先安装一次内部过渡版。旧离线安装包以及要求发布者证书的签名安装包均需手动完成此次过渡。后续构建需要递增的语义化版本，并保持相同部署和渠道。

已安装清单授权后台下载；下载的元数据和进程环境无法为已有签名包开启此行为。更新入口显示进度，完成后显示**安装并重启**。关闭应用从不安装更新。下载失败需要显式重试。切换渠道先撤销旧目标，再准备另一个目标。

HTTPS 保护传输；SHA-512 将下载字节与更新清单进行比对。两者均不认证 Windows 发布者，也不能独立防范更新服务器被入侵。应限制发布凭据和服务器写入权限。Windows 提示和企业应用控制规则仍然适用。macOS 签名与公证保持独立。

## 验证 {#verification}

针对性测试覆盖模式隔离、HTTPS 要求、构建元数据、打包失败、上传校验、后台下载和显式安装。Windows 发布操作员须依次安装两个内部构建，确认后台下载与重启，再验证实际版本及用户数据保留情况。macOS 构建或拦截安装器交接不能证明此 Windows 安装结果。

## 开发备注

无。
