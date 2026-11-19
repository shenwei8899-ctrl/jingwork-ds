"""统计成员与 IAM 目录使用稳定 UUID 关联。"""

from types import SimpleNamespace
from uuid import UUID

import pytest

from yuxi.repositories.statistics_detail_repository import empty_statistics
from yuxi.services import statistics_detail_service as service


@pytest.mark.asyncio
async def test_iam_directory_includes_members_without_local_identity(monkeypatch):
    """零活动目录成员保留，既有日志与姓名由 UUID 对应。"""
    first, second = UUID(int=1), UUID(int=2)
    first_uid = "iam_" + first.hex

    async def statistics(*args):
        return {
            "items": [
                {
                    **empty_statistics(),
                    "uid": first_uid,
                    "username": "旧名字",
                    "department_id": 9,
                    "department": "研发",
                    "total_questions": 3,
                    "total_messages": 4,
                },
                {**empty_statistics(), "uid": "maintenance", "username": "维护", "department_id": None},
            ]
        }

    async def directory(*args, **kwargs):
        return {
            "items": [
                {"user_id": str(first), "emp_name": "员工甲", "user_name": "first"},
                {"user_id": str(second), "emp_name": "员工乙", "user_name": "second"},
            ],
            "meta": {"total": 2},
        }

    monkeypatch.setattr(service, "statistics_details", statistics)
    monkeypatch.setattr(service, "get_iam_config", lambda: SimpleNamespace(enabled=True, tenant_id="test"))
    monkeypatch.setattr(service, "iam_request", directory)
    result = await service.get_statistics_details(None, None, None)
    assert result["total"] == 2
    assert result["items"][0]["username"] == "员工甲"
    assert result["items"][0]["total_questions"] == 3
    assert result["items"][1]["uid"] == "iam_" + second.hex
    assert result["items"][1]["total_questions"] == 0
    assert result["items"][1]["total_tokens"] is None
    filtered = await service.get_statistics_details(None, None, None, search="员工乙")
    assert filtered["total"] == 1
    assert filtered["items"][0]["username"] == "员工乙"
    departments = await service.get_statistics_details(None, None, None, mode="departments")
    assert sum(row["members"] for row in departments["items"]) == result["total"]
    assert sum(row["total_questions"] for row in departments["items"]) == 3
