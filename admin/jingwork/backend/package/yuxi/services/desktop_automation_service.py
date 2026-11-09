"""本地执行、后台仅同步配置和记录的账号边界。"""

from yuxi.repositories.desktop_automation_repository import DesktopAutomationRepository


async def save_desktop_automation(*, db, uid: str, device_id: str, snapshot: dict) -> dict:
    """事务确认快照后回执，不发布调度或执行请求。"""
    await DesktopAutomationRepository(db).save(uid, device_id, snapshot)
    await db.commit()
    return {"synced": True, "execution_location": "local"}


async def list_desktop_automations(*, db, uid: str) -> dict:
    """当前账号只能读取自己的设备快照。"""
    return {"devices": await DesktopAutomationRepository(db).list(uid)}
