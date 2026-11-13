"""IAM 协议、会话与失效路径的确定性验证。"""

import asyncio
import json
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import HTTPException
from yuxi.services import iam_service as iam


pytestmark = [pytest.mark.asyncio, pytest.mark.unit]


@pytest.fixture
def config():
    return iam.IAMConfig(
        enabled=True,
        base_url="https://identity.example/iam/v1",
        public_web_url="https://identity.example",
        app_url="https://app.example/work",
        callback_url="https://app.example/work/sso/callback",
        issuer_url="https://identity.example",
        client_id="work",
        client_secret="test-client-secret",
        service_key="test-service-key",
        tenant_id="11111111-1111-4111-8111-111111111111",
        tenant_code="example",
        subsystem_code="1014",
    )


@pytest.fixture
def context(config):
    return {
        "user_id": "22222222-2222-4222-8222-222222222222",
        "tenant_id": config.tenant_id,
        "emp_id": "employee-1",
        "emp_name": "测试员工",
        "user_status": 1,
        "plat_admin": 0,
        "plat_tenant_admin": 0,
    }


class MemoryRedis:
    """仅实现本服务使用的 Redis 原子操作和互斥锁。"""

    def __init__(self):
        self.values = {}
        self.locks = {}

    async def get(self, key):
        return self.values.get(key)

    async def getdel(self, key):
        return self.values.pop(key, None)

    async def set(self, key, value, *, ex, nx=False, xx=False):
        if (nx and key in self.values) or (xx and key not in self.values):
            return False
        self.values[key] = value
        return True

    async def delete(self, key):
        return self.values.pop(key, None) is not None

    async def ttl(self, key):
        return 600 if key in self.values else -2

    @asynccontextmanager
    async def lock(self, key, **options):
        async with self.locks.setdefault(key, asyncio.Lock()):
            yield


@pytest.fixture
def redis(monkeypatch):
    result = MemoryRedis()
    monkeypatch.setattr(iam, "get_async_redis_client", AsyncMock(return_value=result))
    return result


@pytest.mark.parametrize("flags,role", [((0, 0), "user"), ((0, 1), "admin"), ((1, 0), "superadmin")])
async def test_roles_follow_iam_flags(config, context, flags, role):
    context.update(plat_admin=flags[0], plat_tenant_admin=flags[1])
    assert iam.validate_identity(context, config).role == role


async def test_directory_identity_accepts_nullable_employee_name(config, context):
    context["emp_name"] = None
    identity = iam.validate_identity(context, config)
    assert identity.emp_name is None
    assert (identity.emp_name or identity.emp_id) == "employee-1"


@pytest.mark.parametrize(
    "field,value,status",
    [
        ("tenant_id", "33333333-3333-4333-8333-333333333333", 403),
        ("user_status", 0, 401),
        ("plat_admin", 2, 503),
        ("user_id", "not-a-uuid", 503),
    ],
)
async def test_identity_rejects_invalid_authority(config, context, field, value, status):
    context[field] = value
    with pytest.raises(HTTPException) as error:
        iam.validate_identity(context, config)
    assert error.value.status_code == status


@pytest.mark.parametrize("redirect", ["https://elsewhere.example", "//elsewhere.example", "/\\elsewhere.example"])
async def test_login_rejects_external_redirect(config, redis, redirect):
    with pytest.raises(HTTPException) as error:
        await iam.create_login_state(config, redirect)
    assert error.value.status_code == 400
    assert redis.values == {}


async def test_login_binds_state_and_stores_actual_tokens_only_on_server(config, context, redis, monkeypatch):
    state, url = await iam.create_login_state(config, "/enterprise?page=organization")
    query = parse_qs(urlsplit(url).query)
    assert query["state"] == [state]
    assert parse_qs(urlsplit(query["ReturnURL"][0]).query)["state"] == [state]
    request = AsyncMock(
        side_effect=[
            dict(context, access_token="access-secret", refresh_token="refresh-secret", expires_in=1800),
            {"allowed": True},
        ]
    )
    monkeypatch.setattr(iam, "iam_request", request)
    session_id, redirect = await iam.complete_login(config, "one-time-code", state, state)
    assert redirect == "/enterprise?page=organization"
    stored = json.loads(redis.values["iam:session:" + session_id])
    assert stored["access_token"] == "access-secret"
    assert stored["refresh_token"] == "refresh-secret"
    assert request.await_args_list[0].kwargs["form"]["state"] == state
    with pytest.raises(HTTPException) as error:
        await iam.complete_login(config, "one-time-code", state, state)
    assert error.value.status_code == 400
    assert request.await_count == 2


@pytest.mark.parametrize("state,browser", [("", ""), ("a", "b"), ("a", "")])
async def test_callback_rejects_unbound_browser_without_exchanging_code(config, redis, monkeypatch, state, browser):
    request = AsyncMock()
    monkeypatch.setattr(iam, "iam_request", request)
    with pytest.raises(HTTPException):
        await iam.complete_login(config, "code", state, browser)
    request.assert_not_awaited()


async def test_each_business_request_introspects_and_checks_admission(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="a", refresh_token="r", expires_in=1800), config)
    redis.values["iam:session:sid"] = session.to_redis_json()
    request = AsyncMock(side_effect=[dict(context, active=True), {"allowed": True}, dict(context, active=False)])
    monkeypatch.setattr(iam, "iam_request", request)
    assert (await iam.get_iam_identity("sid", config)).emp_id == context["emp_id"]
    with pytest.raises(HTTPException) as error:
        await iam.get_iam_identity("sid", config)
    assert error.value.status_code == 401
    assert request.await_args_list[1].args[2] == "/access/subsystems/1014"


async def test_admission_denial_preserves_session_without_global_logout(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="a", refresh_token="r", expires_in=1800), config)
    redis.values["iam:session:sid"] = session.to_redis_json()
    request = AsyncMock(side_effect=[dict(context, active=True), {"allowed": False}])
    monkeypatch.setattr(iam, "iam_request", request)
    with pytest.raises(HTTPException) as error:
        await iam.get_iam_identity("sid", config)
    assert error.value.status_code == 403
    assert "iam:session:sid" in redis.values
    assert all(call.args[2] != "/oauth2/revoke" for call in request.await_args_list)


async def test_parallel_expiry_rotates_refresh_once(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(
        dict(context, access_token="old", refresh_token="old-refresh", expires_in=1), config
    )
    session.expires_at = time.time() - 1
    redis.values["iam:session:sid"] = session.to_redis_json()
    rotations = []

    async def request(settings, method, path, **kwargs):
        if path == "/oauth2/token":
            rotations.append(kwargs["form"])
            await asyncio.sleep(0)
            return dict(context, access_token="new", refresh_token="new-refresh", expires_in=1800)
        if path == "/oauth2/introspect":
            assert kwargs["form"]["token"] == "new"
            return dict(context, active=True)
        return {"allowed": True}

    monkeypatch.setattr(iam, "iam_request", request)
    await asyncio.gather(iam.get_iam_identity("sid", config), iam.get_iam_identity("sid", config))
    assert len(rotations) == 1
    assert json.loads(redis.values["iam:session:sid"])["refresh_token"] == "new-refresh"


async def test_uncertain_refresh_ends_local_session(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="old", refresh_token="r", expires_in=1), config)
    session.expires_at = time.time() - 1
    redis.values["iam:session:sid"] = session.to_redis_json()
    monkeypatch.setattr(iam, "iam_request", AsyncMock(side_effect=iam.iam_failure(503, "unavailable", "Unavailable")))
    with pytest.raises(HTTPException) as error:
        await iam.get_iam_identity("sid", config)
    assert error.value.status_code == 401
    assert "iam:session:sid" not in redis.values


async def test_explicit_service_outage_preserves_refresh_session(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="old", refresh_token="r", expires_in=1), config)
    session.expires_at = time.time() - 1
    redis.values["iam:session:sid"] = session.to_redis_json()
    monkeypatch.setattr(iam, "iam_request", AsyncMock(side_effect=iam.iam_failure(503, "iam_retryable", "Retry later")))
    with pytest.raises(HTTPException) as error:
        await iam.get_iam_identity("sid", config)
    assert error.value.status_code == 503
    assert "iam:session:sid" in redis.values


async def test_user_logout_revokes_all_before_removing_session(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="a", refresh_token="r", expires_in=1800), config)
    redis.values["iam:session:sid"] = session.to_redis_json()
    request = AsyncMock(return_value=None)
    monkeypatch.setattr(iam, "iam_request", request)
    await iam.logout_iam_session("sid", config)
    assert request.await_args.kwargs["form"] == {"token": "a", "revoke_all": "true"}
    assert "iam:session:sid" not in redis.values


async def test_oauth_and_directory_use_different_credentials(config, monkeypatch):
    captured = []

    def handler(request):
        captured.append(request)
        return httpx.Response(200, json={"code": 0, "data": {"active": False}})

    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        iam.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs)
    )
    await iam.iam_request(config, "POST", "/oauth2/introspect", form={"token": "test-token"})
    await iam.iam_request(config, "GET", "/tenants/tenant/users")
    assert captured[0].headers["authorization"].startswith("Basic ")
    assert "x-service-key" not in captured[0].headers
    assert captured[0].content == b"token=test-token"
    assert captured[1].headers["x-service-key"] == "test-service-key"
    assert "authorization" not in captured[1].headers


async def test_upstream_failure_does_not_echo_response_or_credentials(config, monkeypatch):
    def handler(request):
        return httpx.Response(401, text="private-token-and-service-secret")

    client_type = httpx.AsyncClient
    monkeypatch.setattr(
        iam.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs)
    )
    with pytest.raises(HTTPException) as error:
        await iam.iam_request(config, "POST", "/oauth2/token", form={"code": "private-code"})
    assert error.value.status_code == 503
    assert "private" not in str(error.value.detail)


@pytest.mark.parametrize("target", ["/enterprise", "/agent", "/auth/cli/authorize?user_code=ABCD-EFGH"])
async def test_all_entry_points_share_the_registered_callback(config, redis, target):
    state, location = await iam.create_login_state(config, target)
    query = parse_qs(urlsplit(location).query)
    callback = urlsplit(query["ReturnURL"][0])
    assert callback._replace(query="").geturl() == config.callback_url
    assert parse_qs(callback.query) == {"state": [state]}
    assert redis.values["iam:state:" + state] == target


async def test_device_key_tracks_the_original_iam_session(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="a", refresh_token="r", expires_in=1800), config)
    redis.values["iam:session:sid"] = session.to_redis_json()
    await iam.bind_iam_device_grant("device-hash", "sid")
    await iam.bind_iam_device_key("device-hash", "yxkey_device")
    assert await iam.get_iam_device_session("yxkey_device") == "sid"
    request = AsyncMock(side_effect=[dict(context, active=True), {"allowed": True}])
    monkeypatch.setattr(iam, "iam_request", request)
    assert (await iam.get_iam_identity(await iam.get_iam_device_session("yxkey_device"), config)).user_id
    await redis.delete("iam:session:sid")
    with pytest.raises(HTTPException) as error:
        await iam.get_iam_identity(await iam.get_iam_device_session("yxkey_device"), config)
    assert error.value.status_code == 401
    with pytest.raises(HTTPException):
        await iam.bind_iam_device_key("device-hash", "yxkey_device")


async def test_old_independent_keys_have_no_iam_session(redis):
    with pytest.raises(HTTPException) as error:
        await iam.get_iam_device_session("yxkey_legacy")
    assert error.value.status_code == 401
    assert error.value.detail["code"] == "iam_device_expired"


async def test_device_grant_cannot_be_rebound_to_another_session(redis):
    redis.values["iam:session:first"] = "first"
    redis.values["iam:session:second"] = "second"
    await iam.bind_iam_device_grant("device", "first")
    with pytest.raises(HTTPException) as error:
        await iam.bind_iam_device_grant("device", "second")
    assert error.value.status_code == 409
    assert redis.values["iam:device-grant:device"] == "first"


async def test_device_logout_rejects_mismatched_account(config, context, redis, monkeypatch):
    session = iam.session_from_tokens(dict(context, access_token="a", refresh_token="r", expires_in=1800), config)
    redis.values["iam:session:sid"] = session.to_redis_json()
    request = AsyncMock()
    monkeypatch.setattr(iam, "iam_request", request)
    with pytest.raises(HTTPException) as error:
        await iam.logout_iam_session("sid", config, expected_uid="iam_other_user")
    assert error.value.status_code == 401
    assert "iam:session:sid" in redis.values
    request.assert_not_awaited()
