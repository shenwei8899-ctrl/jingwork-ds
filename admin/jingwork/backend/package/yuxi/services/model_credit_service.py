"""模型分配、每次调用额度预占与幂等结算。"""

from datetime import datetime
from decimal import ROUND_UP, Decimal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from yuxi.config.options import system_options
from yuxi.models.providers.cache import model_cache
from yuxi.repositories.model_credit_repository import ModelCreditRepository
from yuxi.storage.postgres.manager import pg_manager
from yuxi.storage.postgres.models_business import ModelCreditCall
from yuxi.utils.datetime_utils import utc_now_naive

PRICE_FIELDS = ("input", "output", "cache_read", "cache_write")
CREDIT_SCALE = Decimal("0.000001")


def current_period():
    """月额度以 Asia/Shanghai 自然月划分。"""
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")


def usage_credits(usage, price):
    """供应商返回 input 已包含缓存时减去读取和写入，避免重复计费。"""
    validate_usage(usage)
    input_tokens = int(usage.get("input_tokens", 0))
    details = usage.get("input_token_details") or {}
    read = int(details.get("cache_read", 0))
    write = int(details.get("cache_creation", 0))
    tokens = (max(0, input_tokens - read - write), int(usage.get("output_tokens", 0)), read, write)
    cost = sum(Decimal(str(price[field])) * count for field, count in zip(PRICE_FIELDS, tokens, strict=True))
    return (cost * Decimal(100) / Decimal(1_000_000)).quantize(CREDIT_SCALE, rounding=ROUND_UP)


def validate_usage(usage):
    """拒绝负数、布尔值和不完整缓存明细，避免错误账单。"""
    details = usage.get("input_token_details") or {}
    if not isinstance(details, dict):
        raise HTTPException(422, "缓存用量格式无效")
    counts = [
        usage.get("input_tokens"),
        usage.get("output_tokens"),
        details.get("cache_read", 0),
        details.get("cache_creation", 0),
    ]
    if any(type(count) is not int or count < 0 for count in counts):
        raise HTTPException(422, "Token 用量必须为非负整数")
    if counts[2] + counts[3] > counts[0]:
        raise HTTPException(422, "缓存 Token 不能超过输入 Token")


async def effective_policy(uid, db):
    """用户配置覆盖部门，再覆盖全员；模型策略每次调用重新读取。"""
    repo = ModelCreditRepository(db)
    user = await repo.user(uid)
    if user is None or getattr(user, "is_active", True) is False:
        raise HTTPException(403, "账号不可用")
    policies = await repo.policies()
    global_policy = policies.get("global", {})
    policy = {"monthly_credits": 10000, **global_policy}
    if user.department_id:
        policy.update(policies.get(f"department:{user.department_id}", {}))
    policy.update(policies.get(f"user:{uid}", {}))
    policy["managed"] = bool(global_policy.get("enabled", False))
    if not policy.get("default_model"):
        policy["default_model"] = (await system_options.get(db))["default_model"]
    policy["prices"] = global_policy.get("prices", {})
    policy["enterprise_monthly_credits"] = global_policy.get("enterprise_monthly_credits")
    return policy


async def reserve_call(uid, requested_model, input_tokens, *, thread_id=None):
    """预占最坏输入价格和固定输出上限，余额不足时不产生上游调用。"""
    async with pg_manager.get_async_session_context() as db:
        policy = await effective_policy(uid, db)
        if not policy["managed"]:
            return None, requested_model, None
        spec = requested_model or policy["default_model"]
        allowed = policy.get("allowed_models") or [policy["default_model"]]
        # 显式选择仍须处于管理员授权集合，计费使用实际所选模型。
        if spec not in allowed:
            raise HTTPException(403, "当前账号无权使用所选企业模型")
        info = model_cache.get_model_info(spec)
        if not info or not info.api_key or not info.api_key.isascii() or any(c.isspace() for c in info.api_key):
            raise HTTPException(503, "模型凭据未正确配置，请联系管理员")
        price = policy["prices"].get(spec)
        if not price:
            raise HTTPException(503, "模型计费价格未配置，请联系管理员")
        output_cap = int(policy.get("max_output_tokens", 4096))
        worst = max(Decimal(str(price[k])) for k in ("input", "cache_read", "cache_write"))
        reservation = (
            (worst * max(0, input_tokens) + Decimal(str(price["output"])) * output_cap)
            * Decimal(100)
            / Decimal(1_000_000)
        ).quantize(CREDIT_SCALE, rounding=ROUND_UP)
        repo = ModelCreditRepository(db)
        period = current_period()
        enterprise, member = await repo.locked_balances(uid, period)
        for balance, limit in (
            (enterprise, policy.get("enterprise_monthly_credits")),
            (member, policy.get("monthly_credits")),
        ):
            if limit is not None and balance.spent + balance.reserved + reservation > Decimal(str(limit)):
                raise HTTPException(402, "本月模型额度不足，请联系管理员调整额度")
        enterprise.reserved += reservation
        member.reserved += reservation
        call = ModelCreditCall(
            id=str(uuid4()),
            uid=uid,
            period=period,
            model_spec=spec,
            thread_id=thread_id,
            price=price,
            reservation=reservation,
            status="reserved",
        )
        db.add(call)
        await db.commit()
        return call.id, spec, output_cap


async def settle_call(call_id, usage):
    """重复结算只读取最终事实；缺失真实 usage 保留预占并标记待核对。"""
    if call_id is None:
        return
    async with pg_manager.get_async_session_context() as db:
        repo = ModelCreditRepository(db)
        original = await repo.call(call_id)
        if original is None:
            raise HTTPException(404, "调用记录不存在")
        enterprise, member = await repo.locked_balances(original.uid, original.period)
        call = await repo.call(call_id, lock=True)
        if call.status == "settled":
            return
        if not usage or "input_tokens" not in usage or "output_tokens" not in usage:
            call.status = "pending_review"
        else:
            credits = usage_credits(usage, call.price)
            for balance in (enterprise, member):
                balance.reserved -= call.reservation
                balance.spent += credits
            call.credits, call.usage = credits, usage
            call.status, call.settled_at = "settled", utc_now_naive()
        await db.commit()


def call_view(call):
    """账本投影只输出用途、模型、用量和金额。"""
    return {
        "id": call.id,
        "uid": call.uid,
        "period": call.period,
        "model_spec": call.model_spec,
        "thread_id": call.thread_id,
        "usage": call.usage,
        "price": call.price,
        "reserved_credits": str(call.reservation),
        "credits": str(call.credits) if call.credits is not None else None,
        "status": call.status,
        "created_at": call.created_at.isoformat() + "Z",
    }
