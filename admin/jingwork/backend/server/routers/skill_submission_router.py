"""桌面 Skill 提交与企业管理员审核 HTTP 接口。"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.skill_submission_repository import SkillSubmissionRepository
from yuxi.services.skills.submissions import (
    download_skill,
    rescan_skill,
    review_skill,
    serialize_submission,
    submit_skill,
)
from yuxi.storage.postgres.models_business import User

from server.utils.auth_middleware import get_admin_user, get_db, get_required_user

skill_submissions = APIRouter(tags=["skills"])


class SkillSubmissionInput(BaseModel):
    """与桌面本地 Skill 相同的可保存字段。"""

    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$", max_length=32)
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=65536)
    content: str = Field(min_length=1, max_length=65536)

    @field_validator("content", "name")
    @classmethod
    def require_text(cls, value: str) -> str:
        """拒绝空白正文与名称。"""
        if not value.strip():
            raise ValueError("内容不能为空")
        return value


class SkillReviewInput(BaseModel):
    """管理员对单个不可变版本的决定。"""

    status: Literal["approved", "rejected", "withdrawn"]
    comment: str = Field(default="", max_length=2000)


@skill_submissions.post("/skills/submissions")
async def submit_route(
    payload: SkillSubmissionInput, user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)
):
    """登录用户提交自己的 Markdown Skill。"""
    item = await submit_skill(db, user, payload.model_dump())
    return {"data": serialize_submission(item)}


@skill_submissions.get("/skills/submissions")
async def own_submissions_route(user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """用户只读取自己提交的审核结果。"""
    items = await SkillSubmissionRepository(db).list(created_by=str(user.uid))
    return {"data": [serialize_submission(item) for item in items]}


@skill_submissions.get("/skills/distributed")
async def catalog_route(_user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """企业登录用户读取已批准版本目录。"""
    items = await SkillSubmissionRepository(db).list(approved_only=True)
    return {"data": [serialize_submission(item) for item in items]}


@skill_submissions.get("/skills/distributed/{submission_id}")
async def download_route(
    submission_id: str, _user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)
):
    """在实际下载时再次检查发布状态。"""
    try:
        return {"data": await download_skill(db, submission_id)}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@skill_submissions.get("/system/skill-submissions")
async def management_route(_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """管理员查看所有桌面提交与扫描报告。"""
    items = await SkillSubmissionRepository(db).list()
    return {"data": [serialize_submission(item, include_content=True) for item in items]}


@skill_submissions.post("/system/skill-submissions/{submission_id}/review")
async def review_route(
    submission_id: str,
    payload: SkillReviewInput,
    user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """写入管理员审核意见及发布状态。"""
    try:
        item = await review_skill(db, user, submission_id, status=payload.status, comment=payload.comment)
        return {"data": serialize_submission(item, include_content=True)}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except ValueError as error:
        raise HTTPException(400, str(error)) from error


@skill_submissions.post("/system/skill-submissions/{submission_id}/scan")
async def scan_route(submission_id: str, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """管理员重新执行安全扫描。"""
    try:
        item = await rescan_skill(db, user, submission_id)
        return {"data": serialize_submission(item, include_content=True)}
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
