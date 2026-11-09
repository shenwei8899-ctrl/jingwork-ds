"""统一账号的对话分享 HTTP 接口。"""

from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from server.utils.auth_middleware import get_current_user, get_db
from yuxi.storage.postgres.models_business import User
from yuxi.services.conversation_share_service import ConversationShareCreate, ConversationShareService

conversation_shares = APIRouter(tags=["对话分享"])


async def share_author(user: User | None = Depends(get_current_user)) -> User:
    """分享管理必须具备有效登录身份。"""
    if user is None:
        raise HTTPException(401, "请先登录")
    return user


@conversation_shares.post("/system/conversation-shares", status_code=201)
async def create(body: ConversationShareCreate, user: User = Depends(share_author), db: AsyncSession = Depends(get_db)):
    """发布当前用户明确选择的问答快照。"""
    return await ConversationShareService(db).create(user, body)


@conversation_shares.get("/system/conversation-shares")
async def listing(
    offset: int = Query(0, ge=0, le=1000000), user: User = Depends(share_author), db: AsyncSession = Depends(get_db)
):
    """查询自己的分享记录。"""
    return await ConversationShareService(db).listing(user, offset)


@conversation_shares.delete("/system/conversation-shares/{share}")
async def revoke(share: str, user: User = Depends(share_author), db: AsyncSession = Depends(get_db)):
    """撤销本人创建的分享并清除快照正文。"""
    if not await ConversationShareService(db).revoke(user, share):
        raise HTTPException(404, "分享不存在")
    return {"ok": True}


@conversation_shares.get("/public/conversations/{token}", response_class=HTMLResponse)
async def public(token: Annotated[str, Path(pattern=r"^[A-Za-z0-9_-]{43}$")], db: AsyncSession = Depends(get_db)):
    """匿名查看有效快照，禁止脚本、外部图片及搜索引擎收录。"""
    content = await ConversationShareService(db).render(token)
    return HTMLResponse(
        content or '<!doctype html><meta charset="utf-8"><h1>分享链接已失效</h1>',
        status_code=200 if content else 404,
        headers={
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow",
            "Content-Security-Policy": (
                "default-src 'none'; style-src 'unsafe-inline'; "
                "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            ),
        },
    )
