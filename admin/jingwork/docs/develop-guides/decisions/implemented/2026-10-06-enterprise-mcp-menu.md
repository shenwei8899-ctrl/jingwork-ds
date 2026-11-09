# 企业 MCP 管理复用现有资源与智能体选择

状态：implemented
类型：feature
Owner：web/src/views/EnterpriseMcpManageView.vue

## 问题
企业资源菜单缺少 MCP 入口，快速开始的 MCP 配置与管理入口不连贯。

## 决策
在 Skill 管理下添加 MCP 菜单，直接复用现有 McpCardList。快速开始继续使用后端配置 Schema 的已启用 MCP 选项与现有配置保存机制，进入 MCP 分组时刷新选项并保留草稿。管理链接在新标签页打开，避免丢失尚未保存的配置。

## 替代方案
复制 MCP CRUD 页面和资源数据会产生两个维护来源；展示未启用资源为可选项会与运行时可用范围不一致。

## 后果
管理功能保持原管理员限制；普通用户的 MCP 可见性和运行时授权仍由后端执行。未启用的 MCP 不出现在快速开始可选范围中。

## 验证
复用现有 agentEditorConfig unit；运行前端 lint、unit 与 build，并在实际企业菜单与快速开始验证。
