"""真实 HTTP PostgreSQL 验证明细时间窗口与权限。"""

from test.integration.api.test_octop_experts import accounts  # noqa: F401


async def test_statistics_details(test_client, accounts):  # noqa: F811
    _, users, headers = accounts
    # Dashboard retains superadmin authorization; regular administrators cannot read it.
    params = {"start": "2026-10-01", "end": "2026-10-07"}
    assert (await test_client.get("/api/dashboard/statistics-details", params=params)).status_code == 401
    assert (
        await test_client.get("/api/dashboard/statistics-details", params=params, headers=headers[1])
    ).status_code == 403
    from yuxi.repositories.statistics_detail_repository import statistics_details
    from yuxi.storage.postgres.models_business import DesktopConversationEvent
    from datetime import datetime

    sessions, users, _ = accounts
    async with sessions() as db:
        db.add(
            DesktopConversationEvent(
                user_id=users[1].id,
                device_id="test",
                agent_id="expert",
                agent_name="test",
                event_id="start",
                thread_id="thread",
                event_type="user_message",
                content="test",
                timestamp=datetime(2026, 10, 1),
            )
        )
        admin = await db.get(type(users[0]), users[0].id)
        admin.role = "superadmin"
        await db.commit()
        result = await statistics_details(db, datetime(2026, 10, 1), datetime(2026, 10, 2), search=users[1].uid)
        assert result["total"] == 1
        assert result["items"][0]["questions"] == 1
        assert result["items"][0]["sessions"] == 1
        result = await statistics_details(db, datetime(2026, 10, 2), datetime(2026, 10, 3), search=users[1].uid)
        assert result["items"][0]["messages"] == 0
        result = await statistics_details(
            db, datetime(2026, 10, 1), datetime(2026, 10, 2), department_id=users[1].department_id, mode="departments"
        )
        assert result["items"][0]["questions"] == 1
        assert result["items"][0]["members"] == 3

    response = await test_client.get(
        "/api/dashboard/statistics-details", headers=headers[0], params={**params, "search": users[1].uid}
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["questions"] == 1
    response = await test_client.get(
        "/api/dashboard/statistics-details", headers=headers[0], params={"start": "2026-10-07", "end": "2026-10-01"}
    )
    assert response.status_code == 422
