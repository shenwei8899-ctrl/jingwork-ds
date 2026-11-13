"""单企业 IAM 登录、服务端会话和目录访问。"""

import hashlib
import hmac
import json
import os
import secrets
import time
from functools import lru_cache
from urllib.parse import urlencode, urlsplit
from uuid import UUID

import httpx
from fastapi import HTTPException, Request
from pydantic import BaseModel, Field, SecretStr, ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from yuxi.storage.postgres.models_business import Department, User
from yuxi.storage.redis import get_async_redis_client
from yuxi.utils.auth_utils import AuthUtils
from yuxi.utils.datetime_utils import utc_now_naive


class IAMConfig(BaseModel):
    """由部署环境提供的单租户接入配置。"""

    enabled: bool = False
    base_url: str = ""
    public_web_url: str = ""
    app_url: str = ""
    callback_url: str = ""
    issuer_url: str = ""
    client_id: str = ""
    client_secret: SecretStr = SecretStr("")
    service_key: SecretStr = SecretStr("")
    tenant_id: str = ""
    tenant_code: str = ""
    subsystem_code: str = ""
    timeout_seconds: float = Field(default=5, gt=0)
    state_ttl_seconds: int = Field(default=300, gt=0)
    session_ttl_seconds: int = Field(default=86400, gt=0)

    @property
    def cookie_path(self) -> str:
        """返回与应用部署前缀一致的 Cookie 路径。"""
        return urlsplit(self.app_url).path.rstrip("/") + "/"


@lru_cache
def get_iam_config() -> IAMConfig:
    """读取并校验部署配置，启用时拒绝缺失或不安全的地址。"""
    values = {
        name: os.environ[f"IAM_{name.upper()}"]
        for name in IAMConfig.model_fields
        if f"IAM_{name.upper()}" in os.environ
    }
    config = IAMConfig.model_validate(values)
    if not config.enabled:
        return config
    required = (
        "base_url",
        "public_web_url",
        "app_url",
        "callback_url",
        "client_id",
        "client_secret",
        "service_key",
        "tenant_id",
        "tenant_code",
        "subsystem_code",
        "issuer_url",
    )
    for name in required:
        value = getattr(config, name)
        value = value.get_secret_value() if isinstance(value, SecretStr) else value
        if not value or value != value.strip() or value == "CHANGE_ME":
            raise ValueError(f"IAM_{name.upper()} 配置无效")
    UUID(config.tenant_id)
    for name in ("base_url", "public_web_url", "app_url", "callback_url", "issuer_url"):
        parsed = urlsplit(getattr(config, name))
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
            raise ValueError(f"IAM_{name.upper()} 必须为不含凭据或查询参数的 HTTPS 地址")
    if config.callback_url != config.app_url.rstrip("/") + "/sso/callback":
        raise ValueError("IAM_CALLBACK_URL 必须为 IAM_APP_URL 下的 /sso/callback")
    return config


class IAMIdentity(BaseModel):
    """IAM 自省或目录返回的已验证身份字段。"""

    user_id: UUID
    tenant_id: UUID
    emp_id: str = Field(min_length=1, max_length=50)
    emp_name: str | None
    user_status: int = Field(strict=True)
    plat_admin: int = Field(strict=True, ge=0, le=1)
    plat_tenant_admin: int = Field(strict=True, ge=0, le=1)

    @property
    def role(self) -> str:
        """返回单企业实例中的权限角色。"""
        if self.plat_admin == 1:
            return "superadmin"
        return "admin" if self.plat_tenant_admin == 1 else "user"


class IAMSession(BaseModel):
    """只保存在 Redis 中的 IAM 凭据与固定身份。"""

    access_token: SecretStr
    refresh_token: SecretStr
    expires_at: float
    identity: IAMIdentity

    def to_redis_json(self) -> str:
        """显式序列化服务端凭据，避免 SecretStr 的展示掩码写入存储。"""
        return json.dumps(
            {
                "access_token": self.access_token.get_secret_value(),
                "refresh_token": self.refresh_token.get_secret_value(),
                "expires_at": self.expires_at,
                "identity": self.identity.model_dump(mode="json"),
            }
        )


def iam_failure(status_code: int, code: str, message: str) -> HTTPException:
    """生成不含上游凭据和响应正文的业务错误。"""
    return HTTPException(status_code, detail={"code": code, "message": message})


def validate_identity(data: object, config: IAMConfig) -> IAMIdentity:
    """在 IAM 响应入口校验身份、租户与启用状态。"""
    try:
        identity = IAMIdentity.model_validate(data)
    except ValidationError:
        raise iam_failure(503, "iam_invalid_response", "企业身份服务返回了无效身份") from None
    if identity.tenant_id != UUID(config.tenant_id):
        raise iam_failure(403, "iam_tenant_denied", "当前企业未接入此蓝鲸实例")
    if identity.user_status != 1:
        raise iam_failure(401, "iam_session_inactive", "企业账号已停用，请重新登录")
    return identity


async def iam_request(
    config: IAMConfig,
    method: str,
    path: str,
    *,
    form: dict[str, str] | None = None,
    params: dict[str, str | int] | None = None,
) -> object:
    """调用固定 IAM 地址，按 OAuth 与目录接口区分凭据。"""
    oauth = path in ("/oauth2/token", "/oauth2/introspect", "/oauth2/revoke")
    auth = httpx.BasicAuth(config.client_id, config.client_secret.get_secret_value()) if oauth else None
    headers = (
        {}
        if oauth
        else {
            "X-Service-Key": config.service_key.get_secret_value(),
            "X-Tenant-Id": config.tenant_id,
        }
    )
    try:
        async with httpx.AsyncClient(timeout=config.timeout_seconds, trust_env=False) as client:
            response = await client.request(
                method,
                config.base_url.rstrip("/") + path,
                auth=auth,
                headers=headers,
                data=form,
                params=params,
            )
            if response.status_code in (429, 503):
                raise iam_failure(response.status_code, "iam_retryable", "企业身份服务繁忙，请稍后重试")
            response.raise_for_status()
            body = response.json()
    except (httpx.HTTPError, ValueError):
        raise iam_failure(503, "iam_unavailable", "企业身份服务暂不可用，请稍后重试") from None
    if not isinstance(body, dict) or body.get("code") != 0 or "data" not in body:
        raise iam_failure(503, "iam_invalid_response", "企业身份服务返回异常，请联系管理员")
    return body["data"]


async def require_iam_access(identity: IAMIdentity, config: IAMConfig) -> None:
    """逐请求检查当前用户对已登记子系统的准入。"""
    result = await iam_request(
        config,
        "GET",
        f"/access/subsystems/{config.subsystem_code}",
        params={"emp_id": identity.emp_id},
    )
    if not isinstance(result, dict) or result.get("allowed") is not True:
        raise iam_failure(403, "iam_access_denied", "当前账号尚未获准使用竞网蓝鲸")


async def create_login_state(config: IAMConfig, redirect: str) -> tuple[str, str]:
    """生成绑定浏览器的一次性 state 与 IAM 登录地址。"""
    if not redirect.startswith("/") or redirect.startswith("//") or "\\" in redirect:
        raise iam_failure(400, "iam_invalid_redirect", "登录返回地址无效")
    state = secrets.token_urlsafe(32)
    redis = await get_async_redis_client()
    await redis.set("iam:state:" + state, redirect, ex=config.state_ttl_seconds, nx=True)
    callback = config.callback_url + "?" + urlencode({"state": state})
    query = urlencode({"ReturnURL": callback, "state": state, "tenant": config.tenant_code})
    return state, config.public_web_url.rstrip("/") + "/iam/v1/oauth2/login?" + query


async def complete_login(config: IAMConfig, code: str, state: str, browser_state: str) -> tuple[str, str]:
    """一次性核对 state 后换码，凭据仅写入服务端会话。"""
    if not code or not state or not browser_state or not hmac.compare_digest(state, browser_state):
        raise iam_failure(400, "iam_invalid_state", "登录校验失败，请重新发起企业登录")
    redis = await get_async_redis_client()
    redirect = await redis.getdel("iam:state:" + state)
    if not redirect:
        raise iam_failure(400, "iam_expired_state", "登录请求已失效，请重新登录")
    result = await iam_request(
        config,
        "POST",
        "/oauth2/token",
        form={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": config.callback_url,
            "state": state,
        },
    )
    session = session_from_tokens(result, config)
    await require_iam_access(session.identity, config)
    session_id = secrets.token_urlsafe(32)
    await redis.set("iam:session:" + session_id, session.to_redis_json(), ex=config.session_ttl_seconds)
    return session_id, redirect


def session_from_tokens(data: object, config: IAMConfig) -> IAMSession:
    """验证换码与续期响应中的凭据字段。"""
    identity = validate_identity(data, config)
    if not isinstance(data, dict):
        raise iam_failure(503, "iam_invalid_response", "企业身份服务返回异常")
    access = data.get("access_token")
    refresh = data.get("refresh_token")
    expires = data.get("expires_in")
    if not isinstance(access, str) or not access or not isinstance(refresh, str) or not refresh:
        raise iam_failure(503, "iam_invalid_response", "企业身份服务未返回有效会话")
    if type(expires) is not int or expires <= 0:
        raise iam_failure(503, "iam_invalid_response", "企业身份服务返回了无效有效期")
    return IAMSession(
        access_token=SecretStr(access),
        refresh_token=SecretStr(refresh),
        expires_at=time.time() + expires,
        identity=identity,
    )


async def get_iam_identity(session_id: str, config: IAMConfig) -> IAMIdentity:
    """读取服务端会话，按需串行续期并逐请求自省。"""
    redis = await get_async_redis_client()
    key = "iam:session:" + session_id
    raw = await redis.get(key)
    if not raw:
        raise iam_failure(401, "iam_session_expired", "企业登录已过期，请重新登录")
    try:
        session = IAMSession.model_validate_json(raw)
    except ValidationError:
        raise iam_failure(401, "iam_session_invalid", "企业登录状态异常，请重新登录") from None
    if session.expires_at <= time.time() + 10:
        async with redis.lock("iam:refresh:" + session_id, timeout=30, blocking_timeout=10):
            raw = await redis.get(key)
            if not raw:
                raise iam_failure(401, "iam_session_expired", "企业登录已过期，请重新登录")
            try:
                session = IAMSession.model_validate_json(raw)
            except ValidationError:
                raise iam_failure(401, "iam_session_invalid", "企业登录状态异常，请重新登录") from None
            if session.expires_at <= time.time() + 10:
                try:
                    result = await iam_request(
                        config,
                        "POST",
                        "/oauth2/token",
                        form={
                            "grant_type": "refresh_token",
                            "refresh_token": session.refresh_token.get_secret_value(),
                        },
                    )
                except HTTPException as error:
                    if isinstance(error.detail, dict) and error.detail.get("code") == "iam_retryable":
                        raise
                    await redis.delete(key)
                    raise iam_failure(401, "iam_refresh_failed", "企业登录续期未完成，请重新登录") from None
                refreshed = session_from_tokens(result, config)
                if (refreshed.identity.user_id, refreshed.identity.tenant_id, refreshed.identity.emp_id) != (
                    session.identity.user_id,
                    session.identity.tenant_id,
                    session.identity.emp_id,
                ):
                    raise iam_failure(401, "iam_identity_changed", "企业登录身份发生变化，请重新登录")
                ttl = await redis.ttl(key)
                if ttl <= 0:
                    raise iam_failure(401, "iam_session_expired", "企业登录已过期，请重新登录")
                await redis.set(key, refreshed.to_redis_json(), ex=ttl, xx=True)
                session = refreshed
    data = await iam_request(
        config,
        "POST",
        "/oauth2/introspect",
        form={
            "token": session.access_token.get_secret_value(),
        },
    )
    if not isinstance(data, dict) or data.get("active") is not True:
        raise iam_failure(401, "iam_session_inactive", "企业登录已失效，请重新登录")
    identity = validate_identity(data, config)
    if (identity.user_id, identity.tenant_id, identity.emp_id) != (
        session.identity.user_id,
        session.identity.tenant_id,
        session.identity.emp_id,
    ):
        raise iam_failure(401, "iam_identity_changed", "企业登录身份发生变化，请重新登录")
    await require_iam_access(identity, config)
    return identity


async def synchronize_iam_user(identity: IAMIdentity, db: AsyncSession, config: IAMConfig) -> User:
    """使用稳定 IAM UUID 绑定本地业务用户，提交角色与部门投影。"""
    department_name = "IAM 企业成员"
    description = "IAM tenant=" + config.tenant_id
    department = (await db.execute(select(Department).where(Department.name == department_name))).scalar_one_or_none()
    if department is None:
        await db.execute(
            insert(Department)
            .values(name=department_name, description=description)
            .on_conflict_do_nothing(index_elements=[Department.name])
        )
        department = (await db.execute(select(Department).where(Department.name == department_name))).scalar_one()
    if department.description != description:
        raise iam_failure(409, "iam_department_conflict", "IAM 部门映射冲突，请联系管理员")
    uid = "iam_" + identity.user_id.hex
    username = f"{identity.emp_name or identity.emp_id} · {identity.user_id}"
    user = (await db.execute(select(User).where(User.uid == uid).with_for_update())).scalar_one_or_none()
    if user is None:
        await db.execute(
            insert(User)
            .values(
                uid=uid,
                username=username,
                password_hash=AuthUtils.hash_password(secrets.token_urlsafe(48)),
                role=identity.role,
                department_id=department.id,
                is_deleted=0,
            )
            .on_conflict_do_nothing(index_elements=[User.uid])
        )
        user = (await db.execute(select(User).where(User.uid == uid).with_for_update())).scalar_one()
    if user.is_deleted:
        raise iam_failure(403, "iam_local_account_disabled", "当前蓝鲸账号已停用，请联系管理员")
    user.role = identity.role
    user.username = username
    user.department_id = department.id
    user.last_login = utc_now_naive() if user.last_login is None else user.last_login
    await db.commit()
    return user


async def resolve_iam_user(request: Request, db: AsyncSession) -> User | None:
    """仅以 HttpOnly Cookie 解析 IAM 会话。"""
    config = get_iam_config()
    session_id = request.cookies.get("jingwork_iam_session")
    if not config.enabled or not session_id:
        return None
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        expected = urlsplit(config.app_url)
        if origin != f"{expected.scheme}://{expected.netloc}":
            raise iam_failure(403, "iam_origin_denied", "请求来源校验失败")
    identity = await get_iam_identity(session_id, config)
    user = await synchronize_iam_user(identity, db, config)
    request.state.iam_identity = identity
    request.state.runtime_user = {"id": user.id, "uid": user.uid, "username": user.username}
    return user


async def bind_iam_device_grant(device_hash: str, session_id: str) -> None:
    """把已确认的设备授权绑定到浏览器拥有的 IAM 会话。"""
    redis = await get_async_redis_client()
    ttl = await redis.ttl("iam:session:" + session_id)
    if ttl <= 0:
        raise iam_failure(401, "iam_session_expired", "企业登录已过期，请重新登录")
    created = await redis.set("iam:device-grant:" + device_hash, session_id, ex=ttl, nx=True)
    if not created and await redis.get("iam:device-grant:" + device_hash) != session_id:
        raise iam_failure(409, "iam_device_conflict", "设备授权身份已绑定，请重新发起登录")


async def bind_iam_device_key(device_hash: str, secret: str) -> None:
    """重放设备响应时仅关联仍存在的原始 IAM 会话。"""
    redis = await get_async_redis_client()
    session_id = await redis.get("iam:device-grant:" + device_hash)
    if not session_id:
        raise iam_failure(401, "iam_device_expired", "设备授权已失效，请重新登录")
    ttl = await redis.ttl("iam:session:" + session_id)
    if ttl <= 0:
        raise iam_failure(401, "iam_session_expired", "企业登录已过期，请重新登录")
    key_hash = hashlib.sha256(secret.encode()).hexdigest()
    await redis.set("iam:device-key:" + key_hash, session_id, ex=ttl, nx=True)


async def get_iam_device_session(secret: str) -> str:
    """解析设备凭据绑定，拒绝既有独立 API Key。"""
    redis = await get_async_redis_client()
    key_hash = hashlib.sha256(secret.encode()).hexdigest()
    session_id = await redis.get("iam:device-key:" + key_hash)
    if not session_id:
        raise iam_failure(401, "iam_device_expired", "设备登录已失效，请重新登录")
    return session_id


async def validate_iam_api_user(user: User, db: AsyncSession, config: IAMConfig, secret: str) -> User:
    """设备请求通过绑定的 IAM 会话实时自省身份与准入。"""
    session_id = await get_iam_device_session(secret)
    identity = await get_iam_identity(session_id, config)
    if user.uid != "iam_" + identity.user_id.hex:
        raise iam_failure(401, "iam_identity_invalid", "设备登录身份不一致，请重新登录")
    return await synchronize_iam_user(identity, db, config)


async def logout_iam_session(session_id: str, config: IAMConfig, *, expected_uid: str | None = None) -> None:
    """主动登出时先全平台吊销，再删除本地服务端会话。"""
    redis = await get_async_redis_client()
    key = "iam:session:" + session_id
    async with redis.lock("iam:refresh:" + session_id, timeout=30, blocking_timeout=10):
        raw = await redis.get(key)
        if raw:
            session = IAMSession.model_validate_json(raw)
            if expected_uid is not None and expected_uid != "iam_" + session.identity.user_id.hex:
                raise iam_failure(401, "iam_identity_invalid", "设备登录身份不一致，请重新登录")
            await iam_request(
                config,
                "POST",
                "/oauth2/revoke",
                form={
                    "token": session.access_token.get_secret_value(),
                    "revoke_all": "true",
                },
            )
            await redis.delete(key)
