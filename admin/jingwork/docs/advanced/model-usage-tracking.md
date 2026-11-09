# 按用户统计模型用量

面向需要在 Yuxi 之外按用户计量模型用量的网关开发者或平台管理员。开启后，智能体对话产生的聊天模型请求会携带带 HMAC 签名的用户标识请求头，外部网关或供应商网关验签后即可把用量归属到具体用户。开关位于供应商的编辑或新增表单，名称为「请求携带用户 ID」，默认关闭，只对开启它的供应商生效。

## 开启前提

在 API/worker 的环境变量中放置一把专用随机密钥，例如 `YUXI_UID_SIGNATURE_SECRET=$(openssl rand -hex 32)`。不要复用 `JWT_SECRET_KEY` 等认证密钥：签名密钥与认证密钥的暴露面不同，混用会让一处泄漏同时放大为两类风险。保存供应商配置时，Yuxi 会校验该变量是否已配置，未配置则拒绝保存并提示配置方法；密钥只从这同一个固定变量读取，不写入数据库。修改容器环境变量后需要重建 API 和 worker，操作见[生产部署](./deployment.md)。

开启开关即表示该供应商的请求会携带用户 UID，请确认供应商或中间网关接受这个额外请求头。该头只覆盖 OpenAI 兼容与 Anthropic 供应商；Gemini 不支持此请求头，Yuxi 会禁用该选项并拒绝通过管理 API 开启。知识库抽取、评测等后台系统任务不携带该头，这些用量按系统 API Key 计量。

## 请求头与签名

纯 ASCII UID 沿用 v1：对 `uid=<uid>\nts=<unix 时间戳>` 计算 HMAC-SHA256。非 ASCII UID 使用 v2：先将原 UID 的 UTF-8 字节编码为无填充 base64url，再对 `v=2\nuid=<编码值>\nts=<unix 时间戳>` 签名。v2 多一个编码头，两个版本都按请求重新计算时间戳与签名。

| 请求头 | 内容 |
| --- | --- |
| `x-yuxi-uid` | v1 为原始 ASCII UID；v2 为原 UID 的无填充 base64url UTF-8 编码 |
| `x-yuxi-uid-encoding` | 仅 v2 存在，固定为 `b64url-utf8-v2` |
| `x-yuxi-uid-ts` | 签名时的 Unix 时间戳（秒） |
| `x-yuxi-uid-sig` | `base64(HMAC-SHA256(密钥, 该版本的规范化消息))` |

时间戳与签名按请求现算，不在加载模型时固定。长对话中每轮模型请求（包括工具调用后的下一轮、稍后触发的上下文摘要、网络重试后的重发）都会重新生成时间戳并重新签名，因此不会因为一轮任务跨越时间窗口而被网关按重放拒绝。

## 网关侧验签

网关按请求使用的 API Key 查找对应密钥，校验时间戳窗口后重算比对。v2 必须先验签，再严格解码并用原始 UID 归属用量；未知版本和非规范编码直接拒绝：

```python
import base64, binascii, hashlib, hmac, re

def verified_uid(
    secret: str, uid: str, ts: str, sig: str, encoding: str | None = None,
    *, now: int, window: int = 300,
) -> str | None:
    try:
        issued_at = int(ts)
    except (TypeError, ValueError):
        return None
    if not uid or abs(now - issued_at) > window:
        return None
    if encoding not in (None, "b64url-utf8-v2"):
        return None
    message = f"uid={uid}\nts={ts}"
    if encoding == "b64url-utf8-v2":
        message = "v=2\n" + message
    expected = base64.b64encode(
        hmac.new(secret.encode(), message.encode(), hashlib.sha256).digest()
    ).decode()
    if not hmac.compare_digest(expected, sig):
        return None
    if encoding is None:
        return uid if uid.isascii() else None
    if not re.fullmatch(r"[A-Za-z0-9_-]+", uid):
        return None
    try:
        raw = base64.b64decode(uid + "=" * (-len(uid) % 4), altchars=b"-_", validate=True)
        original = raw.decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None
    if base64.urlsafe_b64encode(raw).decode().rstrip("=") != uid:
        return None
    if original.isascii() or any(ord(char) < 0x20 or ord(char) == 0x7F for char in original):
        return None
    return original
```

窗口（示例为 ±300 秒）之外的请求会被拒绝。理解这个签名能证明什么、不能证明什么，是正确接入的前提：签名证明「产出方持有共享密钥且 uid 未被篡改」，不能阻止本就持有密钥的 Yuxi 管理员伪造；v1 签名覆盖 UID 和时间戳，v2 还覆盖版本，两者都没有每请求唯一 nonce。捕获到的签名头仍可在有效窗口内重复使用，因此这不是严格的一次性防重放机制。若业务要求阻止窗口内重放，网关协议还需加入每请求唯一 nonce/请求标识并原子去重。

签名密钥只从固定的 `YUXI_UID_SIGNATURE_SECRET` 读取，provider 配置里没有任何环境变量名字段：签名无法被指向其他变量，也就不存在借签名头探测服务器有哪些环境变量、或对某个密钥做离线猜解的通道。同一 Yuxi 实例的所有已签名供应商共用这一把密钥；如果未来需要按网关各持各钥，应在服务端以白名单形式开放命名空间，而不是在 provider 配置里接受自由输入的变量名。若保存后环境变量又被移除（例如只重建了部分容器），Yuxi 在发请求时直接报错，不静默降级为未签名头。

## Provider / 网关侧接入

负责计量的 Provider 或网关需要在自有安全配置中保存与 Yuxi API、worker 相同的 `YUXI_UID_SIGNATURE_SECRET`，并在接收请求时读取 UID、时间戳、签名及可选的编码头。按接入该网关的 API Key 找到对应的 Yuxi 签名密钥，使用上面的 `verified_uid()` 校验并还原身份；只有验证成功后，才把原始 UID 作为已验证身份写入用量记录。

```python
import time
from fastapi import HTTPException, Request


def verified_yuxi_uid(request: Request) -> str:
    uid = request.headers.get("x-yuxi-uid", "")
    encoding = request.headers.get("x-yuxi-uid-encoding")
    ts = request.headers.get("x-yuxi-uid-ts", "")
    sig = request.headers.get("x-yuxi-uid-sig", "")
    secret = secret_for_api_key(request.headers.get("authorization", ""))
    original_uid = verified_uid(secret, uid, ts, sig, encoding, now=int(time.time()))
    if original_uid is None:
        raise HTTPException(status_code=401, detail="invalid Yuxi user signature")
    return original_uid


record_usage(verified_uid=verified_yuxi_uid(request))
```

示例中的 `secret_for_api_key()` 应由网关实现：先完成 API Key 认证，再把该 Key 映射到对应 Yuxi 实例的签名密钥；单实例部署可直接读取该实例的安全配置。Provider 前的反向代理必须在移除或重写自定义请求头前完成验签。若目标 Provider 不保留或不接受这些请求头，应在它前面部署能读取并验证请求头的网关，或关闭该 Provider 的「请求携带用户 ID」开关；不能把未验签的 `x-yuxi-uid` 用作配额或计费身份。

网关应先部署同时接受 v1 和 v2 的验签与解码逻辑，再发布会发送 v2 的 Yuxi。旧网关只认识 v1，收到中文 UID 的 v2 头后会拒绝或错误归属；本地请求成功不等于网关已升级。

供应商卡片会显示当前是否开启该开关，便于核对实例的计量范围。
