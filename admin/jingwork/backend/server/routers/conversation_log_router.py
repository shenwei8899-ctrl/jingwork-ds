"""桌面素材同步与后台会话日志。"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from server.utils.auth_middleware import get_admin_user, get_current_user, get_db
from yuxi.repositories.desktop_conversation_repository import DesktopConversationRepository
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


@conversation_logs.post("/sync")
async def sync(body: CapturedBatch, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """登录用户上传自己的素材，幂等去重后才确认接收。"""
    inserted = await DesktopConversationRepository(db).ingest(
        user, body.device_id, body.agent_id, body.agent_name, [event.model_dump() for event in body.events]
    )
    return {"received": len(body.events), "inserted": inserted}


@conversation_logs.get("/catalog")
async def catalog(_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """列出已同步日志中的用户和专家。"""
    return await DesktopConversationRepository(db).catalog()


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
