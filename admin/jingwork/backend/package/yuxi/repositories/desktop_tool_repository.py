"""PostgreSQL 拥有桌面工具授权和插件目录。"""

import hashlib

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from yuxi.storage.postgres.models_business import ConfigOption, User


class DesktopToolRepository:
    """用既有配置表保存每个账号的工具策略。"""

    def __init__(self, db):
        self.db = db

    async def members(self):
        """只查询未删除用户，返回最小身份字段。"""
        rows = (await self.db.execute(select(User).where(User.is_deleted == 0).order_by(User.uid))).scalars()
        return [{"uid": row.uid, "username": row.username} for row in rows]

    async def read(self, uid):
        """读取账号策略，不读取其他用户的配置。"""
        return (
            await self.db.execute(
                select(ConfigOption).where(
                    ConfigOption.key == "desktop_tools:" + hashlib.sha256(uid.encode()).hexdigest()
                )
            )
        ).scalar_one_or_none()

    async def user_exists(self, uid):
        """已删除账号不接受授权修改。"""
        return (
            await self.db.execute(select(User.uid).where(User.uid == uid, User.is_deleted == 0))
        ).scalar_one_or_none() is not None

    async def locked(self, uid):
        """先保证唯一记录存在，再锁定 owning 行。"""
        key = "desktop_tools:" + hashlib.sha256(uid.encode()).hexdigest()
        await self.db.execute(
            insert(ConfigOption)
            .values(key=key, name="桌面工具授权", description="逐用户工具授权", params={}, value={})
            .on_conflict_do_nothing(index_elements=[ConfigOption.key])
        )
        return (
            await self.db.execute(
                select(ConfigOption)
                .where(ConfigOption.key == key)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()

    async def save(self, uid, revision, disabled, actor):
        """版本冲突时拒绝写入，授权与提交由本用例拥有。"""
        row = await self.locked(uid)
        value = dict(row.value or {})
        if value.get("revision", 0) != revision:
            await self.db.rollback()
            raise HTTPException(409, "授权已更新，请刷新后重试")
        row.value = {**value, "revision": revision + 1, "disabled_tools": disabled}
        row.updated_by = actor
        await self.db.commit()

    async def register_plugins(self, uid, plugins):
        """合并插件目录，保持所有既有禁止授权不变。"""
        row = await self.locked(uid)
        value = dict(row.value or {})
        known = {t["name"]: t for t in value.get("plugins", [])}
        new_names = {t["name"] for t in plugins} - known.keys()
        known.update({t["name"]: t for t in plugins})
        row.value = {
            **value,
            "plugins": list(known.values()),
            "disabled_tools": sorted(set(value.get("disabled_tools", [])) | new_names),
            "revision": value.get("revision", 0) + bool(new_names),
        }
        await self.db.commit()
