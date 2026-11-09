"""真实 HTTP 证明额度配置权限和调用账本账号隔离。"""

from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from test.integration.api.test_knowledge_router import (
    _create_test_department,
    _create_test_user,
    _delete_department_with_admin,
    _delete_user_by_id,
)
from yuxi.storage.postgres.manager import pg_manager
from yuxi.storage.postgres.models_business import ManagedModelPolicy, ModelCreditCall, User
from yuxi.utils.auth_utils import AuthUtils


@pytest.mark.asyncio
async def test_credit_policy_permissions_and_call_ownership(test_client):
    """成员不能调整额度、读取别人的账本或读取中转站密钥。"""
    pg_manager.initialize()
    async with pg_manager.get_async_session_context() as db:
        administrator = await db.scalar(select(User).where(User.role == "superadmin", User.is_deleted == 0))
        assert administrator is not None
        token = AuthUtils.create_access_token({"sub": str(administrator.id)})
    headers = {"Authorization": "Bearer " + token}
    department = await _create_test_department(test_client, headers)
    users = []
    call_id = str(uuid4())
    try:
        for _ in range(2):
            users.append(await _create_test_user(test_client, headers, department["id"]))
        a, b = users
        admin = await test_client.get("/api/model-credits/admin", headers=headers)
        assert admin.status_code == 200, admin.text
        scope = "user:" + a["user"]["uid"]
        denied = await test_client.put(
            "/api/model-credits/policies/" + scope, json={"monthly_credits": 999999}, headers=a["headers"]
        )
        assert denied.status_code == 403
        saved = await test_client.put(
            "/api/model-credits/policies/" + scope, json={"monthly_credits": 1234}, headers=headers
        )
        assert saved.status_code == 200, saved.text
        me = await test_client.get("/api/model-credits/me", headers=a["headers"])
        assert me.status_code == 200, me.text
        assert me.json()["monthly_credits"] == "1234"
        async with pg_manager.get_async_session_context() as db:
            db.add(
                ModelCreditCall(
                    id=call_id,
                    uid=a["user"]["uid"],
                    period="2099-01",
                    model_spec="test:fake",
                    price={},
                    reservation=0,
                    status="pending_review",
                )
            )
            await db.commit()
        mine = await test_client.get("/api/model-credits/calls", headers=a["headers"])
        others = await test_client.get("/api/model-credits/calls?uid=" + a["user"]["uid"], headers=b["headers"])
        assert mine.status_code == others.status_code == 200
        assert call_id in {row["id"] for row in mine.json()["items"]}
        assert call_id not in {row["id"] for row in others.json()["items"]}
        for path in ("/api/model-credits/admin", "/api/model-credits/relay", "/api/model-credits/relay/users/1/keys"):
            assert (await test_client.get(path, headers=a["headers"])).status_code == 403
    finally:
        async with pg_manager.get_async_session_context() as db:
            await db.execute(delete(ModelCreditCall).where(ModelCreditCall.id == call_id))
            for account in users:
                await db.execute(
                    delete(ManagedModelPolicy).where(ManagedModelPolicy.scope == "user:" + account["user"]["uid"])
                )
            await db.commit()
        for account in users:
            await _delete_user_by_id(test_client, headers, account["user"]["id"])
        await _delete_department_with_admin(test_client, headers, department)
        await pg_manager.close()
