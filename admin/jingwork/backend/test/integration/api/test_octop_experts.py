"""真实 HTTP / PostgreSQL 的模板导入与企业访问授权。"""

import os
import io
import zipfile
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import secrets
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from yuxi.storage.postgres.models_business import Agent, APIKey, Conversation, Department, Skill, User
from yuxi.utils.auth_utils import AuthUtils
from test.live_api_cleanup import delete_test_conversation_resources

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest_asyncio.fixture
async def accounts(test_client):
    """测试账号独立生成，不借用或改写真实管理员授权。"""
    engine = create_async_engine(os.environ["POSTGRES_URL"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    users = []
    headers = []
    async with sessions() as db:
        department = Department(name="pytest-octop-" + uuid.uuid4().hex[:10])
        db.add(department)
        await db.commit()
        for role in ("admin", "user", "user"):
            uid = "99" + str(secrets.randbelow(10**10)).zfill(10)
            password = secrets.token_urlsafe(24)
            user = User(
                uid=uid,
                username="pytest-octop-" + uid,
                role=role,
                department_id=department.id,
                password_hash=AuthUtils.hash_password(password),
            )
            db.add(user)
            await db.commit()
            users.append(user)
            response = await test_client.post("/api/auth/token", data={"username": uid, "password": password})
            assert response.status_code == 200, response.text
            headers.append({"Authorization": "Bearer " + response.json()["access_token"]})
    try:
        yield sessions, users, headers
    finally:
        async with sessions() as db:
            await db.execute(delete(APIKey).where(APIKey.user_id.in_([user.id for user in users])))
            threads = set(
                (
                    await db.scalars(
                        select(Conversation.thread_id).where(Conversation.uid.in_([user.uid for user in users]))
                    )
                ).all()
            )
            await delete_test_conversation_resources({}, threads, set())
            for user in users:
                stored = await db.get(User, user.id)
                if stored:
                    await db.delete(stored)
            await db.flush()
            await db.execute(delete(Department).where(Department.id == department.id))
            await db.commit()
        await engine.dispose()


@pytest.mark.parametrize(
    ("source", "expert_id"), [("bundled", "office-automation"), ("market", "tech-test-automation")]
)
async def test_complete_import_shared_api_key_visibility_and_revocation(test_client, accounts, source, expert_id):
    """导入全套文档技能，授权员工可见，撤权后不能提交任何运行。"""
    sessions, users, headers = accounts
    admin, member, outsider = headers
    share = {
        "version": 2,
        "read_scope": {"access_level": "user", "user_uids": [users[1].uid], "department_ids": []},
        "manage_scope": None,
    }
    slug = None
    skill_slugs = []
    try:
        response = await test_client.get("/api/octop/experts/bundled", headers=outsider)
        assert response.status_code == 403, response.text
        response = await test_client.post(
            f"/api/octop/experts/{source}/{expert_id}/import",
            headers=admin,
            json={"name": "pytest-octop-import-" + uuid.uuid4().hex[:8], "share_config": share},
        )
        assert response.status_code == 200, response.text
        slug = response.json()["slug"]
        skill_slugs = response.json()["installed_skills"]
        assert len(skill_slugs) == 6
        async with sessions() as db:
            agent = await db.scalar(select(Agent).where(Agent.slug == slug))
            assert agent.backend_id == "ChatbotAgent"
            assert set(agent.config_json["context"]["skills"]) == set(skill_slugs)
            assert agent.config_json["context"]["system_prompt"]
            skills = (await db.scalars(select(Skill).where(Skill.slug.in_(skill_slugs)))).all()
            assert len(skills) == 6
            assert all(skill.share_config["read_scope"]["user_uids"] == [users[1].uid] for skill in skills)

        response = await test_client.get("/api/skills/desktop-market", headers=member)
        assert response.status_code == 200, response.text
        assert set(skill_slugs) <= {item["slug"] for item in response.json()["items"]}
        for skill_slug in skill_slugs:
            response = await test_client.get(f"/api/skills/desktop-market/{skill_slug}/download", headers=member)
            assert response.status_code == 200, response.text
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                assert archive.read(f"{skill_slug}/SKILL.md").strip()
            response = await test_client.get(f"/api/skills/desktop-market/{skill_slug}/download", headers=outsider)
            assert response.status_code == 404, response.text
        async with sessions() as db:
            stored = await db.scalar(select(Skill).where(Skill.slug == skill_slugs[0]))
            stored.enabled = False
            await db.commit()
        response = await test_client.get(f"/api/skills/desktop-market/{skill_slugs[0]}/download", headers=member)
        assert response.status_code == 404, response.text

        response = await test_client.post(
            "/api/user/apikey/", headers=member, json={"request_id": uuid.uuid4().hex, "name": "pytest-octop-client"}
        )
        assert response.status_code == 200, response.text
        credential = {"Authorization": "Bearer " + response.json()["secret"]}
        response = await test_client.get("/api/agent", headers=credential)
        assert slug in {item["slug"] for item in response.json()["agents"]}
        response = await test_client.get("/api/agent", headers=outsider)
        assert slug not in {item["slug"] for item in response.json()["agents"]}

        response = await test_client.put(
            f"/api/agent/{slug}",
            headers=admin,
            json={"share_config": {**share, "read_scope": {**share["read_scope"], "user_uids": [users[0].uid]}}},
        )
        assert response.status_code == 200, response.text
        response = await test_client.get("/api/agent", headers=credential)
        assert slug not in {item["slug"] for item in response.json()["agents"]}
        response = await test_client.post(
            "/api/agent-invocation/agent-call/runs",
            headers=credential,
            json={"agent_slug": slug, "messages": [{"role": "user", "content": "permission check"}]},
        )
        assert response.status_code in {403, 404}, response.text
    finally:
        if slug:
            response = await test_client.delete(f"/api/agent/{slug}", headers=admin)
            assert response.status_code == 200, response.text
        for skill_slug in skill_slugs:
            response = await test_client.delete(f"/api/system/skills/{skill_slug}", headers=admin)
            assert response.status_code == 200, response.text


async def test_authorized_agent_call_uses_real_worker(test_client, accounts):
    """真实 worker 请求临时模型服务，用户 API Key 执行原生 Agent Call。"""
    sessions, users, headers = accounts
    admin, member, _ = headers
    marker = "OCTOP_YUXI_REAL_WORKER_OK"
    observed = []

    class Replay(BaseHTTPRequestHandler):
        """只在测试生命周期内提供 OpenAI SSE。"""

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            observed.append(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for delta, finish in [({"role": "assistant", "content": marker}, None), ({}, "stop")]:
                chunk = {
                    "id": "chatcmpl-octop-test",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": "test-chat",
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("0.0.0.0", 0), Replay)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    provider = "pytest-octop-" + uuid.uuid4().hex[:8]
    thread_id = str(uuid.uuid4())
    slug = None
    try:
        response = await test_client.post(
            "/api/system/model-providers",
            headers=admin,
            json={
                "provider_id": provider,
                "display_name": "Temporary integration model",
                "provider_type": "openai",
                "base_url": f"http://api:{server.server_port}/v1",
                "api_key": "test-only-key",
                "capabilities": ["chat"],
                "enabled_models": [
                    {"id": "test-chat", "display_name": "Test chat", "type": "chat", "source": "manual"}
                ],
                "is_enabled": True,
            },
        )
        assert response.status_code == 200, response.text
        response = await test_client.post(
            "/api/agent",
            headers=admin,
            json={
                "name": "pytest-octop-worker",
                "backend_id": "ChatbotAgent",
                "config_json": {
                    "context": {
                        "model": provider + ":test-chat",
                        "system_prompt": "Reply briefly.",
                        "tools": [],
                        "skills": [],
                        "knowledges": [],
                        "mcps": [],
                        "subagents": [],
                    }
                },
                "share_config": {
                    "version": 2,
                    "read_scope": {
                        "access_level": "department",
                        "department_ids": [users[1].department_id],
                        "user_uids": [],
                    },
                    "manage_scope": None,
                },
            },
        )
        assert response.status_code == 200, response.text
        slug = response.json()["agent"]["slug"]
        response = await test_client.post(
            "/api/user/apikey/", headers=member, json={"request_id": uuid.uuid4().hex, "name": "pytest-octop-worker"}
        )
        assert response.status_code == 200, response.text
        credential = member
        response = await test_client.post(
            "/api/agent-invocation/agent-call/runs",
            headers=credential,
            json={
                "agent_slug": slug,
                "messages": [{"role": "user", "content": "Verify bridge."}],
                "thread_id": thread_id,
                "request_id": str(uuid.uuid4()),
                "async_mode": False,
                "stream": False,
            },
            timeout=180,
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "completed", response.text
        assert marker in response.json()["output"], response.text
        assert observed and observed[0]["model"] == "test-chat"
    finally:
        if slug:
            await test_client.delete(f"/api/agent/{slug}", headers=admin)
        await test_client.delete(f"/api/chat/thread/{thread_id}", headers=member)
        await test_client.delete(f"/api/system/model-providers/{provider}", headers=admin)
        server.shutdown()
        server.server_close()
