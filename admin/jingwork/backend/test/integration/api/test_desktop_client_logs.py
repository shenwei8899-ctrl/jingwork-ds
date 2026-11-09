"""桌面日志通过真实 HTTP 和 PostgreSQL 验证身份绑定及并发重试去重。"""

import asyncio
import uuid
from sqlalchemy import delete, select
from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.storage.postgres.models_business import OperationLog, RuntimeErrorLog


async def test_desktop_logs_are_account_bound_and_idempotent(test_client, accounts):  # noqa: F811
    """匿名和身份覆盖请求被拒绝，串行与并发重试复用回执且账号之间独立落库。"""
    sessions, users, headers = accounts
    correlation = uuid.uuid4().hex
    user_ids = [user.id for user in users]
    operation = {"operation": "agent_save", "outcome": "success", "correlation_id": correlation}
    runtime = {
        "source": "desktop",
        "operation": "renderer",
        "error_code": "renderer_console_error",
        "message": "Bearer private-token",
        "correlation_id": correlation,
        "actions": ["agent_save"],
    }
    ids = []
    runtime_ids = []
    try:
        rejected = await test_client.post(
            "/api/system/operation-logs", headers=headers[1], json={**operation, "operation": "arbitrary_action"}
        )
        assert rejected.status_code == 422
        for route, body, model, key in [
            ("operation-logs", operation, OperationLog, ids),
            ("runtime-logs", runtime, RuntimeErrorLog, runtime_ids),
        ]:
            path = "/api/system/" + route
            source_event = (
                OperationLog.details == "desktop:" + correlation
                if model is OperationLog
                else RuntimeErrorLog.correlation_id == correlation
            )
            invalid = await test_client.post(path, headers=headers[1], json={**body, "user_id": users[0].id})
            assert invalid.status_code == 422
            assert (await test_client.post(path, json=body)).status_code == 401
            async with sessions() as db:
                assert await db.scalar(select(model.id).where(source_event, model.user_id.in_(user_ids))) is None
            responses = await asyncio.gather(*[test_client.post(path, headers=headers[1], json=body) for _ in range(2)])
            assert all(response.status_code == 201 for response in responses)
            key.append(responses[0].json()["id"])
            assert responses[1].json()["id"] == key[0]
            replayed = await test_client.post(path, headers=headers[1], json=body)
            assert replayed.status_code == 201
            assert replayed.json()["id"] == key[0]
            async with sessions() as db:
                row = await db.get(model, key[0])
                assert row.user_id == users[1].id
                if model is RuntimeErrorLog:
                    assert "private-token" not in row.message
            other = await test_client.post(path, headers=headers[2], json=body)
            assert other.status_code == 201
            key.append(other.json()["id"])
            assert key[1] != key[0]
            async with sessions() as db:
                rows = (
                    await db.scalars(select(model).where(source_event, model.user_id.in_(user_ids)))
                ).all()
                assert {(row.id, row.user_id) for row in rows} == {(key[0], users[1].id), (key[1], users[2].id)}
        listed = await test_client.get(
            "/api/system/operation-logs",
            headers=headers[0],
            params={"user_id": users[1].id, "operation": "desktop.agent_save.success"},
        )
        assert ids[0] in [row["id"] for row in listed.json()["items"]]
    finally:
        async with sessions() as db:
            await db.execute(delete(OperationLog).where(OperationLog.user_id.in_(user_ids)))
            await db.execute(delete(RuntimeErrorLog).where(RuntimeErrorLog.user_id.in_(user_ids)))
            await db.commit()
