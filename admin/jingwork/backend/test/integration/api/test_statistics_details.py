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


async def test_member_totals_daily_counts_and_real_tokens(test_client, accounts):  # noqa: F811
    """独立调用聚合保留跨天会话、账号归属和真实用量缺失。"""
    from datetime import datetime
    from uuid import uuid4

    from sqlalchemy import delete
    from yuxi.storage.postgres.models_business import DesktopConversationEvent, ModelCreditCall

    sessions, users, headers = accounts
    ids = [str(uuid4()) for _ in range(5)]
    try:
        async with sessions() as db:
            admin = await db.get(type(users[0]), users[0].id)
            admin.role = "superadmin"
            for index, (user, kind, timestamp) in enumerate(
                [
                    (1, "user_message", datetime(2026, 10, 1, 15, 59, 59)),
                    (1, "assistant_message", datetime(2026, 10, 1, 15, 59, 59)),
                    (1, "user_message", datetime(2026, 10, 1, 16)),
                    (2, "user_message", datetime(2026, 10, 1, 16)),
                ]
            ):
                db.add(
                    DesktopConversationEvent(
                        user_id=users[user].id,
                        event_id=str(index),
                        thread_id="same",
                        device_id="test",
                        agent_id="expert",
                        agent_name="测试",
                        event_type=kind,
                        content="测试",
                        timestamp=timestamp,
                    )
                )
            for call_id, user, timestamp, usage in zip(
                ids,
                [1, 1, 1, 2, 1],
                [
                    datetime(2026, 10, 1, 15),
                    datetime(2026, 10, 1, 16),
                    datetime(2026, 10, 2),
                    datetime(2026, 10, 1, 16),
                    datetime(2026, 9, 1),
                ],
                [
                    {"input_tokens": 100, "output_tokens": 20, "input_token_details": {"cache_read": 80}},
                    {"input_tokens": 200, "output_tokens": 30},
                    None,
                    {"input_tokens": 5, "output_tokens": 6},
                    {"input_tokens": 10, "output_tokens": 1},
                ],
                strict=True,
            ):
                db.add(
                    ModelCreditCall(
                        id=call_id,
                        uid=users[user].uid,
                        period="2026-10",
                        model_spec="test:fake",
                        price={},
                        reservation=0,
                        usage=usage,
                        created_at=timestamp,
                        status="usage_recorded" if usage else "usage_unknown",
                    )
                )
            await db.commit()
        params = {"start": "2026-10-02", "end": "2026-10-02", "search": users[1].uid}
        response = await test_client.get("/api/dashboard/statistics-details", headers=headers[0], params=params)
        assert response.status_code == 200, response.text
        row = response.json()["items"][0]
        assert (row["total_questions"], row["questions"], row["total_sessions"], row["sessions"]) == (2, 1, 1, 1)
        assert (row["input_tokens"], row["output_tokens"], row["tokens"], row["total_tokens"]) == (200, 30, 230, 361)
        assert row["model_calls"] == 2
        assert row["missing_usage_calls"] == 1
        response = await test_client.get(
            "/api/dashboard/statistics-details",
            headers=headers[0],
            params={
                "start": "2026-10-01",
                "end": "2026-10-02",
                "mode": "daily",
                "uid": users[1].uid,
            },
        )
        assert response.status_code == 200, response.text
        days = response.json()["items"]
        assert [row["date"] for row in days] == ["2026-10-01", "2026-10-02"]
        assert [row["questions"] for row in days] == [1, 1]
        assert [row["sessions"] for row in days] == [1, 1]
        assert [row["tokens"] for row in days] == [120, 230]
        assert [row["missing_usage_calls"] for row in days] == [0, 1]
        response = await test_client.get(
            "/api/dashboard/statistics-details",
            headers=headers[0],
            params={
                "start": "2026-10-03",
                "end": "2026-10-03",
                "mode": "daily",
                "uid": users[1].uid,
            },
        )
        assert response.json()["items"][0]["questions"] == 0
        assert response.json()["items"][0]["tokens"] is None
        response = await test_client.get(
            "/api/dashboard/statistics-details",
            headers=headers[0],
            params={
                "start": "2026-10-01",
                "end": "2026-10-02",
                "mode": "daily",
            },
        )
        assert response.status_code == 422
    finally:
        async with sessions() as db:
            await db.execute(delete(ModelCreditCall).where(ModelCreditCall.id.in_(ids)))
            await db.commit()
