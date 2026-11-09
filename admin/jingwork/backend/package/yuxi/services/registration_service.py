"""公开注册普通账号的事务 Owner。"""

import hashlib
import re

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.repositories.user_repository import UserRepository
from yuxi.repositories.department_repository import DepartmentRepository
from yuxi.services.operation_log_service import log_operation
from yuxi.storage.redis import get_async_redis_client
from yuxi.utils.auth_utils import AuthUtils


class RegistrationError(Exception):
    """注册无法完成，携带公开原因与 HTTP 状态。"""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


async def register_account(db: AsyncSession, *, uid: str, password: str, client_ip: str) -> dict[str, str]:
    """限速后创建默认部门下无管理权限的账号，提交成功才返回。"""
    uid = uid.strip()
    if not uid:
        raise RegistrationError("请输入账号名称", 422)
    if not re.search(r"[a-zA-Z]", password) or not re.search(r"[0-9]", password):
        raise RegistrationError("密码需包含字母和数字", 422)
    redis = await get_async_redis_client()
    ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()
    attempts = await redis.eval(
        "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end; return n",
        1,
        f"yuxi:registration:ip:{ip_hash}",
    )
    if attempts > 10:
        raise RegistrationError("注册操作过于频繁，请稍后再试", 429)
    repo = UserRepository(db)
    if await repo.is_first_run():
        raise RegistrationError("系统尚未初始化，请联系管理员", 503)
    department = await DepartmentRepository(db).get_by_name("默认部门")
    if department is None:
        raise RegistrationError("注册部门尚未配置，请联系管理员", 503)
    if await repo.get_by_login_identifier(uid) or await repo.get_by_username(uid):
        raise RegistrationError("该账号 ID 已被使用", 409)
    try:
        user = await repo.create(
            {
                "uid": uid,
                "username": uid,
                "password_hash": AuthUtils.hash_password(password),
                "role": "user",
                "department_id": department.id,
            }
        )
        await log_operation(db, user.id, "注册账号", "自行注册普通账号")
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise RegistrationError("该账号 ID 已被使用", 409) from exc
    return {"uid": uid}
