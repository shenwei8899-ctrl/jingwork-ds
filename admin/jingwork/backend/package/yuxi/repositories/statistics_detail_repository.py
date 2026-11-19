"""按成员、部门与北京时间日期聚合桌面对话和企业模型实际用量。"""

from datetime import timedelta

from sqlalchemy import case, distinct, func, select, text, tuple_

from yuxi.storage.postgres.models_business import (
    Department,
    DesktopConversationEvent as Event,
    ModelCreditCall as Call,
    User,
)

COUNT_FIELDS = (
    "sessions",
    "messages",
    "questions",
    "replies",
    "experts",
    "total_sessions",
    "total_questions",
    "total_messages",
    "model_calls",
    "missing_usage_calls",
    "total_model_calls",
    "total_missing_usage_calls",
)
TOKEN_FIELDS = ("input_tokens", "output_tokens", "tokens", "total_tokens")


def empty_statistics():
    """空活动保留零计数，尚无实际用量的 Token 保留缺失值。"""
    return {**dict.fromkeys(COUNT_FIELDS, 0), **dict.fromkeys(TOKEN_FIELDS)}


async def statistics_details(db, start, end, department_id=None, search=None, mode="members", uid=None):
    """查询累计和日期范围统计，日期范围使用 UTC 半开窗口。"""
    if mode == "daily":
        return await _daily_statistics(db, start, end, uid)

    window = (Event.timestamp >= start) & (Event.timestamp < end)
    session_key = tuple_(Event.device_id, Event.agent_id, Event.thread_id)
    events = (
        (
            await db.execute(
                select(
                    Event.user_id,
                    func.count(distinct(session_key)).label("total_sessions"),
                    func.count(Event.id).label("total_messages"),
                    func.count(Event.id).filter(Event.event_type == "user_message").label("total_questions"),
                    func.count(distinct(session_key)).filter(window).label("sessions"),
                    func.count(Event.id).filter(window).label("messages"),
                    func.count(Event.id).filter(window & (Event.event_type == "user_message")).label("questions"),
                    func.count(Event.id).filter(window & (Event.event_type == "assistant_message")).label("replies"),
                    func.count(distinct(Event.agent_id)).filter(window).label("experts"),
                ).group_by(Event.user_id)
            )
        )
        .mappings()
        .all()
    )
    events_by_user = {row["user_id"]: dict(row) for row in events}
    calls = await _call_statistics(db, start, end)
    calls_by_uid = {row["uid"]: row for row in calls}
    statement = select(User.id, User.uid, User.username, User.department_id, Department.name.label("department"))
    statement = statement.outerjoin(Department, User.department_id == Department.id)
    if department_id is not None:
        statement = statement.where(User.department_id == department_id)
    if search:
        statement = statement.where(
            User.username.contains(search, autoescape=True) | User.uid.contains(search, autoescape=True)
        )
    rows = []
    for user in (await db.execute(statement.order_by(User.uid))).mappings():
        row = {
            **empty_statistics(),
            **dict(user),
            **events_by_user.get(user["id"], {}),
            **calls_by_uid.get(user["uid"], {}),
        }
        row.pop("user_id", None)
        rows.append(row)
    if mode == "departments":
        rows = group_statistics_departments(rows)
    return {"items": rows, "total": len(rows)}


def group_statistics_departments(rows):
    """按当前成员列表汇总部门，未知 Token 保留缺失。"""
    grouped = {}
    for row in rows:
        item = grouped.setdefault(
            row["department_id"],
            {
                **{key: value for key, value in empty_statistics().items() if key != "experts"},
                "id": row["department_id"],
                "department": row["department"] or "未分配部门",
                "members": 0,
            },
        )
        item["members"] += 1
        for field in COUNT_FIELDS:
            if field != "experts":
                item[field] += row[field]
        for field in TOKEN_FIELDS:
            if row[field] is not None:
                item[field] = (item[field] or 0) + row[field]
    return list(grouped.values())


async def _daily_statistics(db, start, end, uid):
    """每天补齐零对话，实际 Token 缺失状态逐日保留。"""
    day = func.date(Event.timestamp + text("INTERVAL '8 hours'"))
    events = (
        (
            await db.execute(
                select(
                    day.label("date"),
                    func.count(distinct(tuple_(Event.device_id, Event.agent_id, Event.thread_id))).label("sessions"),
                    func.count(Event.id).label("messages"),
                    func.count(case((Event.event_type == "user_message", 1))).label("questions"),
                    func.count(case((Event.event_type == "assistant_message", 1))).label("replies"),
                )
                .join(User, User.id == Event.user_id)
                .where(User.uid == uid, Event.timestamp >= start, Event.timestamp < end)
                .group_by(day)
            )
        )
        .mappings()
        .all()
    )
    events_by_day = {str(row["date"]): dict(row) for row in events}
    calls = await _call_statistics(db, start, end, uid=uid, daily=True)
    calls_by_day = {str(row["date"]): row for row in calls}
    defaults = dict.fromkeys(("sessions", "messages", "questions", "replies", "model_calls", "missing_usage_calls"), 0)
    defaults.update(input_tokens=None, output_tokens=None, tokens=None)
    rows = []
    current = (start + timedelta(hours=8)).date()
    finish = (end + timedelta(hours=8)).date()
    while current < finish:
        key = current.isoformat()
        rows.append({**defaults, **events_by_day.get(key, {}), **calls_by_day.get(key, {}), "date": key, "uid": uid})
        current += timedelta(days=1)
    return {"items": rows, "total": len(rows)}


async def _call_statistics(db, start, end, uid=None, daily=False):
    """用量独立聚合，避免和同一用户的多条消息相乘。"""
    input_tokens = Call.usage["input_tokens"].as_integer()
    output_tokens = Call.usage["output_tokens"].as_integer()
    reported = input_tokens.isnot(None) & output_tokens.isnot(None)
    window = (Call.created_at >= start) & (Call.created_at < end)
    day = func.date(Call.created_at + text("INTERVAL '8 hours'"))
    group = [Call.uid, day] if daily else [Call.uid]
    columns = [Call.uid, day.label("date")] if daily else [Call.uid]
    columns.extend(
        [
            func.count(Call.id).filter(window).label("model_calls"),
            func.count(Call.id).filter(window & ~reported).label("missing_usage_calls"),
            func.sum(input_tokens).filter(window & reported).label("input_tokens"),
            func.sum(output_tokens).filter(window & reported).label("output_tokens"),
            func.sum(input_tokens + output_tokens).filter(window & reported).label("tokens"),
        ]
    )
    if not daily:
        columns.extend(
            [
                func.count(Call.id).label("total_model_calls"),
                func.count(Call.id).filter(~reported).label("total_missing_usage_calls"),
                func.sum(input_tokens + output_tokens).filter(reported).label("total_tokens"),
            ]
        )
    statement = select(*columns).group_by(*group)
    if daily:
        statement = statement.where(window, Call.uid == uid)
    return [dict(row) for row in (await db.execute(statement)).mappings()]
