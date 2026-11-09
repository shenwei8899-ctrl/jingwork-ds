"""操作日志真实 HTTP 与 PostgreSQL 查询验收。"""

from datetime import datetime
import uuid

from sqlalchemy import delete

from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.storage.postgres.models_business import OperationLog


async def test_admin_filters_cursor_details_and_time_range(test_client, accounts):  # noqa: F811
    """管理员读取实际日志，游标不重复、员工及时间筛选精确，普通用户不可读取。"""
    sessions, users, headers = accounts
    action = "pytest-operation-" + uuid.uuid4().hex
    async with sessions() as db:
        entries = [
            OperationLog(
                user_id=users[0].id, operation=action, details="original detail", timestamp=datetime(2026, 1, 1, 0, 0)
            ),
            OperationLog(
                user_id=users[1].id, operation=action, details="second detail", timestamp=datetime(2026, 1, 2, 0, 0)
            ),
        ]
        db.add_all(entries)
        await db.commit()
    try:
        for endpoint in ["/api/system/operation-logs", "/api/system/operation-logs/filters"]:
            response = await test_client.get(endpoint, headers=headers[1])
            assert response.status_code == 403, response.text
            response = await test_client.get(endpoint)
            assert response.status_code == 401, response.text
        response = await test_client.get("/api/system/operation-logs/filters", headers=headers[0])
        assert action in response.json()["operations"]
        assert users[1].uid in {row["uid"] for row in response.json()["users"]}
        for filters, expected in [
            ({"department_id": users[0].department_id, "role": "admin"}, ["original detail"]),
            ({"department_id": users[0].department_id, "role": "user"}, ["second detail"]),
            ({"department_id": 2147483647}, []),
            ({"user_id": users[0].id, "role": "user"}, []),
        ]:
            response = await test_client.get(
                "/api/system/operation-logs", headers=headers[0], params={"operation": action, **filters}
            )
            assert response.status_code == 200, response.text
            assert [row["details"] for row in response.json()["items"]] == expected
        for invalid in ({"role": "sales"}, {"department_id": 0}):
            response = await test_client.get("/api/system/operation-logs", headers=headers[0], params=invalid)
            assert response.status_code == 422
        params = {"operation": action, "limit": 1}
        response = await test_client.get("/api/system/operation-logs", headers=headers[0], params=params)
        assert response.status_code == 200, response.text
        first = response.json()
        assert first["items"][0]["details"] == "second detail"
        response = await test_client.get(
            "/api/system/operation-logs", headers=headers[0], params={**params, "before_id": first["next_cursor"]}
        )
        second = response.json()
        assert second["items"][0]["details"] == "original detail"
        assert second["next_cursor"] is None
        assert first["items"][0]["id"] != second["items"][0]["id"]
        response = await test_client.get(
            "/api/system/operation-logs",
            headers=headers[0],
            params={
                "operation": action,
                "user_id": users[0].id,
                "since": "2026-01-01T08:00:00+08:00",
                "until": "2026-01-01T08:01:00+08:00",
            },
        )
        assert [row["details"] for row in response.json()["items"]] == ["original detail"]
        response = await test_client.get(
            "/api/system/operation-logs",
            headers=headers[0],
            params={"since": "2026-02-01T00:00:00Z", "until": "2026-01-01T00:00:00Z"},
        )
        assert response.status_code == 422
        response = await test_client.get("/api/system/operation-logs", headers=headers[0], params={"limit": 101})
        assert response.status_code == 422
    finally:
        async with sessions() as db:
            await db.execute(delete(OperationLog).where(OperationLog.operation == action))
            await db.commit()
