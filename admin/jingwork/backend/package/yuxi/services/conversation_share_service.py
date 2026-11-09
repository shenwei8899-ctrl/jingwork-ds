"""统一账号拥有的分享创建、撤销与安全渲染。"""

import hashlib
import secrets
import time
from html import escape
from typing import Literal
from uuid import uuid4
from markdown_it import MarkdownIt
from pydantic import BaseModel, ConfigDict, Field, model_validator
from yuxi.repositories.conversation_share_repository import ConversationShareRepository


class ShareMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=100000)


class ConversationShareCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    messages: list[ShareMessage] = Field(min_length=1, max_length=200)
    expires_days: Literal[1, 7, 30] = 7

    @model_validator(mode="after")
    def limit_bytes(self) -> "ConversationShareCreate":
        if sum(len(m.content.encode("utf-8")) for m in self.messages) > 512000:
            raise ValueError("Shared conversation exceeds 512 KB")
        return self


class ConversationShareService:
    """仅发布用户明确选择的快照，不查询私有历史。"""

    def __init__(self, db):
        self.repo = ConversationShareRepository(db)

    async def create(self, user, body):
        """生成随机公开凭据，数据库只保存摘要。"""
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        row = dict(
            share_id=uuid4().hex,
            user_id=user.id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            title=body.title,
            messages=[m.model_dump() for m in body.messages],
            created_at=now,
            expires_at=now + body.expires_days * 86400,
        )
        await self.repo.create(row)
        return {
            "share_id": row["share_id"],
            "expires_at": row["expires_at"],
            "public_path": "/api/public/conversations/" + token,
        }

    async def listing(self, user, offset):
        """管理列表不返回正文和公开凭据。"""
        rows = await self.repo.listing(user.id, offset)
        return {
            "items": [
                {key: getattr(row, key) for key in ("share_id", "title", "created_at", "expires_at", "revoked_at")}
                for row in rows[:100]
            ],
            "has_more": len(rows) > 100,
        }

    async def revoke(self, user, share):
        """仅作者可以撤销分享。"""
        return await self.repo.revoke(user.id, share, int(time.time()))

    async def render(self, token):
        """将文本 Markdown 安全渲染为独立公开页面。"""
        row = await self.repo.public(hashlib.sha256(token.encode()).hexdigest(), int(time.time()))
        if row is None:
            return None
        title = escape(row.title)
        renderer = MarkdownIt("commonmark", {"html": False}).enable("table").disable("image")
        parts: list[str] = []
        for item in row.messages:
            label = "用户" if item["role"] == "user" else "AI 助手"
            parts.append(
                '<section class="'
                + str(item["role"])
                + '"><h2 class="speaker">'
                + label
                + '</h2><div class="content">'
                + renderer.render(str(item["content"]))
                + "</div></section>"
            )
        return (
            """<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>"""
            + title
            + """ · Jing Work</title><style>
body{margin:0;background:#f6f8fc;color:#263047;font:16px/1.8 system-ui,sans-serif}
main{max-width:840px;margin:auto;padding:40px 20px}
header{color:#6855d8;font-weight:600}
h1{font-size:28px;line-height:1.4;overflow-wrap:anywhere}
.speaker{font-size:14px;color:#778096;margin:0 0 12px}
section{background:white;border:1px solid #e5e9f1;border-radius:16px;padding:24px;margin:20px 0}
.user{background:#eff2ff}
.content{overflow-wrap:anywhere}
.content pre{white-space:pre-wrap;background:#f1f3f9;padding:16px;border-radius:8px;overflow:auto}
.content table{border-collapse:collapse;display:block;overflow:auto}
.content th,.content td{border:1px solid #e5e9f1;padding:6px 12px}
.content a{color:#6855d8}
.content h2{font-size:22px}
.content p:last-child{margin-bottom:0}
footer{font-size:13px;color:#778096}</style></head><body><main><header>竞网蓝鲸 · Jing Work</header><h1>"""
            + title
            + """</h1><p>作者主动分享的对话快照</p>"""
            + "".join(parts)
            + """<footer>由作者分享，内容可能由 AI 生成，请注意甄别。</footer></main></body></html>"""
        )
