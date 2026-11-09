"""真实 HTTP 和 PostgreSQL 验证普通账号注册及权限边界。"""

import asyncio
import hashlib
import os
import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from yuxi.storage.postgres.models_business import OperationLog, User
from yuxi.storage.redis import create_async_redis_client
from yuxi.utils.auth_utils import AuthUtils

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest.mark.parametrize("prefix", ["reg_", "186", "中文账号_", "user+mail@_"])
async def test_registration_commit_login_conflict_and_privilege_boundary(test_client, prefix):
    uid = prefix + uuid.uuid4().hex[:12]
    password = "RegistrationPass12!"
    client_ip = "reg-test-" + uuid.uuid4().hex
    headers = {"X-Forwarded-For": client_ip}
    engine = create_async_engine(os.environ["POSTGRES_URL"])
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    key = "yuxi:registration:ip:" + hashlib.sha256(client_ip.encode()).hexdigest()
    try:
        response = await test_client.post(
            "/api/auth/register", json={"uid": uid, "password": password}, headers=headers
        )
        assert response.status_code == 201, response.text
        assert response.json() == {"uid": uid}
        async with session_factory() as db:
            user = (await db.execute(select(User).where(User.uid == uid))).scalar_one()
            assert user.role == "user" and user.department_id is not None
            assert AuthUtils.verify_password(user.password_hash, password)
        login = await test_client.post("/api/auth/token", data={"username": uid, "password": password}, headers=headers)
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        assert login.json()["role"] == "user"
        profile = await test_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert profile.status_code == 200 and profile.json()["uid"] == uid
        denied = await test_client.get("/api/auth/users", headers={"Authorization": f"Bearer {token}"})
        assert denied.status_code == 403
        duplicate = await test_client.post(
            "/api/auth/register", json={"uid": uid, "password": password}, headers=headers
        )
        assert duplicate.status_code == 409
        for invalid in (
            {"uid": "", "password": password},
            {"uid": uid + "x", "password": "short"},
            {"uid": uid + "x", "password": password, "role": "admin"},
            {"uid": uid + "x", "password": password, "department_id": 1},
        ):
            rejected = await test_client.post("/api/auth/register", json=invalid, headers=headers)
            assert rejected.status_code == 422
        concurrent_uid = uid + "c"
        results = await asyncio.gather(
            *[
                test_client.post(
                    "/api/auth/register", json={"uid": concurrent_uid, "password": password}, headers=headers
                )
                for _ in range(2)
            ]
        )
        assert sorted(item.status_code for item in results) == [201, 409]
        redis = await create_async_redis_client()
        try:
            await redis.set(key, "10", ex=3600)
            limited = await test_client.post(
                "/api/auth/register", json={"uid": uid + "z", "password": password}, headers=headers
            )
            assert limited.status_code == 429
            async with session_factory() as db:
                assert (await db.execute(select(User).where(User.uid == uid + "z"))).scalar_one_or_none() is None
        finally:
            await redis.delete(key)
            await redis.aclose()
    finally:
        async with session_factory() as db:
            ids = list((await db.execute(select(User.id).where(User.uid.in_([uid, uid + "c"])))).scalars())
            await db.execute(delete(OperationLog).where(OperationLog.user_id.in_(ids)))
            await db.execute(delete(User).where(User.id.in_(ids)))
            await db.commit()
        await engine.dispose()
