"""统一模型策略与积分账本的 PostgreSQL 访问边界。"""

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from yuxi.storage.postgres.models_business import (
    ManagedModelPolicy,
    ModelCreditBalance,
    ModelCreditCall,
    User,
    ModelRelayConnection,
    ModelRelayMember,
)


class ModelCreditRepository:
    """策略、月余额和调用记录由调用方事务统一提交。"""

    def __init__(self, db):
        self.db = db

    async def user(self, uid):
        """读取执行账号，停用账号不可使用模型。"""
        return (await self.db.execute(select(User).where(User.uid == uid, User.is_deleted == 0))).scalar_one_or_none()

    async def policies(self):
        """读取不含供应商密钥的管理员策略。"""
        return {row.scope: row.settings for row in (await self.db.execute(select(ManagedModelPolicy))).scalars()}

    async def save_policy(self, scope, settings):
        """按作用域原子替换管理员设置。"""
        await self.db.execute(
            insert(ManagedModelPolicy)
            .values(scope=scope, settings=settings)
            .on_conflict_do_update(index_elements=[ManagedModelPolicy.scope], set_={"settings": settings})
        )

    async def locked_balances(self, uid, period):
        """总是先锁企业余额，再锁成员余额，串行化所有预占与结算。"""
        rows = []
        for scope in ("enterprise", f"user:{uid}"):
            await self.db.execute(
                insert(ModelCreditBalance)
                .values(scope=scope, period=period, spent=0, reserved=0)
                .on_conflict_do_nothing()
            )
            rows.append(
                (
                    await self.db.execute(
                        select(ModelCreditBalance)
                        .where(ModelCreditBalance.scope == scope, ModelCreditBalance.period == period)
                        .with_for_update()
                    )
                ).scalar_one()
            )
        return rows

    async def call(self, call_id, *, lock=False):
        """读取调用事实，结算时加行锁避免重复扣除。"""
        query = select(ModelCreditCall).where(ModelCreditCall.id == call_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return (await self.db.execute(query)).scalar_one_or_none()

    async def calls(self, uid=None, limit=100):
        """按账号返回最近调用，不暴露提示词或凭据。"""
        query = select(ModelCreditCall)
        if uid is not None:
            query = query.where(ModelCreditCall.uid == uid)
        return list((await self.db.execute(query.order_by(ModelCreditCall.created_at.desc()).limit(limit))).scalars())

    async def users(self):
        """成员配置页面只读取账号选择所需的身份。"""
        return list((await self.db.execute(select(User).where(User.is_deleted == 0).order_by(User.id))).scalars())

    async def balances(self, period):
        """读取指定月最终余额供管理界面投影。"""
        return list(
            (await self.db.execute(select(ModelCreditBalance).where(ModelCreditBalance.period == period))).scalars()
        )

    async def relay_connection(self):
        """内部读取管理员连接，不作为响应投影。"""
        return await self.db.get(ModelRelayConnection, "keenlight")

    async def relay_member(self, uid):
        """按执行账号读取成员凭据绑定。"""
        return await self.db.get(ModelRelayMember, uid)

    async def save_relay_connection(self, row):
        """保存连接，事务由业务服务提交。"""
        return await self.db.merge(row)

    async def save_relay_member(self, row):
        """保存成员唯一绑定，事务由业务服务提交。"""
        return await self.db.merge(row)
