"""桌面只获得所选且获授权的自有模型凭据。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from server.routers.model_provider_router import model_providers
from server.utils.auth_middleware import get_db, get_required_user
from yuxi.services import desktop_model_service as service


@pytest.fixture
def setup(monkeypatch):
    provider = SimpleNamespace(
        is_enabled=True,
        provider_type="openai",
        include_user_uid=False,
        enabled_models=[{"id": "local/model", "base_url_override": "http://model.internal/v1"}],
        api_key="company-key",
        api_key_env=None,
        base_url="http://other.internal/v1",
        headers_json={"x-company": "example"},
    )
    monkeypatch.setattr(
        service,
        "effective_policy",
        AsyncMock(
            return_value={
                "managed": True,
                "default_model": "company:local/model",
                "allowed_models": ["company:local/model"],
            }
        ),
    )
    monkeypatch.setattr(service, "get_model_provider_by_id", AsyncMock(return_value=provider))
    return provider


@pytest.mark.asyncio
async def test_connection_preserves_config_without_model_network_call(setup):
    assert await service.desktop_model_config(None, "member", "company:local/model") == {
        "mode": "direct",
        "spec": "company:local/model",
        "model_id": "local/model",
        "provider_type": "openai",
        "base_url": "http://model.internal/v1",
        "api_key": "company-key",
        "headers": {"x-company": "example"},
        "extra_body": {},
    }
    setup.api_key = ""
    assert (await service.desktop_model_config(None, "member", "company:local/model"))["api_key"] == ""


@pytest.mark.asyncio
async def test_denied_model_never_reads_credentials(setup):
    with pytest.raises(HTTPException) as failure:
        await service.desktop_model_config(None, "member", "other:secret")
    assert failure.value.status_code == 403
    service.get_model_provider_by_id.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["disabled", "removed", "embedding", "protocol"])
async def test_unavailable_model_is_rejected(setup, change):
    if change == "disabled":
        setup.is_enabled = False
    elif change == "removed":
        setup.enabled_models = []
    elif change == "embedding":
        setup.enabled_models[0]["type"] = "embedding"
    else:
        setup.provider_type = "gemini"
    with pytest.raises(HTTPException) as failure:
        await service.desktop_model_config(None, "member", "company:local/model")
    assert failure.value.status_code in {404, 422}


@pytest.mark.asyncio
async def test_signed_connection_returns_no_secrets(setup):
    setup.include_user_uid = True
    assert await service.desktop_model_config(None, "member", "company:local/model") == {
        "mode": "gateway",
        "spec": "company:local/model",
    }


@pytest.mark.asyncio
async def test_relay_never_distributes_member_or_placeholder_credentials(setup, monkeypatch):
    monkeypatch.setattr(service, "effective_policy", AsyncMock(return_value={"managed": False}))
    assert await service.desktop_model_config(None, "member", "keenlight:local/model") == {
        "mode": "gateway",
        "spec": "keenlight:local/model",
    }


def test_http_route_requires_login_and_disables_caching(setup):
    app = FastAPI()
    app.include_router(model_providers, prefix="/api")
    app.dependency_overrides[get_db] = lambda: None
    with TestClient(app) as client:
        url = "/api/system/model-providers/desktop-model?spec=company:local/model"
        assert client.get(url).status_code in {401, 403}
        app.dependency_overrides[get_required_user] = lambda: SimpleNamespace(uid="member")
        response = client.get(url)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["api_key"] == "company-key"
        assert client.get(url.replace("company:local/model", "other:secret")).status_code == 403
