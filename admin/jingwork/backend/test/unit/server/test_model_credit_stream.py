"""桌面网关逐块传输工具和真实用量，不重复累计 Token。"""

import json
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessageChunk

from server.routers import model_credit_router as router


@pytest.mark.asyncio
async def test_stream_forwards_content_and_reports_usage_only_once(monkeypatch):
    """最终用量只出现一次，未知用量不伪造零消耗。"""

    class Model:
        async def astream(self, messages):
            yield AIMessageChunk(content="你")
            yield AIMessageChunk(
                content="好",
                usage_metadata={
                    "input_tokens": 12,
                    "output_tokens": 2,
                    "total_tokens": 14,
                    "input_token_details": {"cache_read": 4},
                },
            )

    async def policy(uid, db):
        return {"managed": True, "default_model": "test:fake"}

    monkeypatch.setattr(router, "effective_policy", policy)
    monkeypatch.setattr(router, "load_chat_model", lambda *args, **kwargs: Model())
    response = await router.desktop_completion(
        {"stream": True, "messages": [{"role": "user", "content": "hello"}]},
        user=SimpleNamespace(uid="test-user"),
        db=None,
    )
    output = "".join([chunk async for chunk in response.body_iterator])
    items = [
        json.loads(line[6:]) for line in output.splitlines() if line.startswith("data: ") and line != "data: [DONE]"
    ]
    assert "".join(item["choices"][0]["delta"].get("content", "") for item in items) == "你好"
    usages = [item["usage"] for item in items if item.get("usage") is not None]
    assert usages == [
        {"prompt_tokens": 12, "completion_tokens": 2, "total_tokens": 14, "prompt_tokens_details": {"cached_tokens": 4}}
    ]
    assert output.endswith("data: [DONE]\n\n")


@pytest.mark.asyncio
async def test_managed_model_nested_stream_is_not_emitted_twice(monkeypatch):
    """后台包装模型只产生一组可见流事件。"""
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from yuxi.models.managed import ManagedChatModel
    from yuxi.models import managed

    async def prepare(self, messages, kwargs):
        return None, FakeListChatModel(responses=["你好"], sleep=0)

    async def settle(call_id, usage):
        return None

    monkeypatch.setattr(ManagedChatModel, "_prepare", prepare)
    monkeypatch.setattr(managed, "settle_call", settle)
    model = ManagedChatModel(model_spec="test:fake", uid="test-user")
    fragments = [
        event["data"]["chunk"].content
        async for event in model.astream_events("hello", version="v2")
        if event["event"] == "on_chat_model_stream"
    ]
    assert "".join(fragments) == "你好"
    assert len(fragments) == 2


@pytest.mark.asyncio
async def test_explicit_model_is_preserved_and_unauthorized_model_is_rejected(monkeypatch):
    from fastapi import HTTPException
    from langchain_core.messages import AIMessage

    seen = []

    class Model:
        async def ainvoke(self, messages):
            return AIMessage(content="企业测试成功")

    async def policy(uid, db):
        return {"managed": True, "default_model": "test:default", "allowed_models": ["test:default", "test:selected"]}

    def load(spec, **kwargs):
        seen.append(spec)
        return Model()

    monkeypatch.setattr(router, "effective_policy", policy)
    monkeypatch.setattr(router, "load_chat_model", load)
    result = await router.desktop_completion(
        {"model": "test:selected", "messages": [{"role": "user", "content": "hello"}]},
        SimpleNamespace(uid="user"),
        None,
    )
    assert result["model"] == "test:selected"
    assert seen == ["test:selected"]
    with pytest.raises(HTTPException) as error:
        await router.desktop_completion({"model": "test:denied", "messages": []}, SimpleNamespace(uid="user"), None)
    assert error.value.status_code == 403
    assert seen == ["test:selected"]


@pytest.mark.asyncio
async def test_provider_permission_error_is_not_a_retryable_gateway_500(monkeypatch):
    import httpx
    from fastapi import HTTPException
    from openai import PermissionDeniedError

    class Denied:
        async def ainvoke(self, messages):
            raise PermissionDeniedError(
                "AccessDenied.Unpurchased",
                response=httpx.Response(403, request=httpx.Request("POST", "https://example.com")),
                body={},
            )

    async def policy(uid, db):
        return {"managed": True, "default_model": "test:model"}

    monkeypatch.setattr(router, "effective_policy", policy)
    monkeypatch.setattr(router, "load_chat_model", lambda *args, **kwargs: Denied())
    with pytest.raises(HTTPException) as error:
        await router.desktop_completion({"model": "test:model", "messages": []}, SimpleNamespace(uid="user"), None)
    assert error.value.status_code == 403
    assert "套餐" in error.value.detail
