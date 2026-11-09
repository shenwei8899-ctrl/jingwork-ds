"""对话分享的持久化和账号可见性边界。"""

from sqlalchemy import select, update
from yuxi.storage.postgres.models_business import ConversationShare, User


class ConversationShareRepository:
    """读写不可变快照，所有管理操作绑定认证用户。"""

    def __init__(self, db):
        self.db = db

    async def create(self, row):
        """提交后才向调用者返回链接。"""
        self.db.add(ConversationShare(**row))
        await self.db.commit()

    async def listing(self, user_id, offset):
        """分页读取当前用户的分享元信息。"""
        result = await self.db.execute(
            select(ConversationShare)
            .where(ConversationShare.user_id == user_id)
            .order_by(ConversationShare.created_at.desc(), ConversationShare.share_id.desc())
            .offset(offset)
            .limit(101)
        )
        return list(result.scalars())

    async def revoke(self, user_id, share_id, now):
        """撤销保留记录，同时清除正文；他人无法操作。"""
        result = await self.db.execute(
            update(ConversationShare)
            .where(ConversationShare.user_id == user_id, ConversationShare.share_id == share_id)
            .values(revoked_at=now, messages=[])
            .returning(ConversationShare.share_id)
        )
        found = result.scalar_one_or_none()
        await self.db.commit()
        return found is not None

    async def public(self, token_hash, now):
        """公开读取仍检查作者未删除、链接未撤销且未过期。"""
        return await self.db.scalar(
            select(ConversationShare)
            .join(User, User.id == ConversationShare.user_id)
            .where(
                ConversationShare.token_hash == token_hash,
                ConversationShare.revoked_at.is_(None),
                ConversationShare.expires_at > now,
                User.is_deleted == 0,
            )
        )
