"""桌面 Skill 提交、静态扫描、人工审核与分发用例。"""

import hashlib
import json
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.skill_submission_repository import SkillSubmissionRepository
from yuxi.services.skills.security_scan import scan_markdown_skill
from yuxi.storage.postgres.models_business import SkillSubmission, User
from yuxi.utils.datetime_utils import format_utc_datetime, utc_now_naive


async def submit_skill(db: AsyncSession, user: User, skill: dict[str, str]) -> SkillSubmission:
    """保存不可变内容版本，重复上传复用原审核结果。"""
    digest = hashlib.sha256(json.dumps(skill, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    repo = SkillSubmissionRepository(db)
    now = utc_now_naive()
    item = await repo.create(
        {
            "id": str(uuid.uuid4()),
            **skill,
            "created_by": str(user.uid),
            "submitted_by": user.username,
            "content_hash": digest,
            "status": "pending",
            "scan_report": {"status": "pending"},
            "created_at": now,
            "updated_at": now,
        }
    )
    await db.commit()
    if item.scan_report.get("status") == "pending":
        report = await scan_markdown_skill(skill)
        item = await repo.get(item.id, for_update=True)
        item.scan_report = report
        await db.commit()
    return item


async def review_skill(
    db: AsyncSession, user: User, submission_id: str, *, status: str, comment: str
) -> SkillSubmission:
    """管理员审核指定内容版本，扫描完成后允许批准。"""
    if user.role not in {"admin", "superadmin"}:
        raise PermissionError("需要管理员权限")
    item = await SkillSubmissionRepository(db).get(submission_id, for_update=True)
    if item is None:
        raise LookupError("Skill 提交不存在")
    if status not in {"approved", "rejected", "withdrawn"}:
        raise ValueError("审核状态无效")
    if status == "approved" and item.scan_report.get("status") != "completed":
        raise ValueError("请先完成安全扫描")
    if status in {"rejected", "withdrawn"} and not comment.strip():
        raise ValueError("请填写审核意见")
    item.status = status
    item.review_comment = comment.strip()
    item.reviewed_by = str(user.uid)
    item.reviewed_at = utc_now_naive()
    item.updated_at = item.reviewed_at
    await db.commit()
    return item


async def rescan_skill(db: AsyncSession, user: User, submission_id: str) -> SkillSubmission:
    """重新扫描不可变提交，保留人工审核状态。"""
    if user.role not in {"admin", "superadmin"}:
        raise PermissionError("需要管理员权限")
    repo = SkillSubmissionRepository(db)
    item = await repo.get(submission_id)
    if item is None:
        raise LookupError("Skill 提交不存在")
    report = await scan_markdown_skill({key: getattr(item, key) for key in ("slug", "name", "description", "content")})
    item = await repo.get(submission_id, for_update=True)
    item.scan_report = report
    item.updated_at = utc_now_naive()
    await db.commit()
    return item


async def download_skill(db: AsyncSession, submission_id: str) -> dict:
    """每次下载都检查批准状态，直接 ID 请求同样受限。"""
    item = await SkillSubmissionRepository(db).get(submission_id)
    if item is None or item.status != "approved":
        raise LookupError("Skill 未发布或已下架")
    return {key: getattr(item, key) for key in ("slug", "name", "description", "content")}


def serialize_submission(item: SkillSubmission, *, include_content: bool = False) -> dict:
    """目录仅返回元数据，管理员详情附带审核正文。"""
    result = {
        key: getattr(item, key)
        for key in (
            "id",
            "slug",
            "name",
            "description",
            "content_hash",
            "status",
            "scan_report",
            "submitted_by",
            "review_comment",
            "reviewed_by",
        )
    }
    result["created_at"] = format_utc_datetime(item.created_at)
    result["reviewed_at"] = format_utc_datetime(item.reviewed_at)
    if include_content:
        result["content"] = item.content
    return result
