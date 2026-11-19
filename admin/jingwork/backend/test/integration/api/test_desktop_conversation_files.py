"""真实 HTTP、PostgreSQL 与 MinIO 的桌面对话交付文件链路。"""

import asyncio
import hashlib
import json

from sqlalchemy import select

from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.storage.minio.client import get_minio_client
from yuxi.storage.postgres.models_business import DesktopConversationFile


async def test_conversation_file_roundtrip_ownership_retry_and_private_download(test_client, accounts):  # noqa: F811
    """本机离线后依然读取私有副本，同名线程按账号、设备和专家隔离。"""
    sessions, users, headers = accounts
    root = "/api/system/conversation-logs"
    content = "生成的文件已保存到后台\n".encode()
    metadata = {
        "device_id": "file-device",
        "agent_id": "expert",
        "thread_id": "same-thread",
        "source_id": "same-thread:4:file:0",
        "timestamp": "2026-11-18T08:00:00Z",
    }
    uploaded = []
    try:
        for user in (1, 2):
            response = await test_client.post(
                root + "/sync",
                headers=headers[user],
                json={
                    "device_id": metadata["device_id"],
                    "agent_id": "expert",
                    "agent_name": "测试专家",
                    "events": [
                        {
                            "event_id": "same-thread:1",
                            "thread_id": "same-thread",
                            "event_type": "user_message",
                            "content": "生成文档",
                            "timestamp": metadata["timestamp"],
                        }
                    ],
                },
            )
            assert response.status_code == 200, response.text

        async def upload(user=1, body=content, fields=None, filename="生成文件.txt"):
            return await test_client.post(
                root + "/files/sync",
                headers=headers[user],
                data={"metadata": json.dumps(fields or metadata)},
                files={"file": (filename, body)},
            )

        first = await upload()
        assert first.status_code == 200, first.text
        receipt = first.json()
        uploaded.append(receipt["id"])
        assert receipt["sha256"] == hashlib.sha256(content).hexdigest()
        assert receipt["size"] == len(content)
        anonymous = await test_client.post(
            root + "/files/sync", data={"metadata": json.dumps(metadata)}, files={"file": ("file.txt", content)}
        )
        assert anonymous.status_code == 401
        retries = await asyncio.gather(upload(), upload())
        assert all(response.json() == receipt for response in retries)
        conflict = await upload(body=b"changed")
        assert conflict.status_code == 409
        other = await upload(user=2)
        assert other.status_code == 200, other.text
        uploaded.append(other.json()["id"])
        assert other.json()["id"] != receipt["id"]
        params = {"uid": users[1].uid, **{key: metadata[key] for key in ("device_id", "agent_id", "thread_id")}}
        listing = await test_client.get(root + "/files", headers=headers[0], params=params)
        assert listing.status_code == 200, listing.text
        assert listing.json()["items"] == [
            {"id": receipt["id"], "filename": "生成文件.txt", "size": len(content), "timestamp": "2026-11-18T08:00:00Z"}
        ]
        for field in ("device_id", "agent_id", "thread_id"):
            empty = await test_client.get(root + "/files", headers=headers[0], params={**params, field: "another"})
            assert empty.json()["items"] == []
        downloaded = await test_client.get(root + f"/files/{receipt['id']}/download", headers=headers[0])
        assert downloaded.content == content
        assert downloaded.headers["content-type"] == "application/octet-stream"
        assert downloaded.headers["x-content-type-options"] == "nosniff"
        assert downloaded.headers["content-disposition"].startswith("attachment;")
        for path, query in [("/files", params), (f"/files/{receipt['id']}/download", {})]:
            assert (await test_client.get(root + path, params=query)).status_code == 401
            assert (await test_client.get(root + path, headers=headers[1], params=query)).status_code == 403
        assert (await upload(fields={**metadata, "device_id": "another"})).status_code == 404
        assert (await upload(fields={**metadata, "uid": users[2].uid})).status_code == 422
        assert (await upload(fields={**metadata, "timestamp": "2026-11-18T08:00:00"})).status_code == 422
        async with sessions() as db:
            rows = list(
                await db.scalars(select(DesktopConversationFile).where(DesktopConversationFile.id.in_(uploaded)))
            )
            assert len(rows) == 2
            assert {row.user_id for row in rows} == {users[1].id, users[2].id}
            for row in rows:
                stored = await get_minio_client().adownload_file("desktop-conversation-files", row.object_name)
                assert stored == content
    finally:
        async with sessions() as db:
            for row in await db.scalars(
                select(DesktopConversationFile).where(DesktopConversationFile.id.in_(uploaded))
            ):
                await get_minio_client().adelete_file("desktop-conversation-files", row.object_name)


async def test_file_schema_upgrade_is_atomic_idempotent_and_rejects_unknown_versions():
    """独立 schema 重放增量迁移，未知版本不能创建文件表。"""
    from sqlalchemy import text
    from test.integration.services.test_schema_migration_version import _create_isolated_manager, _drop_isolated_schema

    schema, control, engine, manager = await _create_isolated_manager("pytest_conversation_files")
    try:
        await manager.create_schema_version_table()
        async with engine.begin() as conn:
            await conn.execute(text("CREATE TABLE users (id integer PRIMARY KEY)"))
        await manager.record_schema_version("business", 13)
        import pytest

        with pytest.raises(RuntimeError, match="Unsupported business schema version"):
            await manager.upgrade_desktop_conversation_files()
        await manager.record_schema_version("business", 14)
        await manager.upgrade_desktop_conversation_files()
        await manager.upgrade_desktop_conversation_files()
        assert (await manager.get_schema_versions())["business"] == 15
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM desktop_conversation_files")) == 0
    finally:
        await _drop_isolated_schema(schema, control, engine)
