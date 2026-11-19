# 桌面 Skill 审核与分发

Status: implemented
Type: feature
Owner: backend/package/yuxi/services/skills/submissions.py

## Problem

桌面助理上传的 Markdown Skill 保存在本机配置，企业管理员无法查看内容、审核或停止服务器分发。客户端需要分别展示本地技能和企业审核通过的技能。

## Decision

桌面助理保存成功后，将选中的上传 Skill 保存在本地并提交审核。提交内容作为不可变版本保存在 PostgreSQL，以提交者和内容哈希去重。管理员读取内容及 Cisco Skill Scanner 静态扫描报告，再批准、拒绝或下架。只有批准版本可以通过分发接口读取，客户端安装时重新检查服务器状态。已安装的本地副本由用户管理。

### Implementation

SkillSubmission 表保存 Markdown、内容哈希、扫描报告、审核状态、审核者与意见。repository 拥有去重与行锁，service 拥有扫描和审核用例，HTTP 层执行登录及管理员鉴权。扫描器安装在独立环境，通过无 shell 的有界子进程执行。扫描失败可重试，完成扫描后才能批准。

Electron 原生凭据 Owner 提供提交、目录及下载 IPC，渲染进程复用工作台配置接口安装本地副本。后台 Skill 管理页展示审核队列与内容预览。

## Alternatives

将每次桌面上传立即写成启用共享 Skill 会在审核前发布。仅增加后台列表无法建立桌面上传与服务器之间的提交链路。

## Verification

| Acceptance claim | Failure mode | Semantic owner | Direct evidence / command | Negative case | Current result |
|---|---|---|---|---|---|
| 提交可重试且内容不可变 | 重复提交产生多个版本 | repository | PostgreSQL HTTP integration | 同内容并发提交 | Passed |
| 审核前及下架后无法下载 | 绕过列表直接下载 | service | HTTP integration | 非批准 ID 下载 | Passed |
| 审核权限由服务端执行 | 普通用户调用审核 API | router | HTTP integration | 普通账号批准 | Passed |
| 扫描失败可见且可重试 | 错误被视为通过 | scanner | scanner unit 与测试机 CLI | 缺失扫描器、超时 | Passed |
| 客户端本地与服务器列表可操作 | 安装覆盖本地同名内容 | workbench | 原生认证 unit、Loader Web E2E 与页面截图 | 重名安装 | Passed |

## Consequences

静态扫描对语义攻击存在漏报与误报，审核者需要阅读内容。服务器下架停止后续下载，已经安装的本地副本继续由用户管理。桌面客户端需要重新构建安装才能使用新增 IPC。

验证包含 38 项 Python unit、1 项真实 PostgreSQL/HTTP integration、183 项客户端与原生测试，以及 2 项 keyless Web E2E。`pnpm run build:artifacts` 与随后运行的 `pnpm run build:check` 通过。测试环境通过正常 IAM 设备授权验证提交、去重、扫描、批准、下载和下架；合成恶意指令被报告为 CRITICAL。后台真实页面验证扫描失败恢复、审核和下架。临时提交、临时账号及设备凭据已清理或撤销。客户端页面验证使用测试原生端口，安装包仍需单独构建发布。

全仓文档 quick gate 的 20 项通过，配对检查受已有管理端 README 改动影响失败；本次两份双语 README 的定向配对通过。管理端工程信任检查受嵌入仓库缺失 workflow 等既有配置问题影响失败，其检查器的 63 项单测通过。
