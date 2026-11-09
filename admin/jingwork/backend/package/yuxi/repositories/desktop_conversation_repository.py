"""后台拥有的桌面原始素材副本与会话查询。"""

from datetime import UTC

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.storage.postgres.models_business import DesktopConversationEvent as Event, User
from yuxi.utils.datetime_utils import format_utc_datetime


class DesktopConversationRepository:
    """同步只能写当前用户，管理员读取按 UID 和完整会话键区分。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def ingest(self, user: User, device_id: str, agent_id: str, agent_name: str, events: list[dict]) -> int:
        """相同来源事件重试不重复写入，认证身份不能被请求字段覆盖。"""
        rows = [
            {
                **event,
                "user_id": user.id,
                "device_id": device_id,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "timestamp": event["timestamp"].astimezone(UTC).replace(tzinfo=None),
                "thread_id": event.get("thread_id") or event["event_id"],
            }
            for event in events
        ]
        result = await self.db.execute(
            insert(Event)
            .values(rows)
            .on_conflict_do_nothing(constraint="uq_desktop_conversation_source")
            .returning(Event.id)
        )
        count = len(result.scalars().all())
        await self.db.commit()
        return count

    async def catalog(self) -> dict:
        """仅从已落库的素材列出用户及专家，客户端离线不影响查询。"""
        rows = (
            await self.db.execute(
                select(User.uid, User.username, Event.agent_id, func.max(Event.agent_name).label("name"))
                .join(Event, Event.user_id == User.id)
                .group_by(User.uid, User.username, Event.agent_id)
                .order_by(User.username)
            )
        ).all()
        users = {}
        for row in rows:
            user = users.setdefault(row.uid, {"uid": row.uid, "username": row.username, "agents": []})
            user["agents"].append({"id": row.agent_id, "name": row.name})
        return {"users": list(users.values())}

    async def sessions(
        self,
        uid: str | None,
        agent_id: str | None,
        query: str | None,
        offset: int,
        limit: int,
        *,
        department_id: int | None = None,
        role: str | None = None,
    ) -> dict:
        """按真实会话聚合，内容搜索选择匹配会话而不截断聊天上下文。"""
        statement = select(
            User.uid,
            User.username,
            Event.device_id,
            Event.agent_id,
            Event.thread_id,
            func.max(Event.agent_name).label("agent_name"),
            func.max(Event.timestamp).label("timestamp"),
            func.max(Event.received_at).label("received_at"),
            func.count(Event.id).label("message_count"),
            func.max(case((Event.event_type == "user_message", Event.content), else_=None)).label("question"),
        )
        statement = statement.join(User, User.id == Event.user_id)
        if department_id is not None:
            statement = statement.where(User.department_id == department_id)
        if role is not None:
            statement = statement.where(User.role == role)
        if uid:
            statement = statement.where(User.uid == uid)
        if agent_id:
            statement = statement.where(Event.agent_id == agent_id)
        statement = statement.group_by(User.uid, User.username, Event.device_id, Event.agent_id, Event.thread_id)
        if query:
            statement = statement.having(func.count(case((Event.content.contains(query, autoescape=True), 1))) > 0)
        total = await self.db.scalar(select(func.count()).select_from(statement.subquery()))
        rows = (
            await self.db.execute(
                statement.order_by(func.max(Event.timestamp).desc(), Event.thread_id, Event.device_id)
                .offset(offset)
                .limit(limit)
            )
        ).all()
        items = [
            {
                **dict(row._mapping),
                "timestamp": format_utc_datetime(row.timestamp),
                "received_at": format_utc_datetime(row.received_at),
            }
            for row in rows
        ]
        return {"items": items, "total": total}

    async def messages(self, uid: str, device_id: str, agent_id: str, thread_id: str, offset: int, limit: int) -> dict:
        """完整来源键防止同名线程跨用户或设备合并，按原始时间阅读。"""
        statement = (
            select(Event)
            .join(User, User.id == Event.user_id)
            .where(
                User.uid == uid, Event.device_id == device_id, Event.agent_id == agent_id, Event.thread_id == thread_id
            )
        )
        total = await self.db.scalar(select(func.count()).select_from(statement.subquery()))
        rows = (await self.db.scalars(statement.order_by(Event.timestamp, Event.id).offset(offset).limit(limit))).all()
        return {
            "items": [
                {
                    "id": row.id,
                    "event_type": row.event_type,
                    "content": row.content,
                    "timestamp": format_utc_datetime(row.timestamp),
                }
                for row in rows
            ],
            "total": total,
        }
