# 自动化后台工作区

状态：implemented
类型：bug-fix
Owner：backend/package/yuxi/services/project_service.py

## 问题

桌面端通过手动项目创建接口提交 managed 目录，后台要求手动项目选择 linked 目录，返回 422；桌面端将业务失败显示成通用内部错误。

## 决策

增加仅认证用户可调用的 POST /api/scheduled-tasks/projects。调用方仅提供名称和幂等键，后台为当前账号创建 selectable managed Project，沿用目录分配和 Project 持久化逻辑。同一账号创建通过事务锁串行化；重试返回同一项目，不匹配及已删除的请求标识返回 409。桌面端保留后台错误原因。

## 替代方案

不放宽手动创建项目的 linked 目录约束，不使用客户端本机路径作为后台工作目录。

## 后果

专用接口需要后台与桌面代理一起升级；目录仍由既有 Workdir 生命周期物化，不增加调度任务。

## 验证

桌面代理测试覆盖专用接口及业务错误原因。真实 HTTP integration 覆盖项目列表可见性、托管目录类型、重试一致性、账号隔离及非法字段。本地 Docker 服务不可用，完整数据库 integration 尚未执行。2026-10-10 部署至 jing-work-latest API 后，真实 HTTP 验证托管目录创建、并发幂等、项目列表持久化、非法字段拒绝、意图冲突及已删除幂等键拒绝；直接查询线上 PostgreSQL 核验 managed/selectable 及测试清理后的 deleted 状态。桌面代理到线上后台的端到端创建通过，验收工作区均已清理。
