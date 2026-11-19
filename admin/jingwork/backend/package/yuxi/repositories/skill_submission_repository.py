"""桌面 Skill 不可变提交与审核状态的 PostgreSQL 访问。"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.storage.postgres.models_business import SkillSubmission


class SkillSubmissionRepository:
    """以提交者和内容哈希去重，审核时锁定版本。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, values: dict) -> SkillSubmission:
        """重复投递读取同一提交，不改变已审核状态。"""
        await self.db.execute(
            insert(SkillSubmission)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["created_by", "content_hash"])
        )
        result = await self.db.execute(
            select(SkillSubmission).where(
                SkillSubmission.created_by == values["created_by"],
                SkillSubmission.content_hash == values["content_hash"],
            )
        )
        return result.scalar_one()

    async def list(self, *, approved_only: bool = False, created_by: str | None = None) -> list[SkillSubmission]:
        """按审核时间列出提交或可分发版本。"""
        statement = select(SkillSubmission).order_by(SkillSubmission.updated_at.desc(), SkillSubmission.id.desc())
        if approved_only:
            statement = statement.where(SkillSubmission.status == "approved")
        if created_by is not None:
            statement = statement.where(SkillSubmission.created_by == created_by)
        return list((await self.db.execute(statement)).scalars())

    async def get(self, submission_id: str, *, for_update: bool = False) -> SkillSubmission | None:
        """审核写入使用行锁，并刷新同会话缓存。"""
        statement = select(SkillSubmission).where(SkillSubmission.id == submission_id)
        if for_update:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return (await self.db.execute(statement)).scalar_one_or_none()
