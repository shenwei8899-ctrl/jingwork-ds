"""运行错误采集：身份来自认证，正文与凭据不进入日志。"""

import re
from datetime import timedelta
from sqlalchemy import func, select
from fastapi import HTTPException
from yuxi.storage.postgres.models_business import RuntimeErrorLog
from yuxi.utils.datetime_utils import utc_now_naive


def redact_error(value: str) -> str:
    """移除常见凭据、查询参数及控制字符，限制日志大小。"""
    value = re.sub(r"(?i)(bearer\s+)[^\s,;]+", r"\1[REDACTED]", value)
    value = re.sub(
        r"(?i)((?:api[_-]?key|token|password|secret|authorization)\s*[=:]\s*)[^\s,;]+", r"\1[REDACTED]", value
    )
    value = re.sub(r"(?:sk-|yxkey_)[A-Za-z0-9_-]+", "[REDACTED]", value)
    value = re.sub(r"https?://[^\s]+", "[URL]", value)
    return "".join(c for c in value if c >= " " or c == "\n")[:2000]


async def collect_runtime_error(db, user, event):
    """普通账号仅能写入自身日志，每分钟最多一百条。"""
    if event.source == "desktop" and event.correlation_id:
        key = f"desktop-runtime:{user.id}:{event.correlation_id}"
        await db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key, 0))))
        existing = await db.scalar(
            select(RuntimeErrorLog.id).where(
                RuntimeErrorLog.user_id == user.id,
                RuntimeErrorLog.source == "desktop",
                RuntimeErrorLog.correlation_id == event.correlation_id,
            )
        )
        if existing is not None:
            await db.commit()
            return {"id": existing}
    cutoff = utc_now_naive() - timedelta(minutes=1)
    count = await db.scalar(
        select(func.count())
        .select_from(RuntimeErrorLog)
        .where(RuntimeErrorLog.user_id == user.id, RuntimeErrorLog.created_at >= cutoff)
    )
    if count >= 100:
        raise HTTPException(429, "系统日志上报过于频繁")
    row = RuntimeErrorLog(
        user_id=user.id,
        uid=str(user.uid),
        username=user.username,
        source=event.source,
        operation=redact_error(event.operation),
        error_code=redact_error(event.error_code),
        message=redact_error(event.message),
        correlation_id=event.correlation_id,
        context={
            "actions": [redact_error(x) for x in event.actions],
            "reported_by": "server" if event.source == "api" else "client",
        },
    )
    db.add(row)
    await db.commit()
    return {"id": row.id}
