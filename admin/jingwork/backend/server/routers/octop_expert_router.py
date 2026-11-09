"""企业后台 Octop 专家目录适配层。"""

import zipfile
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from yuxi.services.octop_expert_service import (
    ExpertSource,
    get_expert,
    import_expert,
    list_experts,
    prepare_market_skillset,
)
from yuxi.storage.postgres.models_business import User
from server.utils.auth_middleware import get_admin_user, get_db, get_required_user

octop_experts = APIRouter(prefix="/octop/experts", tags=["agent"])


class ExpertImport(BaseModel):
    """用户审核后的模板导入参数。"""

    name: str = Field(min_length=1, max_length=100)
    share_config: dict


@octop_experts.get("/personal/catalog")
async def personal_catalog(authorization: str = Header(...), user: User = Depends(get_required_user)):
    """仅查询显式接入的桌面服务，未接入时返回能力状态。"""
    desktop_url = os.getenv("YUXI_DESKTOP_URL", "").strip().rstrip("/")
    if not desktop_url:
        return {
            "experts": [],
            "teams": [],
            "connected": False,
            "available": False,
            "message": "服务器尚未接入桌面目录服务，请在桌面端查看个人专家和团队",
        }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                desktop_url + "/api/enterprise/conversation-logs/experts",
                headers={"Authorization": authorization},
            )
        if response.status_code != 200:
            raise HTTPException(502, "桌面专家查询失败")
        return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(503, "桌面服务暂不可用，请启动桌面端后刷新") from exc


@octop_experts.get("/{source}", summary="Octop 内置专家或专家市场目录")
async def catalog(source: ExpertSource, user: User = Depends(get_admin_user)):
    """读取公共模板，企业入口仅允许管理员。"""
    try:
        return {"items": await list_experts(source)}
    except (ValueError, httpx.HTTPError) as exc:
        raise HTTPException(502, "专家目录暂不可用") from exc


@octop_experts.get("/{source}/{expert_id}", summary="审核专家提示词与依赖")
async def detail(source: ExpertSource, expert_id: str, user: User = Depends(get_admin_user)):
    """读取完整模板。"""
    try:
        return await get_expert(source, expert_id)
    except (ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "专家市场暂不可用") from exc


@octop_experts.post("/{source}/{expert_id}/import", summary="导入专家与全部 Skills，创建原生 Yuxi Agent")
async def create(
    source: ExpertSource,
    expert_id: str,
    body: ExpertImport,
    user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """按提交的共享范围安装依赖并创建智能体。"""
    try:
        return await import_expert(
            db, source=source, expert_id=expert_id, name=body.name, share_config=body.share_config, operator=user
        )
    except (ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "市场资源下载失败，未创建智能体") from exc


@octop_experts.post("/market/{expert_id}/skill-drafts", summary="准备技能市场安装草稿")
async def prepare_skills(expert_id: str, user: User = Depends(get_admin_user)):
    """复用技能安装审核流程，生效范围由确认安装决定。"""
    try:
        return {"success": True, "data": await prepare_market_skillset(expert_id, user)}
    except (ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(422, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "技能市场资源下载失败") from exc
