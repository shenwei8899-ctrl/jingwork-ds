"""企业看板使用与日志、成员明细一致的计数来源。"""

from datetime import UTC, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.desktop_conversation_repository import DesktopConversationRepository
from yuxi.repositories.enterprise_productivity_repository import EnterpriseProductivityRepository
from yuxi.services.statistics_detail_service import get_statistics_details
from yuxi.utils.datetime_utils import format_utc_datetime, utc_now_naive


async def get_enterprise_productivity(db, time_range="30days", *, now=None):
    """在独立只读快照中汇总累计、期间、趋势和排行。"""
    async with AsyncSession(bind=db.bind) as snapshot:
        await snapshot.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        await snapshot.execute(text("SET TRANSACTION READ ONLY"))
        return await _assemble_productivity(snapshot, time_range, now)


async def _assemble_productivity(db, time_range, now):
    """所有数据库读数共享快照和统计截止时间。"""
    now = now or utc_now_naive()
    if now.tzinfo is not None:
        now = now.astimezone(UTC).replace(tzinfo=None)
    days = {"7days": 7, "14days": 14, "30days": 30, "90days": 90}[time_range]
    local_day = (now + timedelta(hours=8)).replace(hour=0, minute=0, second=0, microsecond=0)
    start = local_day - timedelta(days=days - 1, hours=8)
    end = now + timedelta(microseconds=1)
    details = await get_statistics_details(db, start, end)
    members = details["items"]
    archive = await DesktopConversationRepository(db).overview(now=now)
    summary = {
        "sessions": archive["total_conversations"],
        "questions": archive["total_questions"],
        "messages": archive["total_messages"],
        "members": details.get("member_total", archive["total_users"]),
        "active_users_30d": archive["active_users_30d"],
        "missing_usage_calls": sum(row["total_missing_usage_calls"] for row in members),
    }
    period = {
        field: sum(row[field] for row in members)
        for field in ("sessions", "questions", "messages", "model_calls", "missing_usage_calls")
    }
    period["active_users"] = sum(row["messages"] > 0 for row in members)
    for field in ("input_tokens", "output_tokens", "tokens", "total_tokens"):
        values = [row[field] for row in members if row[field] is not None]
        value = sum(values) if values else None
        if field == "total_tokens":
            summary["tokens"] = value
        else:
            period[field] = value

    repo = EnterpriseProductivityRepository(db)
    by_day = await repo.daily_activity(start, end)
    daily = []
    for offset in range(days):
        date = (local_day - timedelta(days=days - 1 - offset)).date().isoformat()
        daily.append(
            {
                "messages": 0,
                "questions": 0,
                "active_users": 0,
                "sessions": 0,
                "tokens": None,
                "model_calls": 0,
                "missing_usage_calls": 0,
                **by_day.get(date, {}),
                "date": date,
            }
        )
    active = [row for row in members if row["messages"] or row["model_calls"]]
    active.sort(key=lambda row: (-row["questions"], -row["sessions"], row["uid"]))
    fields = ("uid", "username", "questions", "sessions", "tokens", "missing_usage_calls")
    return {
        "summary": summary,
        "period": period,
        "daily": daily,
        "top_members": [{field: row[field] for field in fields} for row in active[:10]],
        "experts": await repo.expert_distribution(start, end),
        "models": await repo.model_usage(start, end),
        "start": format_utc_datetime(start),
        "end": format_utc_datetime(now),
        "generated_at": format_utc_datetime(now),
        "last_received_at": archive["last_received_at"],
    }
