"""真实 HTTP 验证个人知识库的持久化与账号隔离。"""

import uuid

import pytest

from test.integration.api.test_knowledge_router import (
    _create_test_department,
    _create_test_user,
    _delete_department_with_admin,
    _delete_user_by_id,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def test_personal_knowledge_private_creation_and_account_isolation(test_client, admin_headers):
    """普通账号创建私有库，管理后台可见，第二账号无法访问。"""
    department = await _create_test_department(test_client, admin_headers)
    users, kb_ids = [], []
    try:
        for _ in range(2):
            users.append(await _create_test_user(test_client, admin_headers, department["id"]))
        a, b = users
        models = await test_client.get(
            "/api/system/model-providers/models/v2?model_type=embedding", headers=a["headers"]
        )
        assert models.status_code == 200
        specs = [m["spec"] for p in models.json()["data"].values() for m in p["models"]]
        assert specs, "测试后台需要至少一个向量模型"
        body = {
            "database_name": f"pytest_personal_{uuid.uuid4().hex[:8]}",
            "description": "isolation test",
            "embedding_model_spec": specs[0],
        }
        spoofed = await test_client.post(
            "/api/knowledge/personal/databases",
            json={**body, "created_by": b["user"]["uid"], "share_config": {"access_level": "global"}},
            headers=a["headers"],
        )
        assert spoofed.status_code == 422
        created = await test_client.post("/api/knowledge/personal/databases", json=body, headers=a["headers"])
        assert created.status_code == 200, created.text
        kb = created.json()
        kb_id = kb["kb_id"]
        kb_ids.append(kb_id)
        assert kb["created_by"] == a["user"]["uid"]
        assert kb["share_config"]["read_scope"]["access_level"] == "user"
        assert kb["share_config"]["read_scope"]["user_uids"] == [a["user"]["uid"]]
        for account, visible in [(a, True), (b, False)]:
            listed = await test_client.get("/api/knowledge/personal/databases", headers=account["headers"])
            assert listed.status_code == 200
            assert (kb_id in {db["kb_id"] for db in listed.json()["databases"]}) is visible
        management = await test_client.get("/api/knowledge/databases", headers=admin_headers)
        persisted = next(db for db in management.json()["databases"] if db["kb_id"] == kb_id)
        assert persisted["name"] == body["database_name"]
        assert persisted["created_by"] == a["user"]["uid"]
        documents_path = f"/api/knowledge/databases/{kb_id}/documents"
        assert (await test_client.get(documents_path, headers=a["headers"])).status_code == 200
        assert (await test_client.get(documents_path, headers=b["headers"])).status_code == 403
        assert (await test_client.delete(f"/api/knowledge/databases/{kb_id}", headers=b["headers"])).status_code == 403
        for path, account in [(f"/api/knowledge/files/upload?kb_id={kb_id}", b), ("/api/knowledge/files/upload", a)]:
            denied = await test_client.post(
                path, files={"file": ("denied.txt", b"private", "text/plain")}, headers=account["headers"]
            )
            assert denied.status_code == 403
        uploaded = await test_client.post(
            f"/api/knowledge/files/upload?kb_id={kb_id}",
            files={"file": ("personal.txt", b"personal durable document", "text/plain")},
            headers=a["headers"],
        )
        assert uploaded.status_code == 200, uploaded.text
        upload = uploaded.json()
        source = upload["file_path"]
        added = await test_client.post(
            documents_path + "/add",
            headers=a["headers"],
            json={
                "items": [source],
                "params": {"content_hashes": {source: upload["content_hash"]}, "file_sizes": {source: upload["size"]}},
            },
        )
        assert added.status_code == 200, added.text
        docs = await test_client.get(documents_path, headers=a["headers"])
        assert any(doc["filename"] == "personal.txt" for doc in docs.json()["items"])
    finally:
        for kb_id in kb_ids:
            response = await test_client.delete(f"/api/knowledge/databases/{kb_id}", headers=admin_headers)
            assert response.status_code in (200, 404), response.text
        for user in users:
            await _delete_user_by_id(test_client, admin_headers, user["user"]["id"])
        await _delete_department_with_admin(test_client, admin_headers, department)
