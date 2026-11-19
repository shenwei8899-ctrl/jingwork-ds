"""真实 PostgreSQL 验证企业看板来源、完整会话键和日期窗口。"""

import os
from datetime import datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import null, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.services import statistics_detail_service
from yuxi.services.enterprise_productivity_service import get_enterprise_productivity
from yuxi.storage.postgres.models_business import DesktopConversationEvent as Event, ModelCreditCall, User

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest_asyncio.fixture
async def report_database(monkeypatch):
    """每个测试使用独立 schema，快照连接共享该测试的搜索路径。"""
    schema = "pytest_productivity_" + uuid4().hex
    control = create_async_engine(os.environ["POSTGRES_URL"])
    async with control.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        for table in (
            "users",
            "departments",
            "desktop_conversation_events",
            "model_credit_calls",
            "agents",
            "conversations",
            "messages",
            "tool_calls",
        ):
            await conn.execute(text(f'CREATE TABLE "{schema}".{table} (LIKE public.{table} INCLUDING ALL)'))
    engine = create_async_engine(os.environ["POSTGRES_URL"], connect_args={"server_settings": {"search_path": schema}})
    monkeypatch.setattr(statistics_detail_service, "get_iam_config", lambda: SimpleNamespace(enabled=False))
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()
        async with control.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await control.dispose()


async def test_enterprise_report_reconciles_members_days_experts_and_model_calls(report_database):
    """来源会话跨用户、设备和专家区分，调用累计与事件条数独立。"""
    now = datetime(2026, 11, 17, 12)
    async with report_database() as db:
        db.add_all(
            [
                User(
                    id=index,
                    uid=f"member-{index}",
                    username=f"成员{index}",
                    password_hash="unused",
                    is_deleted=int(index == 4),
                )
                for index in range(1, 5)
            ]
        )
        await db.flush()
        values = [
            (1, "a", "expert", "user_message", datetime(2026, 11, 10, 15, 59, 59)),
            (1, "a", "expert", "user_message", datetime(2026, 11, 10, 16)),
            (1, "a", "expert", "assistant_message", datetime(2026, 11, 11, 16)),
            (2, "a", "expert", "user_message", datetime(2026, 11, 11, 16)),
            (1, "b", "expert", "user_message", datetime(2026, 11, 17, 11)),
            (2, "a", "other", "assistant_message", datetime(2026, 11, 17, 11)),
            (3, "a", "expert", "user_message", now),
            (3, "a", "expert", "user_message", now + timedelta(microseconds=1)),
        ]
        db.add_all(
            [
                Event(
                    id=index,
                    user_id=user,
                    device_id=device,
                    agent_id=agent,
                    agent_name=agent,
                    thread_id="same",
                    event_id=str(index),
                    event_type=kind,
                    content="测试",
                    timestamp=timestamp,
                )
                for index, (user, device, agent, kind, timestamp) in enumerate(values, 1)
            ]
        )
        calls = [
            (
                1,
                "model-a",
                datetime(2026, 11, 10, 16),
                {"input_tokens": 100, "output_tokens": 20, "input_token_details": {"cache_read": 80}},
            ),
            (1, "model-a", datetime(2026, 11, 17, 11), {"input_tokens": 30, "output_tokens": 5}),
            (1, "model-a", datetime(2026, 11, 17, 11), None),
            (2, "model-b", now, {"input_tokens": 7, "output_tokens": 3}),
            (3, "model-b", now + timedelta(microseconds=1), {"input_tokens": 10, "output_tokens": 10}),
        ]
        db.add_all(
            [
                ModelCreditCall(
                    id=str(uuid4()),
                    uid=f"member-{user}",
                    period="2026-11",
                    model_spec=model,
                    created_at=timestamp,
                    usage=usage,
                    price={},
                    reservation=0,
                    status="usage_recorded" if usage else "usage_unknown",
                )
                for user, model, timestamp, usage in calls
            ]
        )
        await db.commit()
        result = await get_enterprise_productivity(db, "7days", now=now)
        assert result["summary"]["sessions"] == 5
        assert result["summary"]["questions"] == 6
        assert result["summary"]["messages"] == 8
        assert result["summary"]["members"] == 3
        assert result["summary"]["tokens"] == 185
        assert result["period"] == {
            "sessions": 5,
            "questions": 4,
            "messages": 6,
            "model_calls": 4,
            "missing_usage_calls": 1,
            "active_users": 3,
            "input_tokens": 137,
            "output_tokens": 28,
            "tokens": 165,
        }
        assert len(result["daily"]) == 7
        assert result["daily"][0]["date"] == "2026-11-11"
        assert result["daily"][0]["questions"] == 1
        assert result["daily"][0]["tokens"] == 120
        assert result["daily"][2]["questions"] == 0
        assert result["daily"][2]["tokens"] is None
        assert sum(row["questions"] for row in result["daily"]) == 4
        assert sum(row["tokens"] or 0 for row in result["daily"]) == 165
        assert sum(row["sessions"] for row in result["daily"]) == 6
        assert sum(row["sessions"] for row in result["experts"]) == 5
        assert sum(row["tokens"] or 0 for row in result["models"]) == 165
        assert result["top_members"][0]["uid"] == "member-1"
        assert result["top_members"][0]["questions"] == 2


async def test_empty_enterprise_report_preserves_unknown_usage_and_zero_activity(report_database):
    """空日志补齐日期，缺失 Token 可辨认，日期窗口随范围变化。"""
    async with report_database() as db:
        for period, days in (("7days", 7), ("14days", 14), ("30days", 30), ("90days", 90)):
            report = await get_enterprise_productivity(db, period, now=datetime(2026, 11, 17, 16))
            assert report["summary"]["sessions"] == 0
            assert report["summary"]["tokens"] is None
            assert report["period"]["tokens"] is None
            assert len(report["daily"]) == days
            assert report["daily"][-1]["date"] == "2026-11-18"
            assert all(row["tokens"] is None for row in report["daily"])
            assert report["top_members"] == report["models"] == report["experts"] == []


async def test_enterprise_dashboard_requires_superadmin(test_client, accounts):  # noqa: F811
    """企业完整使用统计维持超级管理员授权。"""
    sessions, users, headers = accounts
    path = "/api/dashboard/stats/enterprise"
    assert (await test_client.get(path)).status_code == 401
    assert (await test_client.get(path, headers=headers[1])).status_code == 403
    assert (await test_client.get(path, headers=headers[0])).status_code == 403
    async with sessions() as db:
        admin = await db.get(User, users[0].id)
        admin.role = "superadmin"
        await db.commit()
    response = await test_client.get(path, headers=headers[0], params={"time_range": "7days"})
    assert response.status_code == 200, response.text
    assert len(response.json()["daily"]) == 7
    assert (await test_client.get(path, headers=headers[0], params={"time_range": "all"})).status_code == 422


async def test_report_uses_one_read_only_snapshot_during_concurrent_ingestion(report_database, monkeypatch):
    """读数之间的真实写入不会使汇总、每日和模型分布来自不同快照。"""
    import asyncio
    from yuxi.services import enterprise_productivity_service as service

    now = datetime(2026, 11, 17, 12)
    async with report_database() as db:
        db.add(User(id=1, uid="snapshot-user", username="快照", password_hash="unused"))
        db.add(
            Event(
                id=1,
                user_id=1,
                device_id="a",
                agent_id="expert",
                agent_name="专家",
                thread_id="one",
                event_id="one",
                event_type="user_message",
                content="一",
                timestamp=now,
            )
        )
        await db.commit()
        reached = asyncio.Event()
        release = asyncio.Event()
        settings = {}
        original = service.get_statistics_details

        async def pause_after_members(snapshot, start, end):
            result = await original(snapshot, start, end)
            settings["isolation"] = await snapshot.scalar(text("SHOW transaction_isolation"))
            settings["read_only"] = await snapshot.scalar(text("SHOW transaction_read_only"))
            reached.set()
            await release.wait()
            return result

        monkeypatch.setattr(service, "get_statistics_details", pause_after_members)
        report_task = asyncio.create_task(get_enterprise_productivity(db, "7days", now=now))
        try:
            await asyncio.wait_for(reached.wait(), timeout=30)
            async with report_database() as writer:
                writer.add(
                    Event(
                        id=2,
                        user_id=1,
                        device_id="a",
                        agent_id="expert",
                        agent_name="专家",
                        thread_id="two",
                        event_id="two",
                        event_type="user_message",
                        content="二",
                        timestamp=now,
                    )
                )
                await writer.commit()
        finally:
            release.set()
        report = await report_task
        assert settings == {"isolation": "repeatable read", "read_only": "on"}
        assert report["summary"]["sessions"] == report["period"]["sessions"] == 1
        assert sum(row["questions"] for row in report["daily"]) == 1
        assert sum(row["sessions"] for row in report["experts"]) == 1
        async with report_database() as reader:
            assert await reader.scalar(text("SELECT count(*) FROM desktop_conversation_events")) == 2


async def test_web_timeseries_uses_full_first_interval_iso_week_and_window_totals(report_database):
    """首个时间桶完整，跨年 ISO 周与所选期间汇总保持一致。"""
    from datetime import UTC
    from yuxi.repositories.dashboard_repository import DashboardRepository
    from yuxi.storage.postgres.models_business import Agent, Conversation, Message, ToolCall

    now = datetime(2026, 1, 1, 12, 37, tzinfo=UTC)
    first_hour = datetime(2025, 12, 31, 23)
    first_day = datetime(2025, 12, 18, 16)
    async with report_database() as db:
        db.add(User(id=1, uid="web-user", username="Web", password_hash="unused"))
        db.add(Agent(id=1, slug="web-agent", name="Web", backend_id="test", share_config={}))
        db.add(
            Conversation(
                id=1,
                uid="web-user",
                agent_id="web-agent",
                thread_id="web-thread",
                project_id="web-project",
                status="active",
            )
        )
        db.add(
            Message(
                id=1,
                conversation_id=1,
                role="assistant",
                content="测试",
                created_at=first_hour,
                extra_metadata={"usage_metadata": {"input_tokens": 1, "output_tokens": 2}},
            )
        )
        timestamps = [
            first_hour + timedelta(seconds=1),
            first_hour - timedelta(microseconds=1),
            now.replace(tzinfo=None) + timedelta(microseconds=1),
            datetime(2025, 12, 29),
            first_day + timedelta(seconds=1),
        ]
        db.add_all(
            [
                ToolCall(id=index, message_id=1, tool_name="tool", status="success", created_at=timestamp)
                for index, timestamp in enumerate(timestamps, 1)
            ]
        )
        await db.commit()
        repo = DashboardRepository(db)
        hourly = await repo.get_call_timeseries(metric_type="tools", time_range="14hours", now=now)
        assert hourly["data"][0]["date"] == "2026-01-01 07:00"
        assert hourly["data"][0]["total"] == 1
        assert hourly["total_count"] == 1
        daily = await repo.get_call_timeseries(metric_type="tools", time_range="14days", now=now)
        assert daily["data"][0]["date"] == "2025-12-19"
        assert daily["data"][0]["total"] == 1
        assert daily["total_count"] == 4
        weekly = await repo.get_call_timeseries(metric_type="tools", time_range="14weeks", now=now)
        assert weekly["data"][-1]["date"] == "2026-01"
        assert weekly["data"][-1]["total"] == 3
        assert weekly["total_count"] == 4
        models = await repo.get_call_timeseries(metric_type="models", time_range="14hours", now=now)
        assert models["categories"] == ["未记录模型"]
        assert models["data"][0]["data"]["未记录模型"] == 1
        assert models["total_count"] == 1
        db.add(
            Message(
                id=2,
                conversation_id=1,
                role="assistant",
                content="测试",
                created_at=first_hour,
                extra_metadata=null(),
            )
        )
        await db.commit()
        models = await repo.get_call_timeseries(metric_type="models", time_range="14hours", now=now)
        assert models["categories"] == ["未记录模型"]
        assert models["data"][0]["data"]["未记录模型"] == 2
        assert models["total_count"] == 2
