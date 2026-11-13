"""企业 IAM 登录回调、会话恢复与只读目录接口。"""

from typing import Literal
from urllib.parse import urlencode, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from server.utils.auth_middleware import get_admin_user, get_db, get_required_user, verify_api_key
from yuxi.services.iam_service import (
    complete_login,
    create_login_state,
    get_iam_config,
    get_iam_device_session,
    iam_failure,
    iam_request,
    logout_iam_session,
)
from yuxi.storage.postgres.models_business import User

iam = APIRouter(prefix="/auth/iam", tags=["enterprise identity"])


@iam.get("/config")
async def iam_config():
    """只向浏览器提供公开登录入口与启用状态。"""
    config = get_iam_config()
    return {
        "enabled": config.enabled,
        "login_url": config.app_url.rstrip("/") + "/api/auth/iam/login" if config.enabled else "",
        "password_reset_url": config.public_web_url.rstrip("/") + "/iam/v1/oauth2/password-reset"
        if config.enabled
        else "",
    }


@iam.get("/login")
async def iam_login(redirect: str = "/enterprise"):
    """发起浏览器绑定的 IAM 授权码登录。"""
    config = get_iam_config()
    if not config.enabled:
        raise HTTPException(404)
    state, location = await create_login_state(config, redirect)
    response = RedirectResponse(location, status_code=302)
    response.set_cookie(
        "jingwork_iam_state",
        state,
        max_age=config.state_ttl_seconds,
        secure=True,
        httponly=True,
        samesite="lax",
        path=config.cookie_path,
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@iam.get("/callback")
async def iam_callback(request: Request):
    """消费授权码并以无授权码地址恢复前端会话。"""
    config = get_iam_config()
    if not config.enabled:
        raise HTTPException(404)
    code = request.query_params.get("IAM_Code", "")
    state = request.query_params.get("state", "")
    issuer = request.query_params.get("iss")
    # ASGI 访问日志只记录无查询参数的回调路径。
    request.scope["query_string"] = b""
    try:
        if issuer and issuer != config.issuer_url:
            raise iam_failure(400, "iam_issuer_invalid", "企业登录来源校验失败")
        session_id, redirect = await complete_login(
            config,
            code,
            state,
            request.cookies.get("jingwork_iam_state", ""),
        )
    except HTTPException as error:
        target = "/forbidden?iam_denied=1" if error.status_code == 403 else "/login?iam_error=1"
        response = RedirectResponse(config.app_url.rstrip("/") + target, status_code=302)
    else:
        location = config.app_url.rstrip("/") + "/auth/iam/callback?" + urlencode({"redirect": redirect})
        response = RedirectResponse(location, status_code=302)
        response.set_cookie(
            "jingwork_iam_session",
            session_id,
            max_age=config.session_ttl_seconds,
            secure=True,
            httponly=True,
            samesite="strict",
            path=config.cookie_path,
        )
    response.delete_cookie("jingwork_iam_state", path=config.cookie_path, secure=True, httponly=True)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@iam.get("/session")
async def iam_session(request: Request, user: User = Depends(get_required_user)):
    """返回非凭据标记和用户展示字段，IAM Token 保留在服务端。"""
    if not getattr(request.state, "iam_identity", None):
        raise iam_failure(401, "iam_session_required", "请先完成企业统一登录")
    identity = request.state.iam_identity
    response = JSONResponse(
        {
            "access_token": "iam_cookie",
            "user_id": user.id,
            "uid": user.uid,
            "username": identity.emp_name or identity.emp_id,
            "role": user.role,
            "department_id": user.department_id,
            "avatar": user.avatar,
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@iam.post("/logout")
async def iam_logout(request: Request, db: AsyncSession = Depends(get_db)):
    """按 IAM 文档全平台吊销用户主动退出的会话。"""
    config = get_iam_config()
    expected = urlsplit(config.app_url)
    if not config.enabled:
        raise HTTPException(404)
    authorization = request.headers.get("authorization", "")
    expected_uid = None
    if authorization.startswith("Bearer yxkey_"):
        secret = authorization.removeprefix("Bearer ")
        user, key = await verify_api_key(secret, db)
        if user is None or key is None:
            raise iam_failure(401, "iam_device_expired", "设备登录已失效，请重新登录")
        expected_uid = user.uid
        session_id = await get_iam_device_session(secret)
    else:
        if request.headers.get("origin") != f"{expected.scheme}://{expected.netloc}":
            raise iam_failure(403, "iam_origin_denied", "请求来源校验失败")
        session_id = request.cookies.get("jingwork_iam_session")
    if session_id:
        await logout_iam_session(session_id, config, expected_uid=expected_uid)
    response = JSONResponse({"ok": True})
    response.delete_cookie("jingwork_iam_session", path=config.cookie_path, secure=True, httponly=True)
    response.headers["Cache-Control"] = "no-store"
    return response


@iam.get("/directory/{resource}")
async def iam_directory(
    resource: Literal["users", "emps", "orgs"],
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=500),
    user: User = Depends(get_admin_user),
):
    """按服务端固定租户查询 IAM 分页目录。"""
    config = get_iam_config()
    if not config.enabled:
        raise HTTPException(404)
    return await iam_request(
        config, "GET", f"/tenants/{config.tenant_id}/{resource}", params={"page": page, "size": size}
    )


@iam.get("/tenant")
async def iam_tenant(user: User = Depends(get_admin_user)):
    """读取当前接入企业的权威租户信息。"""
    config = get_iam_config()
    if not config.enabled:
        raise HTTPException(404)
    return await iam_request(config, "GET", f"/tenants/{config.tenant_id}")
