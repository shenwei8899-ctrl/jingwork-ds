"""真实 PostgreSQL 企业资料保存、稳定标识与校验。"""

import uuid
from sqlalchemy import delete
from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.repositories import company_repository
from yuxi.storage.postgres.models_business import ConfigOption
from server.routers.system_router import CompanyProfile
import pytest
from pydantic import ValidationError


async def test_company_profile(test_client, accounts, monkeypatch):  # noqa: F811
    sessions, _, headers = accounts
    key = "pytest-company-" + uuid.uuid4().hex
    monkeypatch.setattr(company_repository, "KEY", key)
    async with sessions() as db:
        try:
            body = CompanyProfile(
                name="测试企业", contacts=[{"name": "联系人", "email": "test@example.com"}]
            ).model_dump()
            saved = await company_repository.save_company(db, body, "test")
            assert saved["id"]
            reread = await company_repository.read_company(db)
            assert reread == saved
            body["name"] = "更新企业"
            updated = await company_repository.save_company(db, body, "test")
            assert updated["id"] == saved["id"]
            assert updated["name"] == "更新企业"
        finally:
            await db.execute(delete(ConfigOption).where(ConfigOption.key == key))
            await db.commit()
    with pytest.raises(ValidationError):
        CompanyProfile(name="测试企业", contacts=[{"name": "联系人", "email": "invalid"}])
    with pytest.raises(ValidationError):
        CompanyProfile(name="测试企业", contacts=[{"name": "联系人"}] * 31)
    assert (await test_client.get("/api/system/company")).status_code == 401
    assert (await test_client.get("/api/system/company", headers=headers[1])).status_code == 403
