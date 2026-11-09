# 统一账号的公开对话快照

状态：implemented
类型：bug-fix
Owner：backend/package/yuxi/services/conversation_share_service.py

## 问题

桌面端以统一账号登录，不能使用无设备连接的 enterprise-client 认证。分享创建、列表和撤销通过固定 Yuxi 来源验证当前会话，公开页面匿名读取随机凭据。

## 决策

快照仅包含明确选中的文本，身份由认证确定；数据库仅保存凭据摘要。有效期为 1/7/30 天，撤销清除正文，作者删除使链接失效。公开 Markdown 禁止原始 HTML、外部图片和脚本，并禁止索引、缓存和 referrer。

## 替代方案

本地 URL 无法让其他人直接访问；创建企业设备连接会引入额外身份流程。采用现有统一账号协议是当前登录模式的直接修复。

## 后果

业务 Schema 11 到 12 仅增加 conversation_shares 表，不修改已有用户与对话。迁移由独立迁移器持有，重复运行安全。

## 验证

验证覆盖匿名查看、跨账号撤销拒绝、过期、撤销清空、XSS 和输入限额。
