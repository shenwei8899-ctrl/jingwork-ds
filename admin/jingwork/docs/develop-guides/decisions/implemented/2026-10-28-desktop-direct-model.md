# 桌面直连公司自有模型

状态：implemented
类型：bug-fix
Owner：backend/package/yuxi/services/desktop_model_service.py

## 问题

桌面企业模型通过公网后台转发时，后台无法访问公司内网模型。普通桌面聊天需要在本地访问模型服务。

## 决策

### 实现方案

后台 `/api/system/model-providers/desktop-model` 按当前认证账号及模型分配校验所选模型，从数据库读取启用状态，仅下发该模型的连接配置，响应使用 `Cache-Control: no-store`。桌面 `PersonalModelResolver` 每次调用获取配置，在本地 Python runtime 创建供应商模型并直连，保留工具、流式调用、模型级地址覆盖、自定义请求头和 OpenAI 请求体覆盖。配置不写入本地供应商表，后台登录 Token 仅发往后台配置服务。空 Key 的内网服务使用 SDK 占位凭据。

KeenLight 中转和依赖服务端 UID 签名的模型继续走网关。未授权、停用、非聊天模型和不支持协议均显式失败，不静默更换模型或回退调用路径。直连支持 OpenAI 兼容协议、OpenRouter 和 Anthropic；Gemini 返回 422。

本决定部分取代[普通桌面助理选择企业模型](2026-10-15-desktop-enterprise-model-selection.md)中自有供应商必须经企业网关、后台不下发供应商凭据的约束。个人模型与远程企业 Agent Run 保持其执行路径。

## 替代方案

让公网服务连接公司 VPN 需要额外网络设施。浏览器直接 fetch 受跨域和混合内容约束。下发全部供应商配置扩大密钥暴露面。选用本地 runtime 按需获取单个模型配置。

## 后果

获得自有模型使用权限的成员可读取其供应商调用凭据。直连调用不经过后台额度账本，后台无法强制扣费或撤销已经下发的供应商 Key，撤销已下发凭据需要供应商侧撤销或轮换。配置服务仍需可达，模型地址必须能从桌面电脑访问。依赖 UID 签名的内网模型仍受网关网络可达性限制。

部署须同时更新后台 API 和桌面 Python runtime。旧客户端仍使用既有网关；新客户端访问未更新的后台将显式报错。远程企业 Agent Run 在服务器执行，不属于普通桌面模型直连范围。

## 验证

桌面定向测试 22 项通过：`uv run --no-sync pytest tests/unit/agents/test_enterprise_model_direct.py tests/unit/agents/test_enterprise_model_picker.py tests/unit/test_personal_models.py tests/unit/test_managed_chat_model.py -q`。真实回环 HTTP 模型服务验证流式内容、供应商 Key、模型 ID、工具、请求头、请求体覆盖和 Key 轮换；后台 Token 未发送给模型。OpenAI、OpenRouter、Anthropic 构造及工具绑定通过；未连接真实 Anthropic 服务。

后台定向测试 23 项通过，覆盖服务授权、停用、协议拒绝、匿名拒绝、no-store、中转及签名网关保留，并回归已有模型配置和流式网关测试。使用已有完整 Python 依赖环境，隔离 `server.routers` 包初始化后执行三个测试文件，避免无关 Agent 模块因既有 deepagents 版本不兼容而导入失败；HTTP 路由通过真实 FastAPI TestClient 执行，未验证完整应用启动或真实 PostgreSQL。原生后台虚拟环境缺少 pytest；Docker 未启动。

修改文件 Ruff 及桌面解析器 mypy 通过。工程规则检查器的 63 项自测通过。全仓工程规则检查受既有决策记录格式问题阻塞。`make all -o format-all` 跳过全仓格式化以保留既有改动，lint 通过，typecheck 在其他 6 个文件报告 23 个既有错误，未进入全仓测试。独立 Reviewer 未发现阻塞问题。文档构建 `pnpm run build` 因缺少 node_modules / vitepress 未完成；新增记录及交叉引用的相对链接目标均存在。未部署后台、打包桌面或连接公司真实内网模型。
