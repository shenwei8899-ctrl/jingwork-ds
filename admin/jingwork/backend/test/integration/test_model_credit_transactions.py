"""真实 PostgreSQL 并发额度预占和幂等结算。"""

import asyncio
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from yuxi.services import model_credit_service as service
from yuxi.storage.postgres.manager import pg_manager
from yuxi.storage.postgres.models_business import ModelCreditBalance, ModelCreditCall, User


@pytest.mark.asyncio
async def test_concurrent_reservations_and_settlements(monkeypatch):
    """有限额度只允许一次并发预占，相同调用只扣费一次。"""
    pg_manager.initialize()
    period = "t" + uuid4().hex[:6]
    async with pg_manager.get_async_session_context() as db:
        uid = await db.scalar(select(User.uid).where(User.is_deleted == 0).limit(1))
    assert uid is not None
    price = {"input": "10000", "output": "10000", "cache_read": "10000", "cache_write": "10000"}

    async def policy(*args):
        return {
            "managed": True,
            "default_model": "test:fake",
            "allowed_models": ["test:fake"],
            "prices": {"test:fake": price},
            "max_output_tokens": 1,
            "monthly_credits": 2,
            "enterprise_monthly_credits": 2,
        }

    monkeypatch.setattr(service, "effective_policy", policy)
    monkeypatch.setattr(service, "current_period", lambda: period)
    monkeypatch.setattr(service.model_cache, "get_model_info", lambda spec: SimpleNamespace(api_key="test-key"))
    try:
        results = await asyncio.gather(
            *(service.reserve_call(str(uid), "test:fake", 1) for _ in range(2)), return_exceptions=True
        )
        success = [result for result in results if isinstance(result, tuple)]
        failure = [result for result in results if isinstance(result, HTTPException)]
        assert len(success) == 1
        assert len(failure) == 1 and failure[0].status_code == 402
        call_id = success[0][0]
        usage = {"input_tokens": 1, "output_tokens": 0}
        await asyncio.gather(service.settle_call(call_id, usage), service.settle_call(call_id, usage))
        async with pg_manager.get_async_session_context() as db:
            balances = list(
                (await db.execute(select(ModelCreditBalance).where(ModelCreditBalance.period == period))).scalars()
            )
            assert len(balances) == 2
            assert all(row.spent == Decimal("1") and row.reserved == 0 for row in balances)
        unknown, _, _ = await service.reserve_call(str(uid), "test:fake", 0)
        await service.settle_call(unknown, None)
        async with pg_manager.get_async_session_context() as db:
            call = await db.get(ModelCreditCall, unknown)
            assert call.status == "pending_review"
            balances = list(
                (await db.execute(select(ModelCreditBalance).where(ModelCreditBalance.period == period))).scalars()
            )
            assert all(row.spent == Decimal("1") and row.reserved == Decimal("1") for row in balances)
        await service.settle_call(unknown, {"input_tokens": 0, "output_tokens": 0})
        async with pg_manager.get_async_session_context() as db:
            balances = list(
                (await db.execute(select(ModelCreditBalance).where(ModelCreditBalance.period == period))).scalars()
            )
            assert all(row.spent == Decimal("1") and row.reserved == 0 for row in balances)
    finally:
        async with pg_manager.get_async_session_context() as db:
            await db.execute(delete(ModelCreditCall).where(ModelCreditCall.period == period))
            await db.execute(delete(ModelCreditBalance).where(ModelCreditBalance.period == period))
            await db.commit()
        await pg_manager.close()


@pytest.mark.asyncio
async def test_selected_enterprise_model_uses_its_own_price_and_denies_other_models(monkeypatch):
    """显式选择在真实预占记录中保持模型及价格，拒绝未授权模型。"""
    pg_manager.initialize()
    period = "s" + uuid4().hex[:6]
    async with pg_manager.get_async_session_context() as db:
        uid = await db.scalar(select(User.uid).where(User.is_deleted == 0).limit(1))
    selected_price = {"input": "2", "output": "3", "cache_read": "1", "cache_write": "2"}

    async def policy(*args):
        return {
            "managed": True,
            "default_model": "test:default",
            "allowed_models": ["test:default", "test:selected"],
            "prices": {
                "test:default": {"input": "9", "output": "9", "cache_read": "9", "cache_write": "9"},
                "test:selected": selected_price,
            },
            "max_output_tokens": 1,
        }

    monkeypatch.setattr(service, "effective_policy", policy)
    monkeypatch.setattr(service, "current_period", lambda: period)
    monkeypatch.setattr(service.model_cache, "get_model_info", lambda spec: SimpleNamespace(api_key="test-key"))
    try:
        call_id, spec, _ = await service.reserve_call(str(uid), "test:selected", 1)
        assert spec == "test:selected"
        async with pg_manager.get_async_session_context() as db:
            record = await db.get(ModelCreditCall, call_id)
            assert record.model_spec == "test:selected"
            assert record.price == selected_price
        with pytest.raises(HTTPException) as error:
            await service.reserve_call(str(uid), "test:denied", 1)
        assert error.value.status_code == 403
        async with pg_manager.get_async_session_context() as db:
            assert (
                len(list((await db.execute(select(ModelCreditCall).where(ModelCreditCall.period == period))).scalars()))
                == 1
            )
    finally:
        async with pg_manager.get_async_session_context() as db:
            await db.execute(delete(ModelCreditCall).where(ModelCreditCall.period == period))
            await db.execute(delete(ModelCreditBalance).where(ModelCreditBalance.period == period))
            await db.commit()
        await pg_manager.close()
