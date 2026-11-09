"""桌面自动化只读同步接口，不发布后台执行请求。"""

from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from yuxi.storage.postgres.models_business import User
from server.utils.auth_middleware import get_db, get_required_user

desktop_automation = APIRouter()


class DesktopAutomationSync(BaseModel):
    """只读配置和记录镜像，不接受服务器调度模式。"""

    model_config = ConfigDict(extra="forbid")
    execution_location: Literal["local"]
    tasks: list[dict] = Field(max_length=500)
    records: list[dict] = Field(max_length=2000)


@desktop_automation.put("/desktop/{device_id}")
async def sync_desktop(
    device_id: str,
    payload: DesktopAutomationSync,
    current_user: User = Depends(get_required_user),
    db: AsyncSession = Depends(get_db),
):
    """后台仅保存本地执行快照，账号来自已认证会话。"""
    from yuxi.services.desktop_automation_service import save_desktop_automation

    if not 1 <= len(device_id) <= 64:
        raise HTTPException(status_code=422, detail="设备标识无效")
    return await save_desktop_automation(
        db=db, uid=str(current_user.uid), device_id=device_id, snapshot=payload.model_dump()
    )


@desktop_automation.get("/desktop")
async def desktop_snapshots(current_user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """列出当前账号本地自动化的同步配置和记录。"""
    from yuxi.services.desktop_automation_service import list_desktop_automations

    return await list_desktop_automations(db=db, uid=str(current_user.uid))
