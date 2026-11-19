"""桌面对话交付文件的不可变来源与查询。"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from yuxi.storage.postgres.models_business import DesktopConversationEvent as Event, DesktopConversationFile, User


class DesktopConversationFileRepository:
    """文件上传归属于认证用户，管理员读取完整来源键。"""

    def __init__(self, db):
        self.db = db

    async def has_conversation(self, user_id, device_id, agent_id, thread_id):
        """只允许向当前用户已同步的会话添加文件。"""
        return (
            await self.db.scalar(
                select(Event.id)
                .where(
                    Event.user_id == user_id,
                    Event.device_id == device_id,
                    Event.agent_id == agent_id,
                    Event.thread_id == thread_id,
                )
                .limit(1)
            )
            is not None
        )

    async def create_locked(self, values):
        """并发重试锁定同一个不可变来源。"""
        await self.db.execute(insert(DesktopConversationFile).values(**values).on_conflict_do_nothing())
        return await self.db.scalar(
            select(DesktopConversationFile)
            .where(DesktopConversationFile.id == values["id"])
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    async def list(self, uid, device_id, agent_id, thread_id):
        """按生成时间查询选定会话的文件。"""
        return list(
            await self.db.scalars(
                select(DesktopConversationFile)
                .join(User, User.id == DesktopConversationFile.user_id)
                .where(
                    User.uid == uid,
                    DesktopConversationFile.device_id == device_id,
                    DesktopConversationFile.agent_id == agent_id,
                    DesktopConversationFile.thread_id == thread_id,
                )
                .order_by(DesktopConversationFile.timestamp, DesktopConversationFile.id)
            )
        )

    async def get(self, file_id):
        """下载标识只解析数据库拥有的对象。"""
        return await self.db.get(DesktopConversationFile, file_id)
