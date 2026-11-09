"""按账号和设备隔离保存本地自动化快照。"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from yuxi.storage.postgres.models_business import DesktopAutomationSnapshot
from yuxi.utils.datetime_utils import utc_now_naive


class DesktopAutomationRepository:
    """只写快照表，不创建任何服务端执行任务。"""

    def __init__(self, db):
        self.db = db

    async def save(self, uid: str, device_id: str, snapshot: dict) -> None:
        statement = insert(DesktopAutomationSnapshot).values(
            uid=uid, device_id=device_id, snapshot=snapshot, updated_at=utc_now_naive()
        )
        await self.db.execute(
            statement.on_conflict_do_update(
                index_elements=["uid", "device_id"],
                set_={"snapshot": statement.excluded.snapshot, "updated_at": statement.excluded.updated_at},
            )
        )

    async def list(self, uid: str):
        result = await self.db.scalars(select(DesktopAutomationSnapshot).where(DesktopAutomationSnapshot.uid == uid))
        return [{"device_id": row.device_id, "snapshot": row.snapshot} for row in result]
