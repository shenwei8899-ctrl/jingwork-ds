"""Octop 公共专家模板到 Yuxi 原生 Agent 的导入。"""

from __future__ import annotations

import asyncio
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Literal

import httpx
import yaml
from sqlalchemy.ext.asyncio import AsyncSession

from yuxi.agents.buildin import get_agent_backend
from yuxi.repositories.agent_repository import AgentRepository, normalize_agent_share_config
from yuxi.services.agent_config_service import prepare_agent_config_write
from yuxi.services.skills.draft import (
    create_uploaded_skill_draft,
    discard_skill_install_draft,
    get_skill_drafts_root_dir,
)
from yuxi.services.skills.shared import confirm_skill_install_draft, delete_skill
from yuxi.storage.postgres.models_business import User

LIBRARY = Path(__file__).parents[1] / "integrations/octop/library"
MARKET_HOST = "https://api.skillhub.cn"
ExpertSource = Literal["bundled", "market"]


async def list_experts(source: ExpertSource) -> list[dict]:
    """读取与桌面端同源的内置模板或 SkillHub 目录。"""
    if source == "bundled":
        return await asyncio.to_thread(_list_bundled)
    items = []
    for page in range(1, 21):
        data = json.loads(await market_get("/api/v1/skillsets", params={"page": page, "pageSize": 100}))
        entries = data.get("skillSets")
        if not isinstance(entries, list):
            raise ValueError("专家市场返回了无效目录")
        items.extend(_market_card(entry) for entry in entries)
        if len(entries) < 100 or len(items) >= data.get("total", 2000):
            return items
    raise ValueError("专家市场目录超过分页上限")


async def get_expert(source: ExpertSource, expert_id: str) -> dict:
    """读取提示词和实际 Skill 依赖，供创建前审核。"""
    _validate_id(expert_id)
    if source == "bundled":
        return await asyncio.to_thread(_bundled_detail, expert_id)
    data = json.loads(await market_get(f"/api/v1/skillsets/{expert_id}"))
    card = _market_card(data)
    card["system_prompt"] = str(data.get("content") or "")
    card["skill_slugs"] = list(dict.fromkeys(data.get("skillSlugs") or []))
    if not card["system_prompt"] or len(card["skill_slugs"]) != card["skill_count"]:
        raise ValueError("市场模板缺少完整提示词或技能依赖，不能创建不完整的智能体")
    return card


async def prepare_market_skillset(expert_id: str, operator: User) -> list[dict]:
    """把市场技能集解析为安装草稿，不创建智能体或提前授权。"""
    detail = await get_expert("market", expert_id)
    drafts = []
    try:
        for slug in detail["skill_slugs"]:
            _validate_id(slug)
            package = await market_get("/api/v1/download", params={"slug": slug})
            _validate_skill_archive(package)
            draft = await create_uploaded_skill_draft(
                filename=f"{slug}.zip", file_bytes=adapt_skill_package(package, slug), operator=operator
            )
            drafts.append(draft)
        return drafts
    except Exception:
        for draft in drafts:
            await discard_skill_install_draft(draft_id=draft["draft_id"], operator=operator)
        raise


async def import_expert(
    db: AsyncSession, *, source: ExpertSource, expert_id: str, name: str, share_config: dict, operator: User
) -> dict:
    """完整安装依赖后创建 Agent；失败时补偿删除本次新建的 Skill。"""
    detail = await get_expert(source, expert_id)
    share = normalize_agent_share_config(share_config, allowed_access_levels={"global", "department", "user"})
    drafts = []
    installed = []
    bindings = {}
    try:
        for slug in detail["skill_slugs"]:
            _validate_id(slug)
            package = (
                await asyncio.to_thread(_bundled_skill_zip, expert_id, slug)
                if source == "bundled"
                else await market_get("/api/v1/download", params={"slug": slug})
            )
            _validate_skill_archive(package)
            package = adapt_skill_package(package, slug)
            draft = await create_uploaded_skill_draft(filename=f"{slug}.zip", file_bytes=package, operator=operator)
            drafts.append(draft["draft_id"])

        for original_slug, draft_id in zip(detail["skill_slugs"], drafts, strict=True):
            results = await confirm_skill_install_draft(db, draft_id=draft_id, share_config=share, operator=operator)
            installed.extend(result["slug"] for result in results if result["success"])
            failures = [result for result in results if not result["success"]]
            if failures:
                raise ValueError(f"技能安装失败: {failures[0]['error']}")
            bindings[original_slug] = results[0]["slug"]

        prompt = detail["system_prompt"]
        for original_slug, installed_slug in sorted(bindings.items(), key=lambda item: -len(item[0])):
            prompt = re.sub(
                r"(?<![A-Za-z0-9_-])" + re.escape(original_slug) + r"(?![A-Za-z0-9_-])",
                lambda _match: installed_slug,
                prompt,
            )
        backend = get_agent_backend("ChatbotAgent")
        config, access = await prepare_agent_config_write(
            {"context": {"system_prompt": prompt, "skills": installed, "preload_skills": []}},
            context_schema=backend.context_schema,
            db=db,
            user=operator,
        )
        agent = await AgentRepository(db).create(
            name=name.strip() or detail["name"],
            backend_id="ChatbotAgent",
            description=detail["description"],
            config_json=config,
            config_resource_access=access,
            share_config=share,
            created_by=operator.uid,
            creator=operator,
        )
        return {"slug": agent.slug, "name": agent.name, "installed_skills": installed}
    except Exception:
        await db.rollback()
        await db.refresh(operator)
        for slug in installed:
            await delete_skill(db, slug=slug, operator=operator)
        raise
    finally:
        for draft_id in drafts:
            if (get_skill_drafts_root_dir() / draft_id).exists():
                await discard_skill_install_draft(draft_id=draft_id, operator=operator)


def _validate_id(value: str) -> None:
    """阻止标识穿越模板目录或远程路径。"""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("无效的专家或技能标识")


def _list_bundled() -> list[dict]:
    """按原 manifest 生成内置目录。"""
    return [
        _bundled_detail(path.parent.name, include_prompt=False)
        for path in sorted(LIBRARY.glob("*/manifest.json"))
        if path.parent.name != "default"
    ]


def _bundled_detail(expert_id: str, *, include_prompt: bool = True) -> dict:
    """读取随代码发布的 Octop 模板快照。"""
    _validate_id(expert_id)
    root = LIBRARY / expert_id
    if not (root / "manifest.json").is_file():
        raise ValueError("内置专家不存在")
    manifest = json.loads((root / "manifest.json").read_text())
    slugs = sorted(path.parent.name for path in root.glob("skills/*/SKILL.md"))
    card = {
        "id": expert_id,
        "name": manifest.get("label", {}).get("zh", expert_id),
        "description": manifest.get("description", {}).get("zh", ""),
        "scene": manifest.get("scene", ""),
        "skill_slugs": slugs,
        "skill_count": len(slugs),
    }
    if include_prompt:
        prompts = []
        for filename in manifest.get("prompt_files", ["SOUL.md"]):
            path = (root / filename).resolve()
            if not path.is_relative_to(root.resolve()) or not path.is_file():
                raise ValueError("专家提示词路径无效")
            prompts.append(path.read_text())
        card["system_prompt"] = "\n\n".join(prompts)
    return card


def _bundled_skill_zip(expert_id: str, slug: str) -> bytes:
    """保留 Skill 的脚本与资源，交给原生安装边界校验。"""
    root = LIBRARY / expert_id / "skills" / slug
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_symlink():
                raise ValueError("专家技能包含符号链接")
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    return output.getvalue()


def _market_card(data: dict) -> dict:
    """归一化桌面端同源 SkillHub 字段。"""
    name = str(data.get("displayName") or data.get("name") or data.get("slug") or "")
    return {
        "id": data["slug"],
        "name": name if name.endswith("专家") else name + "专家",
        "description": str(data.get("summary") or data.get("description") or ""),
        "scene": str(data.get("scene") or ""),
        "skill_count": int(data.get("skillCount") or len(data.get("skillSlugs") or [])),
    }


def _validate_skill_archive(package: bytes) -> None:
    """在原生解压前阻止 ZIP 炸弹与符号链接。"""
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        entries = archive.infolist()
        if len(entries) > 2048 or sum(entry.file_size for entry in entries) > 64 * 1024 * 1024:
            raise ValueError("技能压缩包解压体积或文件数量超过上限")
        for entry in entries:
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("技能压缩包包含符号链接")
            if entry.file_size > 1024 * 1024 and entry.file_size > 100 * max(entry.compress_size, 1):
                raise ValueError("技能压缩包压缩比例异常")


async def market_get(path: str, *, params: dict | None = None) -> bytes:
    """只访问公共市场固定域名，并限制下载包体。"""

    async def verify_public_origin(request: httpx.Request) -> None:
        """仅允许市场 API 和它实际使用的公开技能 CDN。"""
        if request.url.scheme != "https" or request.url.host not in {
            "api.skillhub.cn",
            "skillhub-1388575217.cos.accelerate.myqcloud.com",
        }:
            raise ValueError("市场下载重定向到了不受支持的地址")

    async with httpx.AsyncClient(
        timeout=60, follow_redirects=True, max_redirects=3, event_hooks={"request": [verify_public_origin]}
    ) as client:
        async with client.stream("GET", MARKET_HOST + path, params=params) as response:
            response.raise_for_status()
            result = bytearray()
            async for chunk in response.aiter_bytes():
                result.extend(chunk)
                if len(result) > 32 * 1024 * 1024:
                    raise ValueError("专家市场资源包超过 32 MiB")
            return bytes(result)


def adapt_skill_package(package: bytes, slug: str) -> bytes:
    """补充 Yuxi 要求的 slug，保留显示名称和技能正文。"""
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(package)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for entry in source.infolist():
            content = source.read(entry)
            if Path(entry.filename).name == "SKILL.md":
                text = content.decode("utf-8-sig")
                match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.DOTALL)
                if match:
                    frontmatter = match.group(1)
                    try:
                        yaml.safe_load(frontmatter)
                    except yaml.YAMLError:
                        # SkillHub 部分包的纯文本 description 含未转义冒号，保留原文并补充引号。
                        frontmatter = re.sub(
                            r"^(name|description):[ \t]*(.+)$",
                            lambda item: (
                                item.group(1) + ": " + json.dumps(item.group(2), ensure_ascii=False)
                                if not item.group(2).startswith(("'", '"', "|", ">", "[", "{"))
                                else item.group(0)
                            ),
                            frontmatter,
                            flags=re.MULTILINE,
                        )
                    if not re.search(r"^slug:", frontmatter, re.MULTILINE):
                        frontmatter = f"slug: {slug.replace('_', '-')}\n" + frontmatter
                    text = "---\n" + frontmatter + "\n---\n" + text[match.end() :]
                else:
                    # 旧市场技能只有正文；用原文标题与首个说明段补充必需元数据。
                    lines = [line.strip() for line in text.splitlines() if line.strip()]
                    title = lines[0].lstrip("# ") if lines else slug
                    description = next((line for line in lines[1:] if not line.startswith("#")), title)
                    metadata = {"slug": slug.replace("_", "-"), "name": title[:100], "description": description}
                    text = "---\n" + yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False) + "---\n" + text
                content = text.encode("utf-8")
            target.writestr(entry, content)
    return output.getvalue()
