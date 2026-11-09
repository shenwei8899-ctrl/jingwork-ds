"""企业桌面访问策略，复用配置存储。"""

import ipaddress
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from yuxi.storage.postgres.models_business import ConfigOption

KEY = "enterprise_network_policy"


def normalize_ranges(value):
    values = [part.strip() for part in value.replace("\n", ",").split(",") if part.strip()]
    if len(values) > 200:
        raise ValueError("最多配置 200 个 IP 或网段")
    return list(dict.fromkeys(str(ipaddress.ip_network(part, strict=False)) for part in values))


async def read_policy(db):
    value = await db.scalar(select(ConfigOption.value).where(ConfigOption.key == KEY))
    return value or {"ranges": []}


async def save_policy(db, ranges, operator):
    value = {"ranges": ranges}
    await db.execute(
        insert(ConfigOption)
        .values(
            key=KEY,
            name="网络设置",
            description="桌面业务接口 IP 白名单",
            params={},
            value=value,
            created_by=operator,
            updated_by=operator,
        )
        .on_conflict_do_update(index_elements=["key"], set_={"value": value, "updated_by": operator})
    )
    await db.commit()
    return value
