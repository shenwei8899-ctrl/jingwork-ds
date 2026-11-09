# 中文用户 UID 的模型请求头编码

状态：implemented
类型：bug-fix
Owner：backend/package/yuxi/models/chat.py

## 问题

开启“请求携带用户 ID”的供应商收到中文 UID 用户的聊天模型调用时，出站 HTTP 客户端无法将原始 UID 编入请求头，调用在到达供应商前失败。英文 UID 的现有签名协议和网关计量归属必须保持可用。

## 决策

### 实现方案

模型请求边界继续对纯 ASCII UID 使用现有三个请求头与签名规范。非 ASCII UID 先按 UTF-8 编成无填充 base64url，在 `x-yuxi-uid` 传送，并附加 `x-yuxi-uid-encoding: b64url-utf8-v2`。v2 签名覆盖版本、编码后的头值与时间戳；网关须先验签，再严格解码并用原始 UID 归属用量。密钥与供应商开关不变。

## 替代方案

- 只拒绝中文 UID：错误会更清楚，但用户仍无法调用。
- 直接发送编码后的 UID 并沿用 v1 签名：旧网关可验签，却可能将编码值当成另一个账号，不能保证计量归属。
- 改用数据库数字 ID：改变既有 UID 语义及外部网关的用户映射。

## 后果

英文 UID 的出站格式与签名保持不变。中文 UID 的请求头可由 HTTP 客户端发送，但现有外部网关不在本仓库；部署时必须先让网关接受 v1/v2，后发布 Yuxi，否则网关可能拒绝中文 UID 或错误归属。当前仅完成本地出站协议验证，未验证线上网关。

## 验证

| 验收主张 | 失败面 | 语义 Owner | 直接证据 / 命令 | 负向案例 | 当前结果 |
| --- | --- | --- | --- | --- | --- |
| 中文 UID 的流式与非流式请求能发送 ASCII 请求头 | 仅 helper 可编码，真实请求仍抛 `UnicodeEncodeError` | `models/chat.py` | `uv run --group test pytest test/unit/services/test_model_selectors.py -k uid -q` | 恢复原始中文头值时真实 MockTransport 调用失败 | Passed |
| 英文 UID 继续使用 v1 头与签名，非法控制字符继续拒绝 | 改写现有计量身份或允许头注入 | `models/chat.py` | 同上 | v1 签名或控制字符断言失配 | Passed |
| v2 版本与编码值受签名保护 | 版本降级或不同 UID 归属 | `models/chat.py`、网关接入契约 | 同上及协议文档检查 | 修改编码值或按 v1 重算后签名失配 | Passed |
| 网关把 v2 值还原为原始 UID 并正确计量 | 线上网关未升级 | 外部网关 | 需在网关环境验证 | 旧网关拒绝 v2 | Not run：网关实现不在仓库 |
