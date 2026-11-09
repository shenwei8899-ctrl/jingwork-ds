"""隔离 PostgreSQL schema 和真实 HTTP 验证统一账号分享。"""

import asyncio
import hashlib
import os
import socket
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from server.routers.conversation_share_router import conversation_shares
from server.utils.auth_middleware import get_db
from yuxi.storage.postgres.manager import PostgresManager
from yuxi.storage.postgres.models_business import ConversationShare, User
from yuxi.utils.auth_utils import AuthUtils


@pytest.mark.asyncio
async def test_public_share_lifecycle():
    """认证、隔离、过期、撤销与 XSS 均从真实 HTTP 及数据库重新断言。"""
    schema = "pytest_shares_" + uuid4().hex
    admin = create_async_engine(os.environ["POSTGRES_URL"])
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(os.environ["POSTGRES_URL"], connect_args={"server_settings": {"search_path": schema}})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    server = None
    task = None
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE TABLE users (LIKE public.users INCLUDING ALL)"))
            await conn.execute(
                text("CREATE TABLE yuxi_schema_migrations (domain TEXT PRIMARY KEY, version INT, applied_at TIMESTAMP)")
            )
            await conn.execute(text("INSERT INTO yuxi_schema_migrations VALUES ('business', 11, now())"))
        owner = SimpleNamespace(async_engine=engine)
        await PostgresManager.upgrade_conversation_shares(owner)
        await PostgresManager.upgrade_conversation_shares(owner)
        async with sessions() as db:
            users = [
                User(id=100000 + i, uid=uuid4().hex, username=uuid4().hex, password_hash="test", role="user")
                for i in range(2)
            ]
            db.add_all(users)
            await db.commit()
            tokens = [AuthUtils.create_access_token({"sub": str(u.id)}) for u in users]

        async def test_db():
            async with sessions() as db:
                yield db

        app = FastAPI()
        app.include_router(conversation_shares, prefix="/api")
        app.dependency_overrides[get_db] = test_db
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off"))
        task = asyncio.create_task(server.serve(sockets=[sock]))
        for _ in range(100):
            if server.started:
                break
            await asyncio.sleep(0.02)
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}") as client:
            root = "/api/system/conversation-shares"
            a, b = [{"Authorization": "Bearer " + token} for token in tokens]
            payload = {
                "title": "<script>title</script>",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "**共享测试** <script>alert(1)</script> ![x](https://example.com/track.png)",
                    }
                ],
                "expires_days": 1,
            }
            assert (await client.post(root, json=payload)).status_code == 401
            assert (await client.get(root)).status_code == 401
            for bad in (
                {"messages": []},
                {"messages": [{"role": "tool", "content": "secret"}]},
                {"expires_days": 100},
                {"uid": "other"},
                {"messages": [{"role": "user", "content": "x" * 100001}]},
            ):
                assert (await client.post(root, headers=a, json={**payload, **bad})).status_code == 422
            created = await client.post(root, headers=a, json=payload)
            assert created.status_code == 201, created.text
            item = created.json()
            page = await client.get(item["public_path"])
            assert page.status_code == 200
            assert "<strong>共享测试</strong>" in page.text
            assert "<script>" not in page.text and "<img" not in page.text
            assert page.headers["cache-control"] == "no-store"
            assert "frame-ancestors 'none'" in page.headers["content-security-policy"]
            assert (await client.get(root, headers=b)).json()["items"] == []
            assert (await client.delete(root + "/" + item["share_id"], headers=b)).status_code == 404
            async with sessions() as db:
                row = await db.get(ConversationShare, item["share_id"])
                assert row.token_hash == hashlib.sha256(item["public_path"].split("/")[-1].encode()).hexdigest()
                await db.execute(
                    update(ConversationShare).where(ConversationShare.share_id == item["share_id"]).values(expires_at=1)
                )
                await db.commit()
            assert (await client.get(item["public_path"])).status_code == 404
            item = (await client.post(root, headers=a, json=payload)).json()
            assert (await client.delete(root + "/" + item["share_id"], headers=a)).status_code == 200
            assert (await client.get(item["public_path"])).status_code == 404
            async with sessions() as db:
                row = await db.get(ConversationShare, item["share_id"])
                assert row.messages == [] and row.revoked_at
            item = (await client.post(root, headers=a, json=payload)).json()
            async with sessions() as db:
                await db.execute(update(User).where(User.id == users[0].id).values(is_deleted=1))
                await db.commit()
            assert (await client.get(item["public_path"])).status_code == 404
    finally:
        if server:
            server.should_exit = True
        if task:
            await task
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()
