"""个人目录 HTTP 能力状态和上游失败回归。"""

import httpx
import pytest
from fastapi import FastAPI

from server.routers import octop_expert_router as router


@pytest.mark.asyncio
@pytest.mark.parametrize("configured", [None, "", "  "])
async def test_unconfigured_catalog_never_contacts_host(monkeypatch, configured):
    """未接入时不向宿主机其他应用转发令牌。"""
    if configured is None:
        monkeypatch.delenv("YUXI_DESKTOP_URL", raising=False)
    else:
        monkeypatch.setenv("YUXI_DESKTOP_URL", configured)
    client_class = httpx.AsyncClient

    def unexpected_client(**kwargs):
        raise AssertionError("未接入目录不能访问网络")

    monkeypatch.setattr(router.httpx, "AsyncClient", unexpected_client)
    app = FastAPI()
    app.include_router(router.octop_experts, prefix="/api")
    app.dependency_overrides[router.get_required_user] = lambda: object()
    async with client_class(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/octop/experts/personal/catalog", headers={"Authorization": "Bearer test"})
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["connected"] is False
    assert response.json()["experts"] == response.json()["teams"] == []
    assert "尚未接入" in response.json()["message"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 400, 401, 500])
async def test_configured_catalog_preserves_results_and_errors(monkeypatch, status):
    """配置的目录成功返回数据，失败保持显式错误。"""
    monkeypatch.setenv("YUXI_DESKTOP_URL", "http://desktop:8088/")
    payload = {"experts": [{"id": "one", "name": "专家"}], "teams": [], "connected": True}

    def upstream(request):
        assert str(request.url) == "http://desktop:8088/api/enterprise/conversation-logs/experts"
        assert request.headers["Authorization"] == "Bearer test"
        return httpx.Response(status, json=payload)

    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        router.httpx, "AsyncClient", lambda **kwargs: client_class(transport=httpx.MockTransport(upstream), **kwargs)
    )
    app = FastAPI()
    app.include_router(router.octop_experts, prefix="/api")
    app.dependency_overrides[router.get_required_user] = lambda: object()
    async with client_class(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/octop/experts/personal/catalog", headers={"Authorization": "Bearer test"})
    assert response.status_code == (200 if status == 200 else 502)
    assert response.json() == (payload if status == 200 else {"detail": "桌面专家查询失败"})


@pytest.mark.asyncio
async def test_unconfigured_catalog_requires_authenticated_user(monkeypatch):
    """未配置能力不能绕过登录依赖。"""
    monkeypatch.delenv("YUXI_DESKTOP_URL", raising=False)
    app = FastAPI()
    app.include_router(router.octop_experts, prefix="/api")
    app.dependency_overrides[router.get_db] = lambda: None
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for headers in ({}, {"Authorization": "invalid"}):
            response = await client.get("/api/octop/experts/personal/catalog", headers=headers)
            assert response.status_code == 401
