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
    for path in ("/catalog", "/sessions"):
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
