"""认证用户采集自身错误，管理员查询系统日志。"""

from datetime import UTC, datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from server.utils.auth_middleware import get_admin_user, get_required_user, get_db
from yuxi.storage.postgres.models_business import User
from yuxi.repositories.runtime_log_repository import RuntimeLogRepository
from yuxi.services.runtime_log_service import collect_runtime_error

runtime_logs = APIRouter(prefix="/system/runtime-logs", tags=["系统日志"])


class RuntimeErrorInput(BaseModel):
    """不接受 user_id、用户名或任意扩展正文。"""

    model_config = ConfigDict(extra="forbid")
    source: Literal["desktop", "web", "model"]
    operation: str = Field(min_length=1, max_length=256)
    error_code: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=2000)
    correlation_id: str | None = Field(None, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    actions: list[str] = Field(default_factory=list, max_length=10)


@runtime_logs.post("", status_code=201)
async def collect(
    event: RuntimeErrorInput, user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)
):
    """使用当前认证用户绑定身份。"""
    if any(len(action) > 256 for action in event.actions):
        raise HTTPException(422, "操作记录过长")
    return await collect_runtime_error(db, user, event)


@runtime_logs.get("")
async def page(
    user_id: int | None = Query(None, gt=0),
    username: str | None = Query(None, max_length=128),
    uid: str | None = Query(None, max_length=64),
    since: datetime | None = None,
    until: datetime | None = None,
    before_id: int | None = Query(None, gt=0),
    limit: int = Query(50, ge=1, le=100),
    _admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """管理员按账号和时间读取稳定分页。"""
    since = since.astimezone(UTC).replace(tzinfo=None) if since and since.tzinfo else since
    until = until.astimezone(UTC).replace(tzinfo=None) if until and until.tzinfo else until
    if since and until and since > until:
        raise HTTPException(422, "开始时间不能晚于结束时间")
    return await RuntimeLogRepository(db).page(
        user_id=user_id, username=username, uid=uid, since=since, until=until, before_id=before_id, limit=limit
    )
