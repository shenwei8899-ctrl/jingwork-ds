"""桌面 Skill 经过真实 HTTP、PostgreSQL 和静态扫描完成审核分发。"""

import asyncio
import uuid

import pytest
from sqlalchemy import delete, select

from yuxi.storage.postgres.manager import pg_manager
from yuxi.storage.postgres.models_business import SkillSubmission


@pytest.mark.integration
async def test_desktop_skill_review_distribution_and_withdrawal(test_client, standard_user, admin_headers):
    """普通账号提交，管理员审核，直接下载同样检查发布状态。"""
    headers = standard_user["headers"]
    slug = f"review-{uuid.uuid4().hex[:8]}"
    skill = {
        "slug": slug,
        "name": "会议纪要整理",
        "description": "Summarize meeting notes and extract action items.",
        "content": "Read the supplied meeting notes and write an action item summary.",
    }
    submission_id = None
    pg_manager.initialize()
    try:
        responses = await asyncio.gather(
            *[test_client.post("/api/skills/submissions", headers=headers, json=skill) for _ in range(2)]
        )
        assert [response.status_code for response in responses] == [200, 200]
        items = [response.json()["data"] for response in responses]
        assert items[0]["id"] == items[1]["id"]
        submission_id = items[0]["id"]
        assert items[0]["status"] == "pending"
        assert items[0]["scan_report"]["status"] == "completed", items[0]["scan_report"]

        async with pg_manager.get_async_session_context() as db:
            stored = (await db.execute(select(SkillSubmission).where(SkillSubmission.id == submission_id))).scalar_one()
            assert stored.content == skill["content"]
            assert stored.created_by == standard_user["user"]["uid"]

        download_url = f"/api/skills/distributed/{submission_id}"
        assert (await test_client.get(download_url, headers=headers)).status_code == 404
        assert (await test_client.get("/api/system/skill-submissions", headers=headers)).status_code == 403
        review_url = f"/api/system/skill-submissions/{submission_id}/review"
        denied = await test_client.post(review_url, headers=headers, json={"status": "approved"})
        assert denied.status_code == 403

        management = await test_client.get("/api/system/skill-submissions", headers=admin_headers)
        assert management.status_code == 200
        managed = next(item for item in management.json()["data"] if item["id"] == submission_id)
        assert managed["content"] == skill["content"]
        async with pg_manager.get_async_session_context() as db:
            stored = await db.get(SkillSubmission, submission_id)
            stored.scan_report = {"status": "failed", "error": "integration scanner failure"}
            await db.commit()
        unscanned = await test_client.post(review_url, headers=admin_headers, json={"status": "approved"})
        assert unscanned.status_code == 400
        rescanned = await test_client.post(
            f"/api/system/skill-submissions/{submission_id}/scan", headers=admin_headers
        )
        assert rescanned.status_code == 200
        assert rescanned.json()["data"]["scan_report"]["status"] == "completed"
        approved = await test_client.post(
            review_url, headers=admin_headers, json={"status": "approved", "comment": "审核正文"}
        )
        assert approved.status_code == 200, approved.text
        assert approved.json()["data"]["reviewed_by"]
        catalog = await test_client.get("/api/skills/distributed", headers=headers)
        published = next(item for item in catalog.json()["data"] if item["id"] == submission_id)
        assert "content" not in published
        downloaded = await test_client.get(download_url, headers=headers)
        assert downloaded.json()["data"] == skill

        duplicate = await test_client.post("/api/skills/submissions", headers=headers, json=skill)
        assert duplicate.json()["data"]["status"] == "approved"
        assert duplicate.json()["data"]["id"] == submission_id
        empty_reason = await test_client.post(review_url, headers=admin_headers, json={"status": "withdrawn"})
        assert empty_reason.status_code == 400
        withdrawn = await test_client.post(
            review_url, headers=admin_headers, json={"status": "withdrawn", "comment": "停止分发"}
        )
        assert withdrawn.status_code == 200
        assert (await test_client.get(download_url, headers=headers)).status_code == 404
        catalog = await test_client.get("/api/skills/distributed", headers=headers)
        assert all(item["id"] != submission_id for item in catalog.json()["data"])
        rejected = await test_client.post(
            review_url, headers=admin_headers, json={"status": "rejected", "comment": "需补充说明"}
        )
        assert rejected.json()["data"]["status"] == "rejected"
        assert (await test_client.get(download_url, headers=headers)).status_code == 404
    finally:
        async with pg_manager.get_async_session_context() as db:
            await db.execute(delete(SkillSubmission).where(SkillSubmission.slug == slug))
            await db.commit()
        await pg_manager.close()
