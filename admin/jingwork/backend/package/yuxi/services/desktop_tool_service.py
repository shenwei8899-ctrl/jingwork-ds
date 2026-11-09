"""桌面工具目录与逐用户授权的用例。"""

from fastapi import HTTPException
from yuxi.repositories.desktop_tool_repository import DesktopToolRepository

BUILTIN_TOOLS = [
    {"name": "ls", "label": "列出目录", "category": "filesystem", "source": "builtin"},
    {"name": "read_file", "label": "读取文件", "category": "filesystem", "source": "builtin"},
    {"name": "write_file", "label": "写入文件", "category": "filesystem", "source": "builtin"},
    {"name": "edit_file", "label": "编辑文件", "category": "filesystem", "source": "builtin"},
    {"name": "glob", "label": "查找文件", "category": "filesystem", "source": "builtin"},
    {"name": "grep", "label": "搜索内容", "category": "filesystem", "source": "builtin"},
    {"name": "execute", "label": "执行指令", "category": "filesystem", "source": "builtin"},
    {"name": "write_todos", "label": "编写计划", "category": "orchestration", "source": "builtin"},
    {"name": "task", "label": "子智能体任务", "category": "orchestration", "source": "builtin"},
    {"name": "current_time", "label": "当前时间", "category": "misc", "source": "builtin"},
    {"name": "web_fetch", "label": "抓取网页", "category": "web", "source": "builtin"},
    {"name": "browser_use", "label": "使用浏览器", "category": "web", "source": "builtin"},
    {"name": "desktop_screenshot", "label": "桌面截图", "category": "web", "source": "builtin"},
    {"name": "send_file_to_user", "label": "发送文件", "category": "misc", "source": "builtin"},
    {"name": "read_env_file", "label": "读取环境变量", "category": "misc", "source": "builtin"},
    {"name": "write_env_file", "label": "写入环境变量", "category": "misc", "source": "builtin"},
    {"name": "ask_user_question", "label": "向你提问", "category": "interaction", "source": "builtin"},
    {"name": "tavily_search", "label": "Tavily 联网搜索", "category": "web", "source": "builtin"},
    {"name": "brave_search", "label": "Brave 联网搜索", "category": "web", "source": "builtin"},
    {"name": "google_search", "label": "Google 联网搜索", "category": "web", "source": "builtin"},
    {"name": "kimi_search", "label": "Kimi 联网搜索", "category": "web", "source": "builtin"},
    {"name": "searchfree_search", "label": "AI 联网搜索", "category": "web", "source": "builtin"},
    {"name": "generate_image", "label": "生成图片", "category": "media", "source": "builtin"},
    {"name": "generate_video", "label": "生成视频", "category": "media", "source": "builtin"},
    {"name": "memory_search", "label": "检索记忆", "category": "memory", "source": "builtin"},
    {"name": "memory_get", "label": "读取记忆", "category": "memory", "source": "builtin"},
    {"name": "acp_runner", "label": "ACP 外部 Agent", "category": "misc", "source": "builtin"},
    {"name": "cronjob_list", "label": "列出定时任务", "category": "cron", "source": "builtin"},
    {"name": "cronjob_get", "label": "查看定时任务", "category": "cron", "source": "builtin"},
    {"name": "cronjob_create", "label": "创建定时任务", "category": "cron", "source": "builtin"},
    {"name": "cronjob_update", "label": "更新定时任务", "category": "cron", "source": "builtin"},
    {"name": "cronjob_delete", "label": "删除定时任务", "category": "cron", "source": "builtin"},
    {"name": "cronjob_run_now", "label": "立即执行定时任务", "category": "cron", "source": "builtin"},
    {"name": "search_knowledge", "label": "检索知识库", "category": "knowledge", "source": "builtin"},
    {"name": "mobile_screenshot", "label": "手机截图", "category": "mobile", "source": "builtin"},
    {"name": "mobile_tap", "label": "手机点击", "category": "mobile", "source": "builtin"},
    {"name": "mobile_swipe", "label": "手机滑动", "category": "mobile", "source": "builtin"},
    {"name": "mobile_launch_app", "label": "启动手机应用", "category": "mobile", "source": "builtin"},
    {"name": "mobile_ui_dump", "label": "手机界面结构", "category": "mobile", "source": "builtin"},
    {"name": "mobile_handoff_to_user", "label": "交给用户操作（手机）", "category": "mobile", "source": "builtin"},
    {"name": "agent_list", "label": "列出专家", "category": "teams", "source": "builtin"},
    {"name": "ask_agent", "label": "咨询专家", "category": "teams", "source": "builtin"},
]


class DesktopToolService:
    """管理员授予能力，用户的智能体开关只能缩小能力。"""

    def __init__(self, db):
        self.repo = DesktopToolRepository(db)

    async def members(self):
        """返回管理员页面所需的成员标识。"""
        return await self.repo.members()

    async def read(self, uid):
        """返回该账号的工具目录和明确授权状态。"""
        row = await self.repo.read(uid)
        value = row.value if row else {}
        catalog = BUILTIN_TOOLS + value.get("plugins", [])
        disabled = set(value.get("disabled_tools", []))
        return {
            "uid": uid,
            "revision": value.get("revision", 0),
            "disabled_tools": sorted(disabled),
            "tools": [{**tool, "authorized": tool["name"] not in disabled} for tool in catalog],
        }

    async def save(self, uid, revision, disabled, actor):
        """比较版本后替换授权，避免管理员覆盖其他人的并发修改。"""
        if not await self.repo.user_exists(uid):
            raise HTTPException(404, "账号不存在")
        value = await self.read(uid)
        known = {t["name"] for t in value["tools"]}
        if set(disabled) - known:
            raise HTTPException(422, "包含未登记的工具")
        await self.repo.save(uid, revision, sorted(set(disabled)), actor)
        return await self.read(uid)

    async def register_plugins(self, uid, plugins):
        """桌面仅登记自己的插件目录，不能修改授权。"""
        if {tool["name"] for tool in plugins} & {tool["name"] for tool in BUILTIN_TOOLS}:
            raise HTTPException(422, "插件工具不能覆盖内置工具")
        await self.repo.register_plugins(uid, plugins)
        return await self.read(uid)
