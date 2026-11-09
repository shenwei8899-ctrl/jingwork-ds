"""企业资料在现有管理员配置表中的持久存储。"""

from uuid import uuid4
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from yuxi.storage.postgres.models_business import ConfigOption

KEY = "enterprise_company_profile"
DEFAULT = {"id": None, "name": "竞网蓝鲸", "industry": "", "size": "", "domain": "", "email_suffix": "", "contacts": []}


async def read_company(db):
    value = await db.scalar(select(ConfigOption.value).where(ConfigOption.key == KEY))
    return {**DEFAULT, **(value or {})}


async def save_company(db, body, operator):
    # Lock existing record; preserve server-owned identity across edits.
    record = await db.scalar(select(ConfigOption).where(ConfigOption.key == KEY).with_for_update())
    value = {**body, "id": (record.value or {}).get("id") if record else str(uuid4())}
    if record:
        record.value = value
        record.updated_by = operator
    else:
        statement = (
            insert(ConfigOption)
            .values(
                key=KEY,
                name="企业资料",
                description="企业基本资料及联系人",
                params={},
                value=value,
                created_by=operator,
                updated_by=operator,
            )
            .on_conflict_do_nothing(index_elements=["key"])
        )
        result = await db.execute(statement)
        if result.rowcount == 0:
            record = await db.scalar(select(ConfigOption).where(ConfigOption.key == KEY).with_for_update())
            value["id"] = record.value["id"]
            record.value = value
            record.updated_by = operator
    await db.commit()
    return value
