"""运行错误日志的持久化和稳定游标查询。"""

from sqlalchemy import select
from yuxi.storage.postgres.models_business import RuntimeErrorLog
from yuxi.utils.datetime_utils import format_utc_datetime


class RuntimeLogRepository:
    """只读取已持久化的错误事实。"""

    def __init__(self, db):
        self.db = db

    async def page(self, *, user_id=None, username=None, uid=None, since=None, until=None, before_id=None, limit=50):
        """按用户及时间筛选，不接受客户端控制排序字段。"""
        q = select(RuntimeErrorLog)
        for col, value in [
            (RuntimeErrorLog.user_id, user_id),
            (RuntimeErrorLog.uid, uid),
            (RuntimeErrorLog.username, username),
        ]:
            if value is not None:
                q = q.where(col == value)
        if since is not None:
            q = q.where(RuntimeErrorLog.created_at >= since)
        if until is not None:
            q = q.where(RuntimeErrorLog.created_at <= until)
        if before_id is not None:
            q = q.where(RuntimeErrorLog.id < before_id)
        rows = (await self.db.scalars(q.order_by(RuntimeErrorLog.id.desc()).limit(limit + 1))).all()
        items = [
            {
                **{
                    k: getattr(row, k)
                    for k in [
                        "id",
                        "user_id",
                        "uid",
                        "username",
                        "source",
                        "operation",
                        "error_code",
                        "message",
                        "correlation_id",
                        "context",
                    ]
                },
                "created_at": format_utc_datetime(row.created_at),
            }
            for row in rows[:limit]
        ]
        return {"items": items, "next_cursor": items[-1]["id"] if len(rows) > limit else None}
