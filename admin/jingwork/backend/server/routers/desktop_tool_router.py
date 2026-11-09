"""管理员工具授权与桌面当前账号读取入口。"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.ext.asyncio import AsyncSession
from server.utils.auth_middleware import get_admin_user, get_db, get_required_user
from yuxi.storage.postgres.models_business import User
from yuxi.services.desktop_tool_service import DesktopToolService

router = APIRouter(prefix="/system/desktop-tools", tags=["desktop-tools"])


class PolicyChange(BaseModel):
    """只允许管理员修改授权，不接收目标身份之外的执行凭据。"""

    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    disabled_tools: list[str] = Field(max_length=500)


class PluginItem(BaseModel):
    """来自桌面注册表的插件工具描述。"""

    name: str = Field(min_length=1, max_length=200)
    label: str = Field(max_length=200)
    category: str = Field(default="plugin", max_length=60)
    source: str = "plugin"


class PluginCatalog(BaseModel):
    """有界插件工具目录。"""

    tools: list[PluginItem] = Field(max_length=500)


@router.get("/members")
async def members(user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """只向管理员返回可管理账号。"""
    return await DesktopToolService(db).members()


@router.get("/me")
async def own(user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """目标身份固定取认证用户，忽略外部账号参数。"""
    return await DesktopToolService(db).read(user.uid)


@router.post("/me/catalog")
async def catalog(items: PluginCatalog, user: User = Depends(get_required_user), db: AsyncSession = Depends(get_db)):
    """登记本人插件目录，不能扩大授权。"""
    return await DesktopToolService(db).register_plugins(
        user.uid, [{**item.model_dump(), "source": "plugin"} for item in items.tools]
    )


@router.get("/members/{uid}")
async def read(uid: str, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """管理员读取指定成员授权。"""
    return await DesktopToolService(db).read(uid)


@router.put("/members/{uid}")
async def save(uid: str, body: PolicyChange, user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """保存逐成员工具授权。"""
    return await DesktopToolService(db).save(uid, body.expected_revision, body.disabled_tools, user.uid)
