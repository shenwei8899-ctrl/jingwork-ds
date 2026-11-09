"""统一模型配置、成员额度与 OpenAI 兼容桌面入口。"""

import json
import time
from decimal import Decimal
from typing import Any
from uuid import uuid4

from openai import APIStatusError

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import convert_to_messages
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from server.utils.auth_middleware import get_admin_user, get_db, get_required_user
from yuxi.models.chat import load_chat_model
from yuxi.models.providers.cache import model_cache
from yuxi.repositories.model_credit_repository import ModelCreditRepository
from yuxi.services.model_credit_service import call_view, current_period, effective_policy, settle_call
from yuxi.storage.postgres.models_business import User

model_credits = APIRouter(prefix="/model-credits", tags=["model-credits"])


class ModelPrice(BaseModel):
    """人民币每百万 Token 价格，独立保存输入、输出和缓存费率。"""

    model_config = ConfigDict(extra="forbid")
    input: Decimal = Field(ge=0, le=1000000)
    output: Decimal = Field(ge=0, le=1000000)
    cache_read: Decimal = Field(ge=0, le=1000000)
    cache_write: Decimal = Field(ge=0, le=1000000)


class CreditPolicy(BaseModel):
    """管理员按作用域配置，不接受客户端供应商凭据。"""

    model_config = ConfigDict(extra="forbid")
    enabled: bool | None = None
    default_model: str | None = Field(default=None, max_length=512)
    allowed_models: list[str] | None = None
    monthly_credits: Decimal | None = Field(default=None, ge=0, le=1000000000)
    enterprise_monthly_credits: Decimal | None = Field(default=None, ge=0, le=1000000000000)
    max_output_tokens: int | None = Field(default=None, ge=1, le=32768)
    prices: dict[str, ModelPrice] | None = None


@model_credits.get("/me")
async def my_credits(user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """仅投影当前认证用户的配置和月余额。"""
    policy = await effective_policy(str(user.uid), db)
    rows = await ModelCreditRepository(db).balances(current_period())
    row = next((row for row in rows if row.scope == f"user:{user.uid}"), None)
    spent, reserved = (row.spent, row.reserved) if row else (Decimal(0), Decimal(0))
    limit = policy["monthly_credits"]
    return {
        "managed": policy["managed"],
        "default_model": policy["default_model"],
        "period": current_period(),
        "monthly_credits": str(limit) if limit is not None else None,
        "spent": str(spent),
        "reserved": str(reserved),
        "remaining": str(max(Decimal(0), Decimal(str(limit)) - spent - reserved)) if limit is not None else None,
    }


@model_credits.get("/calls")
async def my_calls(user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """个人调用明细不可通过查询参数改为其他用户。"""
    return {"items": [call_view(row) for row in await ModelCreditRepository(db).calls(str(user.uid))]}


@model_credits.get("/admin")
async def admin_credits(user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """管理后台读取无密钥配置、成员余额与近期账本。"""
    repo = ModelCreditRepository(db)
    return {
        "policies": await repo.policies(),
        "period": current_period(),
        "members": [
            {"uid": row.uid, "username": row.username, "department_id": row.department_id} for row in await repo.users()
        ],
        "balances": [
            {"scope": row.scope, "spent": str(row.spent), "reserved": str(row.reserved)}
            for row in await repo.balances(current_period())
        ],
        "calls": [call_view(row) for row in await repo.calls()],
        "models": [
            {"spec": info.spec, "name": info.display_name} for info in model_cache.get_all_specs(model_type="chat")
        ],
    }


@model_credits.put("/policies/{scope}")
async def update_policy(
    scope: str, body: CreditPolicy, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)
):
    """用户和部门只能覆盖分配与额度，全局开关和价格只在 global 修改。"""
    import re

    if scope != "global" and not re.fullmatch(r"(?:user|department):[A-Za-z0-9_-]{1,80}", scope):
        raise HTTPException(422, "无效的配置作用域")
    data = body.model_dump(mode="json", exclude_unset=True)
    if scope != "global" and any(k in data for k in ("enabled", "prices", "enterprise_monthly_credits")):
        raise HTTPException(422, "成员和部门不可覆盖全局价格或企业额度")
    for spec in [data.get("default_model"), *(data.get("allowed_models") or [])]:
        if spec and not model_cache.get_model_info(spec):
            raise HTTPException(422, "分配的模型未在后台启用")
    if data.get("enabled"):
        spec = data.get("default_model")
        info = model_cache.get_model_info(spec) if spec else None
        if not info or not info.api_key or not info.api_key.isascii() or any(c.isspace() for c in info.api_key):
            raise HTTPException(422, "启用前请配置有效默认模型及供应商密钥")
        if not (data.get("prices") or {}).get(spec):
            raise HTTPException(422, "启用前请填写默认模型价格")
    await ModelCreditRepository(db).save_policy(scope, data)
    await db.commit()
    return {"scope": scope, "settings": data}


@model_credits.post("/admin/calls/{call_id}/settle")
async def reconcile_call(call_id: str, usage: dict[str, Any], user: User = Depends(get_admin_user)):
    """管理员使用上游真实 Token 明细核对未知用量，不按估算清零。"""
    if any(not isinstance(usage.get(k), int) or usage[k] < 0 for k in ("input_tokens", "output_tokens")):
        raise HTTPException(422, "请填写上游实际输入和输出 Token")
    await settle_call(call_id, usage)
    return {"success": True}


@model_credits.post("/v1/chat/completions")
async def desktop_completion(
    body: dict[str, Any], user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)
):
    """桌面仅提交消息和工具，执行模型由当前账号管理员策略决定。"""
    policy = await effective_policy(str(user.uid), db)
    requested = body.get("model")
    spec = requested if requested and requested != "managed" else policy["default_model"]
    if not spec:
        raise HTTPException(503, "管理员尚未配置企业模型")
    if policy["managed"] and spec not in (policy.get("allowed_models") or [policy["default_model"]]):
        raise HTTPException(403, "当前账号无权使用所选企业模型")
    model = load_chat_model(spec, uid=str(user.uid))
    tools = body.get("tools")
    if tools:
        model = model.bind_tools(tools, tool_choice=body.get("tool_choice"))
    try:
        messages = convert_to_messages(body.get("messages") or [])
    except (ValueError, TypeError) as error:
        raise HTTPException(422, "消息格式无效") from error
    if body.get("stream"):
        # 先取得第一块，使权限、额度和模型配置错误在响应头发送前返回。
        iterator = model.astream(messages)
        try:
            first = await anext(iterator)
        except APIStatusError as error:
            raise HTTPException(
                403 if error.status_code == 401 else error.status_code,
                f"企业模型调用失败（{spec}），请检查服务商套餐、模型授权或后台密钥",
            ) from error
        except StopAsyncIteration as error:
            raise HTTPException(502, "模型未返回内容") from error
        reply_id, created = "chatcmpl-" + uuid4().hex, int(time.time())

        async def chunks():
            """逐块转发真实模型输出，关闭迭代器时保留未知用量预占。"""
            aggregate = None
            try:
                chunk = first
                while True:
                    aggregate = chunk if aggregate is None else aggregate + chunk
                    delta = {"content": chunk.content}
                    if chunk.tool_call_chunks:
                        delta["tool_calls"] = [
                            {
                                "index": call.get("index", 0),
                                "id": call.get("id"),
                                "type": "function",
                                "function": {"name": call.get("name"), "arguments": call.get("args", "")},
                            }
                            for call in chunk.tool_call_chunks
                        ]
                    item = {
                        "id": reply_id,
                        "created": created,
                        "model": spec,
                        "object": "chat.completion.chunk",
                        "usage": None,
                        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
                    }
                    yield "data: " + json.dumps(item, ensure_ascii=False) + "\n\n"
                    try:
                        chunk = await anext(iterator)
                    except StopAsyncIteration:
                        break
                actual = aggregate.usage_metadata if aggregate is not None else None
                item["choices"] = [
                    {"index": 0, "delta": {}, "finish_reason": "tool_calls" if aggregate.tool_calls else "stop"}
                ]
                item["usage"] = (
                    {
                        "prompt_tokens": actual["input_tokens"],
                        "completion_tokens": actual["output_tokens"],
                        "total_tokens": actual["total_tokens"],
                        "prompt_tokens_details": {
                            "cached_tokens": (actual.get("input_token_details") or {}).get("cache_read", 0)
                        },
                    }
                    if actual
                    else None
                )
                yield "data: " + json.dumps(item) + "\n\n"
                yield "data: [DONE]\n\n"
            finally:
                await iterator.aclose()

        return StreamingResponse(chunks(), media_type="text/event-stream")
    try:
        result = await model.ainvoke(messages)
    except APIStatusError as error:
        raise HTTPException(
            403 if error.status_code == 401 else error.status_code,
            f"企业模型调用失败（{spec}），请检查服务商套餐、模型授权或后台密钥",
        ) from error
    data = {"role": "assistant", "content": result.content}
    if result.tool_calls:
        data["tool_calls"] = [
            {
                "id": call["id"],
                "type": "function",
                "function": {"name": call["name"], "arguments": json.dumps(call["args"], ensure_ascii=False)},
            }
            for call in result.tool_calls
        ]
    usage = result.usage_metadata or {}
    reply = {
        "id": "chatcmpl-" + uuid4().hex,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": spec,
        "choices": [{"index": 0, "message": data, "finish_reason": "tool_calls" if result.tool_calls else "stop"}],
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
        if usage
        else None,
    }
    return reply


class RelayConnectionInput(BaseModel):
    """中转站管理员 Key 只输入后台，不返回给桌面。"""

    model_config = ConfigDict(extra="forbid")
    base_url: str = "https://router.keenlight.ai"
    admin_key: str = Field(min_length=8, max_length=1000)
    usd_to_cny: Decimal = Field(gt=0, le=1000)


class RelayMemberInput(BaseModel):
    """绑定明确选择的中转站成员和 API Key。"""

    relay_user_id: int = Field(gt=0)
    relay_key_id: int = Field(gt=0)


@model_credits.put("/relay")
async def connect_relay(
    body: RelayConnectionInput, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)
):
    """验证管理员管理接口后保存连接，响应不含凭据。"""
    from yuxi.services.model_relay_service import save_connection

    return await save_connection(db, body.base_url, body.admin_key, body.usd_to_cny)


@model_credits.get("/relay")
async def relay_status(user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """读取连接状态，不回传管理员 Key。"""
    from yuxi.services.model_relay_service import connection

    config = await connection(db)
    return {
        "connected": bool(config),
        "base_url": config.base_url if config else "https://router.keenlight.ai",
        "usd_to_cny": str(config.usd_to_cny) if config else None,
    }


@model_credits.get("/relay/users")
async def relay_users(page: int = 1, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """分页列出可绑定成员，仅输出身份和余额。"""
    from yuxi.services.model_relay_service import connection, relay_request

    config = await connection(db)
    if config is None:
        raise HTTPException(409, "请先连接中转站")
    data = await relay_request(config, "GET", "/users", params={"page": page, "page_size": 100})
    return {
        "items": [
            {k: row.get(k) for k in ("id", "username", "email", "status", "balance")} for row in data.get("items", [])
        ],
        "total": data.get("total", 0),
    }


@model_credits.get("/relay/users/{relay_user_id}/keys")
async def relay_keys(relay_user_id: int, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """管理员选择 Key 元数据，服务器持有实际 Key。"""
    from yuxi.services.model_relay_service import connection, relay_request

    config = await connection(db)
    if config is None:
        raise HTTPException(409, "请先连接中转站")
    data = await relay_request(config, "GET", f"/users/{relay_user_id}/api-keys", params={"page_size": 100})
    return {
        "items": [
            {k: row.get(k) for k in ("id", "name", "status", "group_id", "quota", "quota_used")}
            for row in data.get("items", [])
        ]
    }


@model_credits.put("/relay/members/{uid}")
async def relay_bind(
    uid: str, body: RelayMemberInput, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)
):
    """后台绑定本地账号，不创建或猜测远端用户。"""
    from yuxi.services.model_relay_service import bind_member

    if await ModelCreditRepository(db).user(uid) is None:
        raise HTTPException(404, "账号不存在")
    return await bind_member(db, uid, body.relay_user_id, body.relay_key_id)


@model_credits.get("/relay/usage")
async def relay_my_usage(user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """普通用户仅可查看本人绑定的中转站真实用量。"""
    from yuxi.services.model_relay_service import member_usage

    return await member_usage(db, str(user.uid))


class RelayModelsInput(BaseModel):
    """管理员明确选择已验证成员可用的模型，不保存成员密钥为全局凭据。"""

    model_config = ConfigDict(extra="forbid")
    uid: str = Field(min_length=1, max_length=80)
    models: list[str] = Field(min_length=1, max_length=100)


@model_credits.put("/relay/models")
async def relay_models(
    body: RelayModelsInput, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)
):
    """将已绑定成员的模型权限验证为可分配目录。"""
    from yuxi.services.model_relay_service import register_models

    return await register_models(db, body.uid, body.models, user.username)
