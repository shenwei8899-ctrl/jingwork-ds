import uuid
from sqlalchemy import delete
import pytest
from test.integration.api.test_octop_experts import accounts  # noqa: F401
from yuxi.repositories import network_repository as repository
from yuxi.storage.postgres.models_business import ConfigOption


async def test_network_policy(test_client, accounts, monkeypatch):  # noqa: F811
    sessions, _, headers = accounts
    key = "pytest-network-" + uuid.uuid4().hex
    monkeypatch.setattr(repository, "KEY", key)
    ranges = repository.normalize_ranges("10.0.0.12/24,::1,10.0.0.0/24")
    assert ranges == ["10.0.0.0/24", "::1/128"]
    with pytest.raises(ValueError):
        repository.normalize_ranges("not-an-ip")
    async with sessions() as db:
        try:
            await repository.save_policy(db, ranges, "test")
            assert (await repository.read_policy(db))["ranges"] == ranges
            await repository.save_policy(db, [], "test")
            assert (await repository.read_policy(db))["ranges"] == []
        finally:
            await db.execute(delete(ConfigOption).where(ConfigOption.key == key))
            await db.commit()
    assert (
        await test_client.put("/api/system/network", headers=headers[1], json={"allowed_ips": ""})
    ).status_code == 403
