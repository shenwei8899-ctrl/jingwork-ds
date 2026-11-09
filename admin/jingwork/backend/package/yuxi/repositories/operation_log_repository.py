"""操作日志的只读查询边界。"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.storage.postgres.models_business import OperationLog, User


class OperationLogRepository:
    """查询已持久化操作事实及实际筛选值。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def page(
        self,
        *,
        user_id: int | None,
        operation: str | None,
        since: datetime | None,
        until: datetime | None,
        before_id: int | None,
        limit: int,
        department_id: int | None = None,
        role: str | None = None,
    ) -> dict:
        """按稳定 ID 游标读取日志，新增记录不会改变后续页位置。"""
        query = select(OperationLog, User.username, User.uid).outerjoin(User, User.id == OperationLog.user_id)
        if department_id is not None:
            query = query.where(User.department_id == department_id)
        if role is not None:
            query = query.where(User.role == role)
        if user_id is not None:
            query = query.where(OperationLog.user_id == user_id)
        if operation:
            query = query.where(OperationLog.operation == operation)
        if since is not None:
            query = query.where(OperationLog.timestamp >= since)
        if until is not None:
            query = query.where(OperationLog.timestamp <= until)
        if before_id is not None:
            query = query.where(OperationLog.id < before_id)
        rows = (await self.db.execute(query.order_by(OperationLog.id.desc()).limit(limit + 1))).all()
        items = [{**entry.to_dict(), "username": username, "uid": uid} for entry, username, uid in rows[:limit]]
        return {"items": items, "next_cursor": items[-1]["id"] if len(rows) > limit else None}

    async def filters(self) -> dict:
        """只返回实际有操作记录的用户和操作类型。"""
        users = (
            await self.db.execute(
                select(User.id, User.username, User.uid)
                .join(OperationLog, OperationLog.user_id == User.id)
                .distinct()
                .order_by(User.username)
            )
        ).all()
        operations = (
            await self.db.scalars(select(OperationLog.operation).distinct().order_by(OperationLog.operation))
        ).all()
        return {
            "users": [{"id": user.id, "username": user.username, "uid": user.uid} for user in users],
            "operations": list(operations),
        }
