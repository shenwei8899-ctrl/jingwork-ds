"""专家目录与包边界的独立验收。"""

import io
import zipfile

import pytest

from yuxi.services.octop_expert_service import (
    LIBRARY,
    _bundled_detail,
    _bundled_skill_zip,
    _list_bundled,
    _validate_skill_archive,
    _validate_id,
)


def test_catalog_has_same_public_templates_and_complete_prompts():
    """隐藏默认模板，逐个读取源文件而非依赖生成快照。"""
    items = _list_bundled()
    assert {item["id"] for item in items} == {
        path.parent.name for path in LIBRARY.glob("*/manifest.json") if path.parent.name != "default"
    }
    assert "general-assistant" in {item["id"] for item in items}
    for item in items:
        detail = _bundled_detail(item["id"])
        assert detail["system_prompt"].strip(), item["id"]
        for slug in detail["skill_slugs"]:
            package = _bundled_skill_zip(item["id"], slug)
            _validate_skill_archive(package)
            with zipfile.ZipFile(io.BytesIO(package)) as archive:
                assert archive.read("SKILL.md") == (LIBRARY / item["id"] / "skills" / slug / "SKILL.md").read_bytes()


@pytest.mark.parametrize("value", ["../default", "x/y", "https://evil.example", "", ".."])
def test_identifiers_cannot_escape_library(value):
    """越界在读取文件或发出请求前失败。"""
    with pytest.raises(ValueError, match="无效"):
        _validate_id(value)


def test_archive_rejects_symlink_and_compression_bomb():
    """恶意归档不能进入原生解压动作。"""
    for symbolic in (True, False):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            if symbolic:
                entry = zipfile.ZipInfo("SKILL.md")
                entry.external_attr = 0o120777 << 16
                archive.writestr(entry, "../../secret")
            else:
                archive.writestr("SKILL.md", b"x" * (2 * 1024 * 1024))
        with pytest.raises(ValueError, match="符号链接|压缩比例"):
            _validate_skill_archive(output.getvalue())


def test_adapt_skill_preserves_body_and_quotes_legacy_description():
    """兼容市场未转义冒号与桌面下划线标识，不改写技能正文。"""
    from yuxi.services.octop_expert_service import adapt_skill_package
    from yuxi.services.skills.package import parse_skill_markdown

    body = "# Original instructions\nKeep the exact content.\n"
    content = "---\nname: file_reader\ndescription: Use this: read the file\n---\n" + body
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("SKILL.md", content)
        archive.writestr("scripts/read.py", "print('hello')")
    with zipfile.ZipFile(io.BytesIO(adapt_skill_package(source.getvalue(), "file_reader"))) as archive:
        adapted = archive.read("SKILL.md").decode()
        slug, name, description, _ = parse_skill_markdown(adapted)
        assert (slug, name, description) == ("file-reader", "file_reader", "Use this: read the file")
        assert adapted.split("---\n", 2)[2] == body
        assert archive.read("scripts/read.py") == b"print('hello')"


def test_adapt_legacy_markdown_uses_original_title_and_description():
    """无元数据的旧市场包只添加原文提取的标题与说明。"""
    from yuxi.services.octop_expert_service import adapt_skill_package
    from yuxi.services.skills.package import parse_skill_markdown

    original = "# QA Test Plan Generator\n\nGenerate comprehensive test plans.\n\n## Inputs\nAsk the user.\n"
    package = io.BytesIO()
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("SKILL.md", original)
    with zipfile.ZipFile(io.BytesIO(adapt_skill_package(package.getvalue(), "afrexai-qa-test-plan"))) as archive:
        adapted = archive.read("SKILL.md").decode()
    assert parse_skill_markdown(adapted)[:3] == (
        "afrexai-qa-test-plan",
        "QA Test Plan Generator",
        "Generate comprehensive test plans.",
    )
    assert adapted.endswith(original)


@pytest.mark.asyncio
async def test_market_skill_drafts_cleanup_on_incomplete_download(monkeypatch):
    """部分下载失败不留下可安装草稿或任何智能体。"""
    from yuxi.services import octop_expert_service as service
    live = {}

    async def detail(*args):
        return {"skill_slugs": ["first", "second"]}

    async def download(path, params):
        if params["slug"] == "second":
            raise ValueError("download incomplete")
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("SKILL.md", "---\nname: first\ndescription: first\n---\n# body")
        return output.getvalue()

    async def create(**kwargs):
        live["draft"] = kwargs["file_bytes"]
        return {"draft_id": "draft"}

    async def discard(**kwargs):
        del live[kwargs["draft_id"]]

    monkeypatch.setattr(service, "get_expert", detail)
    monkeypatch.setattr(service, "market_get", download)
    monkeypatch.setattr(service, "create_uploaded_skill_draft", create)
    monkeypatch.setattr(service, "discard_skill_install_draft", discard)
    with pytest.raises(ValueError, match="incomplete"):
        await service.prepare_market_skillset("market-template", object())
    assert live == {}
