"""所有账号模型调用在供应商请求边界执行策略与计费。"""

import json
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import message_to_dict
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from yuxi.services.model_credit_service import reserve_call, settle_call
from yuxi.storage.postgres.manager import pg_manager


class ManagedChatModel(BaseChatModel):
    """后台持有凭据，普通对话、摘要和子智能体共用预占与结算。"""

    model_spec: str
    uid: str
    session_id: str | None = None
    model_kwargs: dict[str, Any] = Field(default_factory=dict)

    @property
    def _llm_type(self):
        return "jing-work-managed"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        """保留工具绑定意图，实际工具适配由后台选择的供应商负责。"""
        return self.bind(tools=tools, tool_choice=tool_choice, **kwargs)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        """统一账号模型调用只支持有额度边界的异步执行。"""
        raise RuntimeError("统一账号模型请使用异步调用")

    async def _prepare(self, messages, kwargs):
        """使用序列化字节数保守预占文本和工具输入，调用前固定输出上限。"""
        from yuxi.models.chat import load_chat_model

        tools = kwargs.pop("tools", None)
        tool_choice = kwargs.pop("tool_choice", None)
        serialized = json.dumps([message_to_dict(message) for message in messages], ensure_ascii=False, default=str)
        input_bound = len(serialized.encode("utf-8")) + len(json.dumps(tools, default=str).encode("utf-8"))
        call_id, spec, output_cap = await reserve_call(
            self.uid, self.model_spec, input_bound, thread_id=self.session_id
        )
        try:
            options = {**self.model_kwargs}
            if output_cap is not None:
                options["max_tokens"] = output_cap
                kwargs.pop("max_tokens", None)
                kwargs.pop("max_completion_tokens", None)
            relay_credentials = None
            if spec.startswith("keenlight:"):
                from fastapi import HTTPException
                from yuxi.services.model_relay_service import member_credentials

                async with pg_manager.get_async_session_context() as db:
                    relay_credentials = await member_credentials(db, self.uid)
                if relay_credentials is None:
                    raise HTTPException(503, "管理员尚未绑定账号的中转站模型权限")
            model = load_chat_model(
                spec,
                session_id=self.session_id,
                uid=self.uid,
                managed=False,
                relay_credentials=relay_credentials,
                **options,
            )
            if tools:
                model = model.bind_tools(tools, **({"tool_choice": tool_choice} if tool_choice is not None else {}))
        except Exception:
            # 模型尚未发起请求，构造失败可释放全部预占。
            await settle_call(call_id, {"input_tokens": 0, "output_tokens": 0})
            raise
        return call_id, model

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        call_id, model = await self._prepare(messages, kwargs)
        usage = None
        try:
            message = await model.ainvoke(messages, config={"callbacks": []}, stop=stop, **kwargs)
            usage = message.usage_metadata
            return ChatResult(generations=[ChatGeneration(message=message)])
        finally:
            await settle_call(call_id, usage)

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs):
        from langchain_core.outputs import ChatGenerationChunk

        call_id, model = await self._prepare(messages, kwargs)
        aggregate = None
        finished = False
        try:
            async for chunk in model.astream(messages, config={"callbacks": []}, stop=stop, **kwargs):
                aggregate = chunk if aggregate is None else aggregate + chunk
                yield ChatGenerationChunk(message=chunk)
            finished = True
        finally:
            usage = aggregate.usage_metadata if finished and aggregate is not None else None
            await settle_call(call_id, usage)
