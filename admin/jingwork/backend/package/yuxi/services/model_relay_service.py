"""按 KeenLight/Sub2API 管理协议连接成员和上游账单。"""

from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from yuxi.storage.postgres.models_business import ModelRelayConnection, ModelRelayMember
from yuxi.repositories.model_credit_repository import ModelCreditRepository
from sqlalchemy.exc import IntegrityError


async def connection(db):
    """管理凭据仅在服务器侧读取。"""
    return await ModelCreditRepository(db).relay_connection()


async def relay_request(config, method, path, *, body=None, params=None):
    """固定来源、禁止重定向，错误不回传上游请求头或 Key。"""
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as client:
            response = await client.request(
                method,
                config.base_url + "/api/v1/admin" + path,
                headers={"x-api-key": config.admin_key},
                json=body,
                params=params,
            )
    except httpx.HTTPError as error:
        raise HTTPException(503, "中转站暂时无法连接") from error
    if not response.is_success:
        raise HTTPException(502, f"中转站管理接口返回 {response.status_code}，请检查管理员 Key 与权限")
    result = response.json()
    if result.get("code", 0) != 0:
        raise HTTPException(502, "中转站管理操作未成功")
    return result.get("data")


async def save_connection(db, base_url, admin_key, usd_to_cny):
    """验证 HTTPS 管理地址和管理员凭据后保存，不创建远端资源。"""
    parsed = urlsplit(base_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(422, "中转站地址必须为 HTTPS，不能包含用户名、密码或查询参数")
    row = ModelRelayConnection(
        id="keenlight", base_url=base_url.rstrip("/"), admin_key=admin_key, usd_to_cny=usd_to_cny
    )
    await relay_request(row, "GET", "/users", params={"page": 1, "page_size": 1})
    await ModelCreditRepository(db).save_relay_connection(row)
    await db.commit()
    return {"connected": True, "base_url": row.base_url, "usd_to_cny": str(row.usd_to_cny)}


async def bind_member(db, uid, relay_user_id, relay_key_id):
    """绑定明确选择的远端账号和 Key，不以姓名猜测账号归属。"""
    config = await connection(db)
    if config is None:
        raise HTTPException(409, "请先连接中转站")
    result = await relay_request(config, "GET", f"/users/{relay_user_id}/api-keys", params={"page_size": 100})
    keys = result.get("items", [])
    key = next((item for item in keys if item["id"] == relay_key_id and item["user_id"] == relay_user_id), None)
    if key is None or key["status"] != "active" or not key.get("key"):
        raise HTTPException(422, "请选择属于该成员的有效 API Key")
    row = ModelRelayMember(uid=uid, relay_user_id=relay_user_id, relay_key_id=relay_key_id, api_key=key["key"])
    try:
        await ModelCreditRepository(db).save_relay_member(row)
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(409, "该中转站成员或 Key 已绑定其他账号") from error
    return {"uid": uid, "relay_user_id": relay_user_id, "relay_key_id": relay_key_id}


async def member_usage(db, uid):
    """读取已绑定成员的真实上游用量，输出美元原值和显式汇率。"""
    config = await connection(db)
    member = await ModelCreditRepository(db).relay_member(uid)
    if config is None or member is None:
        return {"bound": False}
    usage = await relay_request(config, "GET", f"/users/{member.relay_user_id}/usage", params={"period": "month"})
    return {
        "bound": True,
        "relay_user_id": member.relay_user_id,
        "usage_usd": usage,
        "usd_to_cny": str(config.usd_to_cny),
    }


async def member_credentials(db, uid):
    """调用凭据仅返回内部执行器，不作为 HTTP 响应。"""
    config = await connection(db)
    member = await ModelCreditRepository(db).relay_member(uid)
    if config is None or member is None:
        return None
    return {"base_url": config.base_url + "/v1", "api_key": member.api_key}


async def register_models(db, uid, models, username):
    """用已绑定成员校验模型清单，只存目录，运行时读取成员自己的 Key。"""
    from yuxi.models.providers.cache import model_cache
    from yuxi.models.providers.repository import get_model_provider
    from yuxi.models.providers.service import create_provider_config, get_all_model_providers, update_provider_config

    credentials = await member_credentials(db, uid)
    if credentials is None:
        raise HTTPException(409, "请先绑定用于验证模型权限的成员")
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False, trust_env=False) as client:
            response = await client.get(
                credentials["base_url"] + "/models", headers={"Authorization": "Bearer " + credentials["api_key"]}
            )
        response.raise_for_status()
        available = {row["id"] for row in response.json().get("data", [])}
    except (httpx.HTTPError, ValueError, KeyError) as error:
        raise HTTPException(502, "无法读取成员可用模型清单，请检查中转站模型权限") from error
    if not set(models).issubset(available):
        raise HTTPException(422, "所选模型不在该成员可用模型清单内")
    payload = {
        "provider_id": "keenlight",
        "display_name": "KeenLight 中转站",
        "provider_type": "openai",
        "base_url": credentials["base_url"],
        "api_key": "member-credential-required",
        "is_enabled": True,
        "capabilities": ["chat"],
        "enabled_models": [
            {"id": model, "display_name": model, "type": "chat", "source": "manual"} for model in dict.fromkeys(models)
        ],
    }
    if await get_model_provider(db, "keenlight"):
        await update_provider_config(db, "keenlight", payload, username)
    else:
        await create_provider_config(db, payload, username)
    await db.commit()
    model_cache.rebuild(await get_all_model_providers(db))
    return {"models": ["keenlight:" + model for model in dict.fromkeys(models)]}
