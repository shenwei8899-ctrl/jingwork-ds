# 自动化默认本地执行

用户要求任务在桌面专家和本地工作区运行，后台只同步配置及记录。复用桌面 CronManager，不再因统一账号登录而切换到后台调度页。

用户明确选择本地专家迁移某个旧后台计划时，先停用该计划，禁止带着仍运行的后台任务创建重复本地计划。后台网络不可用时本地任务继续运行，同步状态保持待同步。后台镜像单独存储在 desktop_automation_snapshots，以账号、设备为键；镜像不会进入 ScheduledAgentJob，不能触发 worker。

采用独立快照表而非把 enabled=false 的后台计划当镜像，避免后台操作重新启用而造成重复执行。原始配置和执行记录留在本地数据库供断网重试，后台会话仍负责鉴权。结果进入本地对话，聊天素材沿用已有日志同步。

验证要求：本地执行不调用后台 run-now；后台不可用不阻塞本地；旧任务先停云端再创建；账号/设备快照隔离及 PostgreSQL 迁移幂等。真实后台发布和 PostgreSQL 验证在对应运行环境完成前不得声称已部署。

已执行验证：桌面自动化相关后端测试 220 项通过；迁移/本地入口前端测试 4 项通过；隔离 PostgreSQL schema 的真实 FastAPI 请求验证了 v12→v13 迁移幂等、镜像重放、账号/设备隔离和禁止服务器执行模式。桌面前端类型检查、构建通过。线上后台未部署；镜像同步保持待同步，本地执行独立可用。测试未替代真实模型/工具端到端执行。

2026-10-26 线上部署：47.111.188.85 的 Jing Work API/worker 已使用原 conversation-shares-20261022 镜像作基底增量发布 local-automation-20261026。storage-migrator 更新为同版 API 镜像，business schema 12→13 成功；API readiness 200，API/worker 均 healthy。备份与部署日志保存在服务器 /opt/jing-work-admin/backend/local-automation-20261026。当前账号真实 PUT 自动同步成功，GET 镜像可读取，本机 pending=false；此时尚无迁移完成的本地任务，tasks/records 均为 0。恶意 uid 字段与 execution_location=server 经真实认证 HTTP 返回 422。未触发任何测试执行任务，未修改旧计划的执行归属。
