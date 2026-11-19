"""桌面对话交付文件的私有存储、重试和下载。"""

import hashlib
import json
from datetime import UTC
from urllib.parse import quote

from fastapi import HTTPException
from fastapi.responses import Response

from yuxi.repositories.desktop_conversation_file_repository import DesktopConversationFileRepository
from yuxi.storage.minio.client import get_minio_client
from yuxi.utils.datetime_utils import format_utc_datetime
from yuxi.utils.upload_utils import MAX_UPLOAD_SIZE_BYTES, read_upload_with_limit

BUCKET = "desktop-conversation-files"


async def store_conversation_file(db, user, metadata, upload):
    """对象与元数据均成功保存后确认，不同内容不能覆盖既有来源。"""
    try:
        content = await read_upload_with_limit(
            upload, max_size_bytes=MAX_UPLOAD_SIZE_BYTES, too_large_message="文件超过上传大小限制"
        )
    except ValueError as error:
        raise HTTPException(413, str(error)) from error
    filename = (upload.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not filename or len(filename) > 255 or any(ord(char) < 32 for char in filename):
        raise HTTPException(422, "文件名无效")
    repo = DesktopConversationFileRepository(db)
    if not await repo.has_conversation(user.id, metadata.device_id, metadata.agent_id, metadata.thread_id):
        raise HTTPException(404, "所属会话尚未同步")
    file_id = hashlib.sha256(
        json.dumps([user.id, metadata.device_id, metadata.agent_id, metadata.source_id], ensure_ascii=False).encode()
    ).hexdigest()
    digest = hashlib.sha256(content).hexdigest()
    values = {
        "id": file_id,
        "user_id": user.id,
        "device_id": metadata.device_id,
        "agent_id": metadata.agent_id,
        "thread_id": metadata.thread_id,
        "source_id": metadata.source_id,
        "filename": filename,
        "size": len(content),
        "sha256": digest,
        "object_name": f"{file_id}/{digest}",
        "timestamp": metadata.timestamp.astimezone(UTC).replace(tzinfo=None),
    }
    item = await repo.create_locked(values)
    if any(getattr(item, field) != values[field] for field in ("thread_id", "sha256", "filename", "timestamp")):
        raise HTTPException(409, "同一交付文件的内容或归属发生变化")
    await get_minio_client().aupload_file(BUCKET, item.object_name, content, "application/octet-stream")
    await db.commit()
    return {"id": item.id, "sha256": digest, "size": len(content)}


async def list_conversation_files(db, uid, device_id, agent_id, thread_id):
    """返回安全显示字段，服务端对象路径由下载接口拥有。"""
    rows = await DesktopConversationFileRepository(db).list(uid, device_id, agent_id, thread_id)
    return {
        "items": [
            {"id": row.id, "filename": row.filename, "size": row.size, "timestamp": format_utc_datetime(row.timestamp)}
            for row in rows
        ]
    }


async def download_conversation_file(db, file_id):
    """管理员下载私有副本，浏览器以附件处理所有文件类型。"""
    item = await DesktopConversationFileRepository(db).get(file_id)
    if item is None:
        raise HTTPException(404, "文件不存在")
    content = await get_minio_client().adownload_file(BUCKET, item.object_name)
    if hashlib.sha256(content).hexdigest() != item.sha256:
        raise HTTPException(503, "文件校验失败，请联系管理员")
    return Response(
        content,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(item.filename, safe='')}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )
