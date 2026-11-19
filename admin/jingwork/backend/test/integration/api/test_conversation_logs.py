"""真实 HTTP PostgreSQL 的持久日志、重试与隔离。"""

from test.integration.api.test_octop_experts import accounts  # noqa: F401


async def test_persistent_archive(test_client, accounts):  # noqa: F811
    _, users, headers = accounts
    root = "/api/system/conversation-logs"
    body = {
        "device_id": "test-device",
        "agent_id": "expert",
        "agent_name": "测试专家",
        "events": [
            {
                "event_id": "one",
                "thread_id": "chat",
                "event_type": "user_message",
                "content": "测试问题",
                "timestamp": "2026-10-06T10:00:00Z",
            }
        ],
    }
    response = await test_client.post(root + "/sync", headers=headers[1], json=body)
    assert response.status_code == 200, response.text
    assert response.json() == {"received": 1, "inserted": 1}
    response = await test_client.post(root + "/sync", headers=headers[1], json=body)
    assert response.json() == {"received": 1, "inserted": 0}
    response = await test_client.post(root + "/sync", headers=headers[1], json={**body, "uid": users[2].uid})
    assert response.status_code == 422
    for path in ("/catalog", "/sessions", "/overview"):
        assert (await test_client.get(root + path)).status_code == 401
        assert (await test_client.get(root + path, headers=headers[1])).status_code == 403
    response = await test_client.get(
        root + "/sessions", headers=headers[0], params={"uid": users[1].uid, "query": "问题"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    for filters, expected in [
        ({"department_id": users[1].department_id, "role": "user"}, 1),
        ({"department_id": users[1].department_id, "role": "admin"}, 0),
        ({"department_id": 2147483647}, 0),
    ]:
        response = await test_client.get(
            root + "/sessions", headers=headers[0], params={"uid": users[1].uid, "query": "问题", **filters}
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == expected
        assert len(response.json()["items"]) == expected
    for invalid in ({"role": "sales"}, {"department_id": 0}):
        response = await test_client.get(root + "/sessions", headers=headers[0], params=invalid)
        assert response.status_code == 422
    params = {"uid": users[1].uid, "device_id": "test-device", "agent_id": "expert", "thread_id": "chat"}
    response = await test_client.get(root + "/messages", headers=headers[0], params=params)
    assert response.json()["items"][0]["content"] == "测试问题"
    response = await test_client.get(root + "/messages", headers=headers[0], params={**params, "uid": users[2].uid})
    assert response.json()["total"] == 0


async def test_overview_counts_archived_messages_and_complete_session_keys(test_client, accounts):  # noqa: F811
    """概览与日志保持同源，重试和同名线程不会改变用户及来源归属。"""
    from datetime import datetime, timedelta, UTC

    _, _, headers = accounts
    root = "/api/system/conversation-logs"
    response = await test_client.get(root + "/overview", headers=headers[0])
    assert response.status_code == 200, response.text
    before = response.json()
    now = datetime.now(UTC)
    recent = now - timedelta(days=1)
    batches = [
        (1, "a", "expert", "same", "user_message", now),
        (1, "a", "expert", "same", "assistant_message", now),
        (2, "a", "expert", "same", "user_message", recent),
        (1, "b", "expert", "same", "user_message", now),
        (1, "a", "other", "same", "user_message", now),
        (0, "a", "expert", "old", "user_message", now - timedelta(days=40)),
        (0, "a", "expert", "future", "assistant_message", now + timedelta(days=1)),
    ]
    for index, (user, device, agent, thread, kind, timestamp) in enumerate(batches):
        body = {
            "device_id": device,
            "agent_id": agent,
            "agent_name": "统计测试专家",
            "events": [
                {
                    "event_id": str(index),
                    "thread_id": thread,
                    "event_type": kind,
                    "content": "统计测试",
                    "timestamp": timestamp.isoformat(),
                }
            ],
        }
        for expected in (1, 0):
            response = await test_client.post(root + "/sync", headers=headers[user], json=body)
            assert response.status_code == 200, response.text
            assert response.json()["inserted"] == expected

    response = await test_client.get(root + "/overview", headers=headers[0])
    assert response.status_code == 200, response.text
    after = response.json()
    for metric, increase in {
        "total_conversations": 6,
        "total_messages": 7,
        "total_questions": 5,
        "total_replies": 2,
        "synced_users": 3,
        "active_users_30d": 2,
    }.items():
        assert after[metric] == before[metric] + increase, metric
    assert after["total_users"] == before["total_users"]
    assert after["last_received_at"]
    assert after["generated_at"]
    response = await test_client.get(root + "/sessions", headers=headers[0], params={"limit": 1})
    assert response.json()["total"] == after["total_conversations"]


async def test_overview_empty_archive_deleted_accounts_and_shanghai_window(accounts):  # noqa: F811
    """独立临时表验证空日志、有效本地账号及北京时间窗口的精确边界。"""
    from datetime import datetime, timedelta

    from sqlalchemy import text
    from yuxi.repositories.desktop_conversation_repository import DesktopConversationRepository
    from yuxi.storage.postgres.models_business import DesktopConversationEvent, User

    sessions, _, _ = accounts
    now = datetime(2026, 11, 17, 16, 0)  # 上海 11 月 18 日零点。
    start = datetime(2026, 10, 19, 16, 0)
    async with sessions() as db:
        await db.execute(text("CREATE TEMP TABLE users (LIKE users INCLUDING DEFAULTS) ON COMMIT DROP"))
        await db.execute(
            text(
                "CREATE TEMP TABLE desktop_conversation_events "
                "(LIKE desktop_conversation_events INCLUDING DEFAULTS) ON COMMIT DROP"
            )
        )
        db.add_all(
            [
                User(
                    id=index,
                    uid=f"test-{index}",
                    username=f"测试{index}",
                    password_hash="unused",
                    is_deleted=int(index == 4),
                )
                for index in range(1, 5)
            ]
        )
        await db.flush()
        repo = DesktopConversationRepository(db)
        empty = await repo.overview(now=now)
        assert empty["total_users"] == 3
        for metric in (
            "total_conversations",
            "total_messages",
            "total_questions",
            "total_replies",
            "synced_users",
            "active_users_30d",
        ):
            assert empty[metric] == 0, metric
        assert empty["last_received_at"] is None

        db.add_all(
            [
                DesktopConversationEvent(
                    id=index,
                    user_id=index,
                    device_id="same",
                    agent_id="same",
                    thread_id="same",
                    agent_name="测试",
                    event_id=str(index),
                    event_type="user_message",
                    content="测试",
                    timestamp=timestamp,
                )
                for index, timestamp in enumerate(
                    [start - timedelta(microseconds=1), start, now, now + timedelta(microseconds=1)], 1
                )
            ]
        )
        await db.flush()
        result = await repo.overview(now=now)
        assert result["total_conversations"] == 4
        assert result["total_messages"] == 4
        assert result["synced_users"] == 4
        assert result["active_users_30d"] == 2
        assert result["total_users"] == 3


async def test_overview_agent_count_matches_current_administrator_visibility(test_client, accounts):  # noqa: F811
    """管理员只能统计管理入口可见的智能体，私有定义不计入其他管理员概览。"""
    import uuid

    from sqlalchemy import delete
    from yuxi.storage.postgres.models_business import Agent

    sessions, users, headers = accounts
    root = "/api/system/conversation-logs/overview"
    before = (await test_client.get(root, headers=headers[0])).json()["total_agents"]
    slug = "pytest-statistics-" + uuid.uuid4().hex
    try:
        async with sessions() as db:
            db.add(
                Agent(
                    slug=slug,
                    name="私有测试智能体",
                    backend_id="ChatbotAgent",
                    created_by=users[1].uid,
                    share_config={
                        "version": 2,
                        "read_scope": {
                            "access_level": "user",
                            "user_uids": [users[1].uid],
                            "department_ids": [],
                        },
                        "manage_scope": None,
                    },
                )
            )
            await db.commit()
        result = await test_client.get(root, headers=headers[0])
        assert result.status_code == 200, result.text
        assert result.json()["total_agents"] == before
    finally:
        async with sessions() as db:
            await db.execute(delete(Agent).where(Agent.slug == slug))
            await db.commit()
