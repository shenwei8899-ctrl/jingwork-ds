"""统一账号的私有知识库用例。"""

from yuxi.knowledge.runtime import knowledge_base


async def list_personal_databases(uid: str):
    """个人入口严格只返回本人创建的库，包括管理员账号。"""
    return [db for db in await knowledge_base.get_databases_by_uid(uid) if db.created_by == uid]


async def create_personal_database(user, name: str, description: str, embedding_model_spec: str):
    """身份及私有范围由服务端决定，不接受客户端的共享权限。"""
    return await knowledge_base.create_database(
        name,
        description,
        kb_type="milvus",
        embedding_model_spec=embedding_model_spec,
        created_by=user.uid,
        created_by_department_id=user.department_id,
        share_config={
            "version": 2,
            "read_scope": {"access_level": "user", "department_ids": [], "user_uids": [user.uid]},
            "manage_scope": None,
        },
    )
