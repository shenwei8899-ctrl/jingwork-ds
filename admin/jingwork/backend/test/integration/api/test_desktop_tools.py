"""真实 HTTP 和 PostgreSQL 验证授权隔离和版本冲突。"""

import hashlib
import pytest
from sqlalchemy import delete, select
from test.integration.api.test_knowledge_router import (
    _create_test_department,
    _create_test_user,
    _delete_department_with_admin,
    _delete_user_by_id,
)
from yuxi.storage.postgres.manager import pg_manager
from yuxi.storage.postgres.models_business import ConfigOption, User
from yuxi.utils.auth_utils import AuthUtils


@pytest.mark.asyncio
async def test_desktop_tool_authorization_accounts(test_client):
    pg_manager.initialize()
    async with pg_manager.get_async_session_context() as db:
        administrator = await db.scalar(select(User).where(User.role == "superadmin", User.is_deleted == 0))
        headers = {"Authorization": "Bearer " + AuthUtils.create_access_token({"sub": str(administrator.id)})}
    department = await _create_test_department(test_client, headers)
    users = []
    try:
        for _ in range(2):
            users.append(await _create_test_user(test_client, headers, department["id"]))
        a, b = users
        base = "/api/system/desktop-tools"
        uid = a["user"]["uid"]
        assert (await test_client.get(base + "/members", headers=a["headers"])).status_code == 403
        assert (
            await test_client.put(
                base + "/members/" + uid,
                headers=a["headers"],
                json={"expected_revision": 0, "disabled_tools": ["execute"]},
            )
        ).status_code == 403
        saved = await test_client.put(
            base + "/members/" + uid, headers=headers, json={"expected_revision": 0, "disabled_tools": ["execute"]}
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["disabled_tools"] == ["execute"]
        assert (await test_client.get(base + "/me", headers=a["headers"])).json()["disabled_tools"] == ["execute"]
        assert (await test_client.get(base + "/me?uid=" + uid, headers=b["headers"])).json()["disabled_tools"] == []
        assert (
            await test_client.put(
                base + "/members/" + uid, headers=headers, json={"expected_revision": 0, "disabled_tools": []}
            )
        ).status_code == 409
        registered = await test_client.post(
            base + "/me/catalog", headers=a["headers"], json={"tools": [{"name": "plugin_demo", "label": "演示插件"}]}
        )
        assert registered.status_code == 200, registered.text
        assert registered.json()["disabled_tools"] == ["execute", "plugin_demo"]
        async with pg_manager.get_async_session_context() as db:
            value = await db.scalar(
                select(ConfigOption.value).where(
                    ConfigOption.key == "desktop_tools:" + hashlib.sha256(uid.encode()).hexdigest()
                )
            )
            assert (
                value["disabled_tools"] == ["execute", "plugin_demo"] and value["plugins"][0]["name"] == "plugin_demo"
            )
        allowed = await test_client.put(
            base + "/members/" + uid, headers=headers, json={"expected_revision": 2, "disabled_tools": []}
        )
        assert allowed.status_code == 200 and allowed.json()["disabled_tools"] == []
    finally:
        async with pg_manager.get_async_session_context() as db:
            for account in users:
                await db.execute(
                    delete(ConfigOption).where(
                        ConfigOption.key
                        == "desktop_tools:" + hashlib.sha256(account["user"]["uid"].encode()).hexdigest()
                    )
                )
            await db.commit()
        for account in users:
            await _delete_user_by_id(test_client, headers, account["user"]["id"])
        await _delete_department_with_admin(test_client, headers, department)
