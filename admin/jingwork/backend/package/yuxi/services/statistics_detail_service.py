"""成员使用明细与企业身份目录的只读组合。"""

from uuid import UUID

from yuxi.repositories.statistics_detail_repository import (
    empty_statistics,
    group_statistics_departments,
    statistics_details,
)
from yuxi.services.iam_service import get_iam_config, iam_request


async def get_statistics_details(db, start, end, department_id=None, search=None, mode="members", uid=None):
    """成员按 IAM 稳定用户 ID 关联，未登录账号保留零对话与未知 Token。"""
    config = get_iam_config()
    if mode == "daily" or not config.enabled:
        return await statistics_details(db, start, end, department_id, search, mode, uid)

    result = await statistics_details(db, start, end)
    local = {row["uid"]: row for row in result["items"]}
    response = await iam_request(config, "GET", f"/tenants/{config.tenant_id}/users", params={"page": 1, "size": 500})
    member_total = response["meta"]["total"]
    directory = list(response["items"])
    for page in range(2, (response["meta"]["total"] + 499) // 500 + 1):
        response = await iam_request(
            config, "GET", f"/tenants/{config.tenant_id}/users", params={"page": page, "size": 500}
        )
        directory.extend(response["items"])
    rows = []
    for account in directory:
        member_uid = "iam_" + UUID(str(account["user_id"])).hex
        row = local.pop(
            member_uid, {**empty_statistics(), "uid": member_uid, "department_id": None, "department": None}
        )
        row["username"] = account.get("emp_name") or account["user_name"]
        rows.append(row)
    rows.extend(row for row in local.values() if row["total_messages"] or row["total_model_calls"])
    if department_id is not None:
        rows = [row for row in rows if row["department_id"] == department_id]
    if search:
        query = search.casefold()
        rows = [row for row in rows if query in row["username"].casefold() or query in row["uid"].casefold()]
    if mode == "departments":
        rows = group_statistics_departments(rows)
    return {"items": rows, "total": len(rows), "member_total": member_total}
