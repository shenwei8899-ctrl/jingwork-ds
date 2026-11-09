"""按当前账号授权下发单个桌面模型的连接配置。"""

from fastapi import HTTPException

from yuxi.models.providers.service import get_model_provider_by_id, resolve_api_key
from yuxi.services.model_credit_service import effective_policy


async def desktop_model_config(db, uid: str, spec: str) -> dict:
    """每次读取权限和供应商事实，不访问模型服务或返回其他模型密钥。"""
    policy = await effective_policy(uid, db)
    if policy["managed"] and spec not in (policy.get("allowed_models") or [policy["default_model"]]):
        raise HTTPException(403, "当前账号无权使用所选企业模型")
    provider_id, separator, model_id = spec.partition(":")
    provider = await get_model_provider_by_id(db, provider_id) if separator else None
    if provider is None or not provider.is_enabled:
        raise HTTPException(404, "所选企业模型已停用或不存在")
    model = next(
        (
            item
            for item in provider.enabled_models or []
            if item["id"] == model_id and item.get("type", "chat") == "chat"
        ),
        None,
    )
    if model is None:
        raise HTTPException(404, "所选企业模型已停用或不是聊天模型")
    if provider_id == "keenlight" or provider.include_user_uid:
        return {"mode": "gateway", "spec": spec}
    if provider.provider_type not in {"openai", "openrouter", "anthropic"}:
        raise HTTPException(422, "桌面直连暂不支持该模型协议")
    return {
        "mode": "direct",
        "spec": spec,
        "model_id": model_id,
        "provider_type": provider.provider_type,
        "base_url": model.get("base_url_override") or provider.base_url,
        "api_key": resolve_api_key(provider) or "",
        "headers": provider.headers_json or {},
        "extra_body": model.get("request_body_overrides") or {},
    }
