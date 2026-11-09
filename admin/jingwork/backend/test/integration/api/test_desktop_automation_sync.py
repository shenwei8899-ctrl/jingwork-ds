"""隔离 PostgreSQL schema 验证只读镜像及账号隔离。"""

import os
import sys
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from server.utils.auth_middleware import get_db, get_required_user
from yuxi.storage.postgres.manager import PostgresManager

# Load the actual focused router without booting unrelated knowledge/parser routers.
route_path = Path(__file__).resolve().parents[3] / "server/routers/desktop_automation_router.py"
spec = importlib.util.spec_from_file_location("desktop_automation_sync_router_under_test", route_path)
route_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = route_module
spec.loader.exec_module(route_module)
desktop_automation = route_module.desktop_automation


@pytest.mark.asyncio
async def test_snapshot_migration_and_account_isolation():
    url = os.environ["POSTGRES_URL"]
    schema = "pytest_local_automation_" + uuid4().hex
    admin = create_async_engine(url)
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(url, connect_args={"server_settings": {"search_path": schema}})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE TABLE users (uid VARCHAR(64) PRIMARY KEY)"))
            await conn.execute(text("INSERT INTO users VALUES ('owner'), ('other')"))
            await conn.execute(
                text("CREATE TABLE yuxi_schema_migrations (domain TEXT PRIMARY KEY, version INT, applied_at TIMESTAMP)")
            )
            await conn.execute(text("INSERT INTO yuxi_schema_migrations VALUES ('business',12,now())"))
        manager = SimpleNamespace(async_engine=engine)
        await PostgresManager.upgrade_desktop_automation_snapshots(manager)
        await PostgresManager.upgrade_desktop_automation_snapshots(manager)
        app = FastAPI()
        app.include_router(desktop_automation, prefix="/api/scheduled-tasks")
        current_uid = "owner"
        app.dependency_overrides[get_required_user] = lambda: SimpleNamespace(uid=current_uid)

        async def session():
            async with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = session
        body = {
            "execution_location": "local",
            "tasks": [{"id": "task", "enabled": True}],
            "records": [{"task_id": "task", "status": "completed"}],
        }
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
            for _ in range(2):
                response = await client.put("/api/scheduled-tasks/desktop/device", json=body)
                assert response.status_code == 200
            snapshots = (await client.get("/api/scheduled-tasks/desktop")).json()["devices"]
            assert snapshots == [{"device_id": "device", "snapshot": body}]
            assert (
                await client.put("/api/scheduled-tasks/desktop/device", json={**body, "uid": "other"})
            ).status_code == 422
            assert (
                await client.put("/api/scheduled-tasks/desktop/device", json={**body, "execution_location": "server"})
            ).status_code == 422
            current_uid = "other"
            assert (await client.get("/api/scheduled-tasks/desktop")).json() == {"devices": []}
            assert (
                await client.put("/api/scheduled-tasks/desktop/device", json={**body, "tasks": []})
            ).status_code == 200
            current_uid = "owner"
            assert (await client.get("/api/scheduled-tasks/desktop")).json()["devices"][0]["snapshot"] == body
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM desktop_automation_snapshots")) == 2
            assert await conn.scalar(text("SELECT version FROM yuxi_schema_migrations WHERE domain='business'")) == 13
            assert await conn.scalar(text("SELECT to_regclass('scheduled_agent_jobs')")) is None
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()
