"""真实 HTTP 与 PostgreSQL 验证身份不可伪造、管理员权限及分页。"""

import uuid
from sqlalchemy import delete
from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.storage.postgres.models_business import RuntimeErrorLog


async def test_runtime_logs_identity_permissions_redaction_and_cursor(test_client, accounts):  # noqa: F811
    sessions, users, headers = accounts
    operation = "pytest-runtime-" + uuid.uuid4().hex
    ids = []
    try:
        body = {
            "source": "desktop",
            "operation": operation,
            "error_code": "HTTP_403",
            "message": "Bearer top-secret token=hidden",
            "actions": ["打开模型", "发送对话"],
        }
        r = await test_client.post(
            "/api/system/runtime-logs", headers=headers[1], json={**body, "user_id": users[0].id}
        )
        assert r.status_code == 422
        for user_header in [headers[1], headers[2]]:
            r = await test_client.post("/api/system/runtime-logs", headers=user_header, json=body)
            assert r.status_code == 201, r.text
            ids.append(r.json()["id"])
        async with sessions() as db:
            row = await db.get(RuntimeErrorLog, ids[0])
            assert row.user_id == users[1].id and row.username == users[1].username
            assert row.uid == users[1].uid and "top-secret" not in row.message and "hidden" not in row.message
        assert (await test_client.get("/api/system/runtime-logs", headers=headers[1])).status_code == 403
        assert (await test_client.get("/api/system/runtime-logs")).status_code == 401
        r = await test_client.get(
            "/api/system/runtime-logs", headers=headers[0], params={"uid": users[1].uid, "limit": 1}
        )
        assert [x["id"] for x in r.json()["items"]] == [ids[0]]
        r = await test_client.get(
            "/api/system/runtime-logs", headers=headers[0], params={"username": users[2].username}
        )
        assert [x["id"] for x in r.json()["items"]] == [ids[1]]
        r = await test_client.get(
            "/api/system/runtime-logs",
            headers=headers[0],
            params={"since": "2026-12-01T00:00:00Z", "until": "2026-01-01T00:00:00Z"},
        )
        assert r.status_code == 422
    finally:
        async with sessions() as db:
            await db.execute(delete(RuntimeErrorLog).where(RuntimeErrorLog.id.in_(ids)))
            await db.commit()
