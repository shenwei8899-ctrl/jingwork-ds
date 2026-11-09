"""桌面已同步聊天素材的成员与部门统计，半开时间窗口。"""

from sqlalchemy import select, func, case, distinct, tuple_, and_
from yuxi.storage.postgres.models_business import User, Department, DesktopConversationEvent as Event


async def statistics_details(db, start, end, department_id=None, search=None, mode="members"):
    aggregate = (
        select(
            Event.user_id,
            func.count(distinct(tuple_(Event.device_id, Event.agent_id, Event.thread_id))).label("sessions"),
            func.count(Event.id).label("messages"),
            func.sum(case((Event.event_type == "user_message", 1), else_=0)).label("questions"),
            func.sum(case((Event.event_type == "assistant_message", 1), else_=0)).label("replies"),
            func.count(distinct(Event.agent_id)).label("experts"),
        )
        .where(and_(Event.timestamp >= start, Event.timestamp < end))
        .group_by(Event.user_id)
        .subquery()
    )
    statement = select(
        User.uid,
        User.username,
        User.department_id,
        Department.name.label("department"),
        func.coalesce(aggregate.c.sessions, 0).label("sessions"),
        func.coalesce(aggregate.c.messages, 0).label("messages"),
        func.coalesce(aggregate.c.questions, 0).label("questions"),
        func.coalesce(aggregate.c.replies, 0).label("replies"),
        func.coalesce(aggregate.c.experts, 0).label("experts"),
    )
    statement = statement.outerjoin(Department, User.department_id == Department.id).outerjoin(
        aggregate, aggregate.c.user_id == User.id
    )
    if department_id is not None:
        statement = statement.where(User.department_id == department_id)
    if search:
        statement = statement.where(
            User.username.contains(search, autoescape=True) | User.uid.contains(search, autoescape=True)
        )
    rows = [dict(row._mapping) for row in (await db.execute(statement.order_by(User.uid))).all()]
    if mode == "departments":
        grouped = {}
        for row in rows:
            item = grouped.setdefault(
                row["department_id"],
                {
                    "id": row["department_id"],
                    "department": row["department"] or "未分配部门",
                    "members": 0,
                    "sessions": 0,
                    "messages": 0,
                    "questions": 0,
                    "replies": 0,
                },
            )
            item["members"] += 1
            for metric in ("sessions", "messages", "questions", "replies"):
                item[metric] += row[metric]
        rows = list(grouped.values())
    return {"items": rows, "total": len(rows)}
