"""管理员操作日志采集与查询接口。"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from server.utils.auth_middleware import get_admin_user, get_required_user, get_db
from yuxi.repositories.operation_log_repository import OperationLogRepository
from yuxi.storage.postgres.models_business import User
from yuxi.services.operation_log_service import collect_desktop_operation

operation_logs = APIRouter(prefix="/system/operation-logs", tags=["操作日志"])


class DesktopOperationInput(BaseModel):
    """桌面操作仅接收分类和结果，不接收业务正文或账号身份。"""

    model_config = ConfigDict(extra="forbid")
    operation: Literal[
        "launch",
        "sign_out",
        "agent_open",
        "agent_save",
        "agent_remove",
        "config_import",
        "plugin_operation",
        "knowledge_read",
        "session_start",
        "settings_change",
    ]
    outcome: Literal["success", "failed"]
    correlation_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")


@operation_logs.post("", status_code=201)
async def collect(
    event: DesktopOperationInput,
    request: Request,
    user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """将客户端事实按认证账号去重持久化后确认。"""
    return await collect_desktop_operation(db, user, event, request)


@operation_logs.get("/filters")
async def filters(_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """提供真实操作类型和员工筛选项。"""
    return await OperationLogRepository(db).filters()


@operation_logs.get("")
async def events(
    user_id: int | None = Query(None, gt=0),
    department_id: int | None = Query(None, gt=0),
    role: Literal["superadmin", "admin", "user"] | None = None,
    operation: str | None = Query(None, max_length=128),
    since: datetime | None = None,
    until: datetime | None = None,
    before_id: int | None = Query(None, gt=0),
    limit: int = Query(50, ge=1, le=100),
    _user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """查询实际操作日志，时间统一按 UTC 比较。"""
    if since is not None:
        since = since.astimezone(UTC).replace(tzinfo=None) if since.tzinfo else since
    if until is not None:
        until = until.astimezone(UTC).replace(tzinfo=None) if until.tzinfo else until
    if since and until and since > until:
        raise HTTPException(422, "开始时间不能晚于结束时间")
    return await OperationLogRepository(db).page(
        user_id=user_id,
        operation=operation,
        since=since,
        until=until,
        before_id=before_id,
        limit=limit,
        department_id=department_id,
        role=role,
    )
