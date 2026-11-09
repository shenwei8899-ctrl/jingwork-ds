from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from yuxi.storage.postgres.models_business import OperationLog


async def log_operation(
    db: AsyncSession,
    user_id: int | None,
    operation: str,
    details: str | None = None,
    request: Request | None = None,
) -> None:
    """把强制审计事实加入当前 owning transaction；失败必须阻止业务提交。"""

    ip_address = request.client.host if request and request.client else None
    db.add(OperationLog(user_id=user_id, operation=operation, details=details, ip_address=ip_address))
    await db.flush()


async def collect_desktop_operation(db, user, event, request):
    """同一账号的来源事件串行去重，不改变既有操作日志结构。"""
    from sqlalchemy import func, select

    key = f"desktop-operation:{user.id}:{event.correlation_id}"
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(key, 0))))
    details = f"desktop:{event.correlation_id}"
    existing = await db.scalar(
        select(OperationLog.id).where(OperationLog.user_id == user.id, OperationLog.details == details)
    )
    if existing is not None:
        await db.commit()
        return {"id": existing}
    row = OperationLog(
        user_id=user.id,
        operation=f"desktop.{event.operation}.{event.outcome}",
        details=details,
        ip_address=request.client.host if request.client else None,
    )
    db.add(row)
    await db.commit()
    return {"id": row.id}
