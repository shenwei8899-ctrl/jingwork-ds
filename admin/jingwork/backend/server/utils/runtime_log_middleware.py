"""采集已认证 API 失败，不保存请求正文、Token 或查询字符串。"""

import asyncio
import logging
from types import SimpleNamespace
from uuid import uuid4
from yuxi.services.runtime_log_service import collect_runtime_error
from yuxi.storage.postgres.manager import pg_manager


class RuntimeLogMiddleware:
    """流式响应不缓冲；HTTP 错误与未处理异常绑定请求 ID。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path", "").startswith("/api/system/runtime-logs"):
            return await self.app(scope, receive, send)
        status = 500
        correlation = uuid4().hex
        error_type = None

        async def forward(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message = {**message, "headers": [*message.get("headers", []), (b"x-request-id", correlation.encode())]}
            await send(message)

        try:
            await self.app(scope, receive, forward)
        except Exception as error:
            error_type = type(error).__name__
            raise
        finally:
            identity = scope.get("state", {}).get("runtime_user")
            user = SimpleNamespace(**identity) if identity else None
            if user is not None and (status >= 400 or error_type):
                route = getattr(scope.get("route"), "path", "/api/unknown")
                event = SimpleNamespace(
                    source="api",
                    operation=f"{scope['method']} {route}",
                    error_code=error_type or f"HTTP_{status}",
                    message=error_type or f"请求失败，HTTP {status}",
                    correlation_id=correlation,
                    actions=[],
                )
                try:
                    async with asyncio.timeout(1):
                        async with pg_manager.get_async_session_context() as db:
                            await collect_runtime_error(db, user, event)
                except Exception as failure:
                    logging.getLogger(__name__).warning("runtime_log_collection_failed type=%s", type(failure).__name__)
