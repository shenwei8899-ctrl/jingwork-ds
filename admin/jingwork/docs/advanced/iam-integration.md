# 企业 IAM 接入

本参考面向部署和企业管理员。每个蓝鲸实例绑定一个 IAM 租户 UUID，用户、员工和组织由 IAM 维护。平台管理员和租户管理员分别使用蓝鲸 superadmin、admin 权限，普通员工使用 user 权限；受保护请求实时自省并检查子系统准入。

## 部署配置

在服务端环境文件启用 `IAM_ENABLED`，按仓库根 `.env.template` 填写全部 `IAM_*` 接入参数。OAuth 客户端密钥与目录服务密钥分别使用本子系统专用值。`IAM_BASE_URL` 使用平台网关的 `/iam/v1` API 根，`IAM_ISSUER_URL` 取发现端点返回的 issuer。应用和回调地址均使用 HTTPS；回调地址须由 IAM 预先登记。

平台网关使用仓库 `deploy/nginx/aim-work.locations.inc` 维护 JingWork 路由。API 和 Web 在平台 Docker 网络分别注册 `jingwork-api`、`jingwork-web` 别名。前端构建设置 `VITE_APP_BASE_PATH=/work/`，平台只在 `/work/` 下转发本应用。授权码回调关闭访问和错误日志，BFF 换码后跳转到不含授权码的会话完成页。

IAM 管理员先为目标租户开通子系统，再为参与使用的员工添加该子系统授权。管理员标记和子系统授权分别管理；缺少准入时返回权限不足。

## 登录与会话

设备授权页统一使用 JingWork 品牌，旧设备请求的 `DeepSeek Harness` 名称按 JingWork 展示。状态使用中文描述，有效期按浏览器本地时间显示。

Web、企业后台和桌面设备授权共用应用下 `/sso/callback` 这一已登记的 IAM 回调。登录后的应用内目标由服务端一次性 state 记录保存。登录入口自动跳转 IAM，state 同时保存在 Redis 和 HttpOnly Cookie，并双层传入 IAM 登录 URL。回调核对浏览器 state 后原子消费记录。IAM Access Token 和 Refresh Token 仅保存于实例 Redis；浏览器通过 Secure、HttpOnly、SameSite Cookie 使用本地会话，持久存储中的 `iam_cookie` 仅为界面登录标记。

Access Token 临近过期时，BFF 持 Redis 互斥锁续期并保存轮换凭据。明确的 IAM 503 或限流保留会话供重试；续期结果不确定时结束本地会话并要求重新登录。主动选择“退出全部平台会话”会按 IAM 规范全平台吊销该用户会话。Web 在页面恢复焦点、可见性变化及每 30 秒校验登录状态；身份服务故障显示可重试提示，权限不足显示 403。

IAM 用户以平台 UUID 派生独立蓝鲸 uid，与本地同名账号分别保存。人员和组织页面读取固定租户的分页目录。IAM 用户的本地部门为企业成员组；知识库等业务资源的授权配置继续由蓝鲸管理，组织目录展示不自动授予资源访问权限。

## 维护与失败处理

IAM 模式关闭本地密码登录、注册、初始化管理员、账号创建修改删除、模拟登录及旧 OIDC 换码入口。管理员使用 IAM 管理员身份进入后台；`local=1` 参数与旧 JWT 均无法恢复本地登录。历史本地业务用户及其资源归属保留，迁移须依据管理员确认的 IAM UUID 映射执行。

IAM Cookie 的写请求须携带与应用地址相同的 Origin。桌面与 CLI 设备授权由用户在浏览器中确认，设备凭据在服务端关联原始 IAM 会话。每次请求检查数据库凭据有效性，再对该会话执行 IAM 自省与子系统准入校验。旧独立 API Key 在 IAM 模式拒绝使用。设备授权响应在原有短期窗口内可重放，原 IAM 会话失效后无法重新建立有效设备授权。设备主动退出同时检查凭据有效性和账号归属。其它租户、账号停用、会话撤销和未开通子系统均拒绝执行；上游暂不可用返回可观察错误。

## 验证

协议与失败分支位于 `backend/test/unit/services/test_iam_service.py`。HTTP Cookie、权限变化、维护账号混合凭据和并发首次创建使用 `backend/test/integration/services/test_iam_http_identity.py`，需要显式提供独立的 `IAM_TEST_POSTGRES_URL` 和 `IAM_TEST_REDIS_URL`。真实验收依次检查换码、自省、续期、登出，以及平台管理员、租户管理员和普通员工的管理页面权限。
