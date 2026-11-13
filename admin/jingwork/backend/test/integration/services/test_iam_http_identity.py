"""在独立 PostgreSQL schema 和真实 Redis 中验证 IAM HTTP 认证。"""

import os
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from server.routers import auth_router, iam_router
from yuxi.services import auth_service
from server.utils import auth_middleware
from yuxi.services import iam_service as iam
from yuxi.storage.postgres.models_business import Base, Department, User
from yuxi.utils.auth_utils import AuthUtils


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_sandboxes():
    """本模块的资源清理由 environment 独占，作用域为随机 schema 与会话键。"""
    yield


@pytest_asyncio.fixture
async def environment(monkeypatch):
    postgres_url = os.environ.get("IAM_TEST_POSTGRES_URL")
    redis_url = os.environ.get("IAM_TEST_REDIS_URL")
    if not postgres_url or not redis_url:
        pytest.skip("IAM integration requires explicit isolated PostgreSQL and Redis URLs")
    schema = "iam_test_" + uuid.uuid4().hex
    admin_engine = create_async_engine(postgres_url)
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(postgres_url, connect_args={"server_settings": {"search_path": schema}})
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    redis = Redis.from_url(redis_url, decode_responses=True)
    config = iam.IAMConfig(
        enabled=True,
        base_url="https://identity.example/iam/v1",
        public_web_url="https://identity.example",
        app_url="https://app.example/work",
        callback_url="https://app.example/work/sso/callback",
        issuer_url="https://identity.example",
        client_id="work",
        client_secret="test-secret",
        service_key="test-key",
        tenant_id="11111111-1111-4111-8111-111111111111",
        tenant_code="example",
        subsystem_code="1014",
    )
    context = {
        "user_id": str(uuid.uuid4()),
        "tenant_id": config.tenant_id,
        "emp_id": "test-employee",
        "emp_name": "测试员工",
        "user_status": 1,
        "plat_admin": 0,
        "plat_tenant_admin": 0,
    }
    calls = []
    active = {"value": True}
    admission = {"allowed": True}

    async def request(settings, method, path, **kwargs):
        calls.append(path)
        if path == "/oauth2/token":
            return dict(context, access_token="server-access", refresh_token="server-refresh", expires_in=1800)
        if path == "/oauth2/introspect":
            return dict(context, active=active["value"])
        if path.startswith("/access/"):
            return admission
        return {"items": [], "meta": {"page": 1, "size": 20, "total": 0}}

    monkeypatch.setattr(iam, "get_async_redis_client", AsyncMock(return_value=redis))
    monkeypatch.setattr(iam, "iam_request", request)
    monkeypatch.setattr(iam, "get_iam_config", lambda: config)
    monkeypatch.setattr(iam_router, "get_iam_config", lambda: config)
    monkeypatch.setattr(auth_middleware, "get_iam_config", lambda: config)
    monkeypatch.setattr(auth_router, "get_iam_config", lambda: config)
    monkeypatch.setattr(auth_service, "get_iam_config", lambda: config)
    app = FastAPI()
    app.include_router(iam_router.iam, prefix="/work/api")
    app.include_router(auth_router.auth, prefix="/work/api")
    app.add_api_route("/work/sso/callback", iam_router.iam_callback)

    async def database():
        async with factory() as session:
            yield session

    app.dependency_overrides[auth_middleware.get_db] = database

    @app.get("/work/check/admin")
    async def admin(user=Depends(auth_middleware.get_admin_user)):
        return {"uid": user.uid, "role": user.role}

    @app.post("/work/check/write")
    async def write(user=Depends(auth_middleware.get_required_user)):
        return {"uid": user.uid}

    app.dependency_overrides[auth_router.get_db] = database
    owned_keys = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://app.example") as client:
        try:
            yield SimpleNamespace(
                client=client,
                config=config,
                context=context,
                factory=factory,
                redis=redis,
                calls=calls,
                active=active,
                admission=admission,
                keys=owned_keys,
            )
        finally:
            for key in owned_keys:
                await redis.delete(key)
    await redis.aclose()
    await engine.dispose()
    async with admin_engine.begin() as connection:
        await connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    await admin_engine.dispose()


async def sign_in(environment):
    response = await environment.client.get("/work/api/auth/iam/login")
    assert response.status_code == 302
    assert "HttpOnly" in response.headers["set-cookie"] and "Secure" in response.headers["set-cookie"]
    state = parse_qs(urlsplit(response.headers["location"]).query)["state"][0]
    response = await environment.client.get("/work/sso/callback", params={"IAM_Code": "test-code", "state": state})
    assert response.status_code == 302
    assert "IAM_Code" not in response.headers["location"]
    assert "server-access" not in response.text and "server-refresh" not in response.text
    sid = environment.client.cookies.get("jingwork_iam_session")
    assert sid
    environment.keys.append("iam:session:" + sid)
    return sid


async def test_cookie_login_role_changes_and_revocation(environment):
    sid = await sign_in(environment)
    response = await environment.client.get("/work/api/auth/iam/session")
    assert response.status_code == 200
    assert response.json()["access_token"] == "iam_cookie"
    assert response.json()["role"] == "user"
    assert (await environment.client.get("/work/api/auth/iam/directory/users")).status_code == 403
    environment.context["plat_tenant_admin"] = 1
    assert (await environment.client.get("/work/check/admin")).json()["role"] == "admin"
    async with environment.factory() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert len(users) == 1 and users[0].role == "admin"
    environment.active["value"] = False
    assert (await environment.client.get("/work/check/admin")).status_code == 401
    assert await environment.redis.get("iam:session:" + sid)


async def test_cookie_write_requires_matching_origin(environment):
    await sign_in(environment)
    assert (await environment.client.post("/work/check/write")).status_code == 403
    response = await environment.client.post("/work/check/write", headers={"Origin": "https://app.example"})
    assert response.status_code == 200


async def test_nullable_employee_name_uses_employee_id_for_display(environment):
    environment.context["emp_name"] = None
    await sign_in(environment)
    response = await environment.client.get("/work/api/auth/iam/session")
    assert response.status_code == 200
    assert response.json()["username"] == environment.context["emp_id"]


async def test_callback_state_mismatch_never_exchanges_code(environment):
    response = await environment.client.get("/work/sso/callback?IAM_Code=code&state=wrong")
    assert response.status_code == 302 and "iam_error" in response.headers["location"]
    assert "/oauth2/token" not in environment.calls
    assert not environment.client.cookies.get("jingwork_iam_session")


@pytest.mark.parametrize("valid_cookie", [False, True])
async def test_legacy_maintenance_jwt_is_rejected_even_with_cookie(environment, valid_cookie):
    async with environment.factory() as session:
        department = Department(name="维护部门")
        session.add(department)
        await session.flush()
        user = User(
            uid="maintenance",
            username="维护管理员",
            role="superadmin",
            department_id=department.id,
            password_hash=AuthUtils.hash_password("TestPassword123"),
        )
        session.add(user)
        await session.commit()
        token = AuthUtils.create_access_token({"sub": str(user.id)})
    if valid_cookie:
        await sign_in(environment)
    else:
        environment.client.cookies.set("jingwork_iam_session", "stale-session", domain="app.example", path="/work/")
    previous_calls = len(environment.calls)
    response = await environment.client.get("/work/check/admin", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "iam_login_required"
    assert len(environment.calls) == previous_calls


async def test_concurrent_first_identity_creates_one_local_account(environment):
    import asyncio

    identity = iam.validate_identity(environment.context, environment.config)

    async def synchronize():
        async with environment.factory() as session:
            return (await iam.synchronize_iam_user(identity, session, environment.config)).id

    first, second = await asyncio.gather(synchronize(), synchronize())
    assert first == second
    async with environment.factory() as session:
        assert len((await session.execute(select(User))).scalars().all()) == 1


async def test_real_redis_lock_serializes_refresh(environment, monkeypatch):
    import asyncio
    import time

    sid = "refresh-test-" + uuid.uuid4().hex
    key = "iam:session:" + sid
    session = iam.session_from_tokens(
        dict(environment.context, access_token="old", refresh_token="old-refresh", expires_in=1),
        environment.config,
    )
    session.expires_at = time.time() - 1
    await environment.redis.set(key, session.to_redis_json(), ex=600)
    environment.keys.append(key)
    started = asyncio.Event()
    second_lock_attempt = asyncio.Event()
    release = asyncio.Event()
    original_lock = environment.redis.lock
    lock_count = 0
    rotations = 0

    def observed_lock(name, **kwargs):
        nonlocal lock_count
        lock_count += 1
        if lock_count == 2:
            second_lock_attempt.set()
        return original_lock(name, **kwargs)

    async def request(settings, method, path, **kwargs):
        nonlocal rotations
        if path == "/oauth2/token":
            rotations += 1
            started.set()
            await release.wait()
            return dict(environment.context, access_token="new", refresh_token="new-refresh", expires_in=1800)
        if path == "/oauth2/introspect":
            assert kwargs["form"]["token"] == "new"
            return dict(environment.context, active=True)
        return {"allowed": True}

    monkeypatch.setattr(environment.redis, "lock", observed_lock)
    monkeypatch.setattr(iam, "iam_request", request)
    first = asyncio.create_task(iam.get_iam_identity(sid, environment.config))
    second = None
    try:
        await asyncio.wait_for(started.wait(), timeout=10)
        second = asyncio.create_task(iam.get_iam_identity(sid, environment.config))
        await asyncio.wait_for(second_lock_attempt.wait(), timeout=10)
        assert rotations == 1
        release.set()
        await asyncio.gather(first, second)
        assert rotations == 1
    finally:
        release.set()
        pending = [task for task in (first, second) if task is not None]
        for task in pending:
            if not task.done():
                task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/register", {"uid": "new_user", "password": "TestPassword123"}),
        ("/initialize", {"uid": "new_admin", "username": "新管理员", "password": "TestPassword123"}),
        ("/oidc/exchange-code", {"code": "legacy-code"}),
    ],
)
async def test_legacy_authentication_endpoints_are_closed(environment, path, payload):
    response = await environment.client.post("/work/api/auth" + path, json=payload)
    assert response.status_code == 403
    async with environment.factory() as session:
        assert (await session.execute(select(User))).scalars().all() == []
    assert "/oauth2/token" not in environment.calls


async def test_legacy_password_and_oidc_login_are_closed(environment):
    response = await environment.client.post(
        "/work/api/auth/token", data={"username": "maintenance", "password": "TestPassword123"}
    )
    assert response.status_code == 403
    assert (await environment.client.get("/work/api/auth/oidc/login-url")).status_code == 403
    assert (await environment.client.get("/work/api/auth/oidc/config")).json()["enabled"] is False
    assert (await environment.client.get("/work/api/auth/check-first-run")).json() == {"first_run": False}


@pytest.mark.parametrize("credential_status", ["valid", "revoked", "expired"])
async def test_device_authorization_is_replayable_and_follows_platform_logout(environment, credential_status):
    import hashlib
    from yuxi.storage.postgres.models_business import APIKey

    sid = await sign_in(environment)
    created = await environment.client.post("/work/api/auth/cli/sessions", json={"key_name": "JingWork"})
    assert created.status_code == 200
    attempt = created.json()
    assert attempt["verification_uri"] == "https://app.example/work/auth/cli/authorize"
    approval = await environment.client.post(
        "/work/api/auth/cli/sessions/" + attempt["user_code"] + "/approve",
        headers={"Origin": "https://app.example"},
    )
    assert approval.status_code == 200
    grant_hash = hashlib.sha256(attempt["device_code"].encode()).hexdigest()
    environment.keys.append("iam:device-grant:" + grant_hash)
    token = await environment.client.post(
        "/work/api/auth/cli/sessions/token", json={"device_code": attempt["device_code"]}
    )
    assert token.status_code == 200
    secret = token.json()["secret"]
    key_hash = hashlib.sha256(secret.encode()).hexdigest()
    environment.keys.append("iam:device-key:" + key_hash)
    replay = await environment.client.post(
        "/work/api/auth/cli/sessions/token", json={"device_code": attempt["device_code"]}
    )
    assert replay.json()["secret"] == secret
    async with environment.factory() as session:
        keys = (await session.execute(select(APIKey))).scalars().all()
        assert len(keys) == 1 and keys[0].expires_at is not None
    environment.client.cookies.clear()
    before = environment.calls.count("/oauth2/introspect")
    response = await environment.client.get("/work/api/auth/me", headers={"Authorization": "Bearer " + secret})
    assert response.status_code == 200
    assert environment.calls.count("/oauth2/introspect") == before + 1
    if credential_status != "valid":
        from datetime import timedelta
        from yuxi.utils.datetime_utils import utc_now_naive

        async with environment.factory() as session:
            key = (await session.execute(select(APIKey))).scalar_one()
            if credential_status == "revoked":
                key.revoked_at = utc_now_naive()
            else:
                key.expires_at = utc_now_naive() - timedelta(seconds=1)
            await session.commit()
        response = await environment.client.post(
            "/work/api/auth/iam/logout", headers={"Authorization": "Bearer " + secret}
        )
        assert response.status_code == 401
        assert "/oauth2/revoke" not in environment.calls
        assert await environment.redis.get("iam:session:" + sid)
        return
    response = await environment.client.post("/work/api/auth/iam/logout", headers={"Authorization": "Bearer " + secret})
    assert response.status_code == 200
    assert await environment.redis.get("iam:session:" + sid) is None
    response = await environment.client.get("/work/api/auth/me", headers={"Authorization": "Bearer " + secret})
    assert response.status_code == 401
    replay = await environment.client.post(
        "/work/api/auth/cli/sessions/token", json={"device_code": attempt["device_code"]}
    )
    assert replay.status_code == 401


async def test_callback_admission_denial_displays_permission_error_without_global_logout(environment):
    environment.admission["allowed"] = False
    response = await environment.client.get("/work/api/auth/iam/login")
    state = parse_qs(urlsplit(response.headers["location"]).query)["state"][0]
    response = await environment.client.get("/work/sso/callback", params={"IAM_Code": "code", "state": state})
    assert response.status_code == 302
    assert response.headers["location"] == "https://app.example/work/forbidden?iam_denied=1"
    assert "/oauth2/revoke" not in environment.calls
    assert not environment.client.cookies.get("jingwork_iam_session")
