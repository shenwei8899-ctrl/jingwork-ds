"""桌面素材同步与后台会话日志。"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from server.utils.auth_middleware import get_admin_user, get_required_user, get_db
from yuxi.repositories.desktop_conversation_repository import DesktopConversationRepository
from yuxi.services.dashboard_service import DashboardService
from yuxi.storage.postgres.models_business import User

conversation_logs = APIRouter(prefix="/system/conversation-logs", tags=["对话日志"])


class CapturedEvent(BaseModel):
    """客户端捕获的聊天素材，不接受身份或工具轨迹字段。"""

    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(min_length=1, max_length=256)
    thread_id: str | None = Field(None, max_length=512)
    event_type: str = Field(pattern="^(user_message|assistant_message)$")
    content: str = Field(max_length=2 * 1024 * 1024)
    timestamp: datetime

    @field_validator("timestamp")
    @classmethod
    def aware_time(cls, value: datetime) -> datetime:
        """来源必须明确时区，避免按机器时区猜测归属时间。"""
        if value.tzinfo is None:
            raise ValueError("timestamp 必须包含时区")
        return value


class CapturedBatch(BaseModel):
    """一个设备专家的有界批次，用户身份由 Token 确定。"""

    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=128)
    agent_id: str = Field(min_length=1, max_length=128)
    agent_name: str = Field(min_length=1, max_length=200)
    events: list[CapturedEvent] = Field(min_length=1, max_length=100)


class CapturedFile(BaseModel):
    """文件来源字段与内容分别传递，身份由认证决定。"""

    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=1, max_length=128)
    agent_id: str = Field(min_length=1, max_length=128)
    thread_id: str = Field(min_length=1, max_length=512)
    source_id: str = Field(min_length=1, max_length=256)
    timestamp: AwareDatetime


@conversation_logs.post("/files/sync")
async def sync_file(
    metadata: str = Form(..., max_length=4096),
    file: UploadFile = File(...),
    user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """登录用户上传已同步会话的交付文件。"""
    from fastapi import HTTPException
    from pydantic import ValidationError
    from yuxi.services.desktop_conversation_file_service import store_conversation_file

    try:
        fields = CapturedFile.model_validate_json(metadata)
    except ValidationError as error:
        raise HTTPException(422, "文件来源字段无效") from error
    return await store_conversation_file(db, user, fields, file)


@conversation_logs.get("/files")
async def files(
    uid: str,
    device_id: str,
    agent_id: str,
    thread_id: str,
    _user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """管理员读取当前会话的已同步文件。"""
    from yuxi.services.desktop_conversation_file_service import list_conversation_files

    return await list_conversation_files(db, uid, device_id, agent_id, thread_id)


@conversation_logs.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    _user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """鉴权后读取数据库所属私有对象。"""
    from yuxi.services.desktop_conversation_file_service import download_conversation_file

    return await download_conversation_file(db, file_id)


@conversation_logs.post("/sync")
async def sync(body: CapturedBatch, user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """登录用户上传自己的素材，幂等去重后才确认接收。"""
    inserted = await DesktopConversationRepository(db).ingest(
        user, body.device_id, body.agent_id, body.agent_name, [event.model_dump() for event in body.events]
    )
    return {"received": len(body.events), "inserted": inserted}


@conversation_logs.get("/catalog")
async def catalog(_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """列出已同步日志中的用户和专家。"""
    return await DesktopConversationRepository(db).catalog()


@conversation_logs.get("/overview")
async def overview(_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """管理员组织概览读取与对话日志一致的累计用量。"""
    return await DashboardService(db).get_enterprise_overview(_user)


@conversation_logs.get("/sessions")
async def sessions(
    uid: str | None = None,
    department_id: int | None = Query(None, gt=0),
    role: Literal["superadmin", "admin", "user"] | None = None,
    agent_id: str | None = None,
    query: str | None = Query(None, max_length=500),
    offset: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    _user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """筛选持久会话列表，不访问在线桌面服务。"""
    return await DesktopConversationRepository(db).sessions(
        uid, agent_id, query, offset, limit, department_id=department_id, role=role
    )


@conversation_logs.get("/messages")
async def messages(
    uid: str,
    device_id: str,
    agent_id: str,
    thread_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    _user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """查询选定会话的用户消息与 AI 回复。"""
    return await DesktopConversationRepository(db).messages(uid, device_id, agent_id, thread_id, offset, limit)
