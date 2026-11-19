"""扫描报告错误与进程生命周期回归。"""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from yuxi.services.skills import security_scan


SKILL = {"slug": "sample", "name": "Sample", "description": "Sample skill", "content": "Read supplied notes."}


async def test_missing_scanner_is_visible(monkeypatch):
    monkeypatch.setattr(security_scan.shutil, "which", lambda executable: None)
    assert (await security_scan.scan_markdown_skill(SKILL))["status"] == "failed"


async def test_unlaunchable_scanner_is_visible(monkeypatch):
    monkeypatch.setattr(security_scan.shutil, "which", lambda executable: "/scanner")
    monkeypatch.setattr(security_scan.asyncio, "create_subprocess_exec", AsyncMock(side_effect=OSError("permission denied")))
    assert (await security_scan.scan_markdown_skill(SKILL))["status"] == "failed"


@pytest.mark.parametrize("output", ["invalid json", '{"findings": null}', '{"findings": [1]}'])
async def test_invalid_report_cannot_pass(monkeypatch, output):
    monkeypatch.setattr(security_scan.shutil, "which", lambda executable: "/scanner")
    process = AsyncMock()
    process.returncode = 0

    async def launch(*args, **kwargs):
        report = Path(args[args.index("--output") + 1])
        report.write_text(output)
        return process

    monkeypatch.setattr(security_scan.asyncio, "create_subprocess_exec", launch)
    assert (await security_scan.scan_markdown_skill(SKILL))["status"] == "failed"


async def test_timeout_kills_and_reaps_process(monkeypatch):
    monkeypatch.setattr(security_scan.shutil, "which", lambda executable: "/scanner")
    monkeypatch.setattr(security_scan, "get_int_env", lambda *args: 0.01)
    stopped = asyncio.Event()

    class Process:
        returncode = None

        async def wait(self):
            await stopped.wait()

        def kill(self):
            self.returncode = -9
            stopped.set()

    process = Process()
    monkeypatch.setattr(security_scan.asyncio, "create_subprocess_exec", AsyncMock(return_value=process))
    assert (await security_scan.scan_markdown_skill(SKILL))["status"] == "failed"
    assert stopped.is_set()
