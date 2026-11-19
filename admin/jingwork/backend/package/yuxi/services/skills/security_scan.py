"""通过独立 Cisco 静态扫描进程生成审核报告。"""

import asyncio
import json
import os
import shutil
import tempfile
from pathlib import Path

import yaml

from yuxi.config import get_int_env


async def scan_markdown_skill(skill: dict[str, str]) -> dict:
    """扫描提交快照，超时、取消或无效输出均终止子进程。"""
    executable = shutil.which(os.getenv("SKILL_SCANNER_EXECUTABLE", "skill-scanner"))
    if executable is None:
        return {"status": "failed", "engine": "cisco-ai-skill-scanner", "error": "扫描器未安装，请安装后重试"}
    timeout = get_int_env("SKILL_SCANNER_TIMEOUT_SECONDS", 30)
    with tempfile.TemporaryDirectory(prefix="skill-review-") as directory:
        root = Path(directory)
        package = root / "skill"
        package.mkdir()
        metadata = yaml.safe_dump({"name": skill["slug"], "description": skill["description"]}, allow_unicode=True)
        (package / "SKILL.md").write_text(f"---\n{metadata}---\n{skill['content']}\n", encoding="utf-8")
        report_path = root / "report.json"
        try:
            process = await asyncio.create_subprocess_exec(
                executable,
                "scan",
                str(package),
                "--format",
                "json",
                "--output",
                str(report_path),
                "--lenient",
                "--cel-mode",
                "off",
                cwd=root,
                env={"PATH": os.defpath, "HOME": directory, "LITELLM_LOCAL_MODEL_COST_MAP": "True"},
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError:
            return {"status": "failed", "engine": "cisco-ai-skill-scanner", "error": "扫描器无法启动，请检查安装"}
        try:
            await asyncio.wait_for(process.wait(), timeout=timeout)
            if process.returncode != 0 or not report_path.is_file() or report_path.stat().st_size > 1048576:
                raise ValueError("扫描进程未返回有效报告")
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if not isinstance(report, dict) or not isinstance(report.get("findings"), list):
                raise ValueError("扫描报告格式无效")
            findings = report["findings"]
            if not all(isinstance(item, dict) and isinstance(item.get("severity"), str) for item in findings):
                raise ValueError("扫描报告风险项无效")
            return {
                "status": "completed",
                "engine": "cisco-ai-skill-scanner",
                "version": "2.3.2",
                "max_severity": report.get("max_severity"),
                "findings": [
                    {
                        key: item.get(key)
                        for key in ("rule_id", "severity", "title", "description", "line_number", "remediation")
                    }
                    for item in findings
                ],
                "analyzers": report.get("analyzers_used", []),
            }
        except (TimeoutError, ValueError, OSError):
            return {"status": "failed", "engine": "cisco-ai-skill-scanner", "error": "扫描失败或超时，请重试"}
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
