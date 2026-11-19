"""企业研效的桌面对话与模型调用独立聚合。"""

from sqlalchemy import case, distinct, func, select, text, tuple_

from yuxi.storage.postgres.models_business import DesktopConversationEvent as Event, ModelCreditCall as Call, User


class EnterpriseProductivityRepository:
    """所有期间查询使用同一个 UTC 半开窗口。"""

    def __init__(self, db):
        self.db = db

    async def daily_activity(self, start, end):
        """按北京时间汇总事件、去重成员、会话及独立调用用量。"""
        day = func.date(Event.timestamp + text("INTERVAL '8 hours'"))
        events = (
            (
                await self.db.execute(
                    select(
                        day.label("date"),
                        func.count(Event.id).label("messages"),
                        func.count(case((Event.event_type == "user_message", 1))).label("questions"),
                        func.count(distinct(Event.user_id)).label("active_users"),
                        func.count(
                            distinct(tuple_(Event.user_id, Event.device_id, Event.agent_id, Event.thread_id))
                        ).label("sessions"),
                    )
                    .join(User, User.id == Event.user_id)
                    .where(Event.timestamp >= start, Event.timestamp < end)
                    .group_by(day)
                )
            )
            .mappings()
            .all()
        )
        call_day = func.date(Call.created_at + text("INTERVAL '8 hours'"))
        input_tokens = Call.usage["input_tokens"].as_integer()
        output_tokens = Call.usage["output_tokens"].as_integer()
        reported = input_tokens.isnot(None) & output_tokens.isnot(None)
        calls = (
            (
                await self.db.execute(
                    select(
                        call_day.label("date"),
                        func.count(Call.id).label("model_calls"),
                        func.count(Call.id).filter(~reported).label("missing_usage_calls"),
                        func.sum(input_tokens + output_tokens).filter(reported).label("tokens"),
                    )
                    .where(Call.created_at >= start, Call.created_at < end)
                    .group_by(call_day)
                )
            )
            .mappings()
            .all()
        )
        by_day = {str(row["date"]): dict(row) for row in events}
        for row in calls:
            by_day.setdefault(str(row["date"]), {}).update(dict(row))
        return by_day

    async def expert_distribution(self, start, end):
        """按日志专家标识分组，保留跨用户及设备的完整会话键。"""
        rows = (
            (
                await self.db.execute(
                    select(
                        Event.agent_id,
                        func.max(Event.agent_name).label("agent_name"),
                        func.count(
                            distinct(tuple_(Event.user_id, Event.device_id, Event.agent_id, Event.thread_id))
                        ).label("sessions"),
                        func.count(case((Event.event_type == "user_message", 1))).label("questions"),
                        func.count(Event.id).label("messages"),
                    )
                    .join(User, User.id == Event.user_id)
                    .where(Event.timestamp >= start, Event.timestamp < end)
                    .group_by(Event.agent_id)
                    .order_by(func.count(Event.id).desc(), Event.agent_id)
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    async def model_usage(self, start, end):
        """每个模型只累计实际调用 usage，缓存包含在输入总数中。"""
        input_tokens = Call.usage["input_tokens"].as_integer()
        output_tokens = Call.usage["output_tokens"].as_integer()
        reported = input_tokens.isnot(None) & output_tokens.isnot(None)
        rows = (
            (
                await self.db.execute(
                    select(
                        Call.model_spec,
                        func.count(Call.id).label("calls"),
                        func.count(Call.id).filter(~reported).label("missing_usage_calls"),
                        func.sum(input_tokens).filter(reported).label("input_tokens"),
                        func.sum(output_tokens).filter(reported).label("output_tokens"),
                        func.sum(input_tokens + output_tokens).filter(reported).label("tokens"),
                    )
                    .where(Call.created_at >= start, Call.created_at < end)
                    .group_by(Call.model_spec)
                    .order_by(func.count(Call.id).desc(), Call.model_spec)
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]
