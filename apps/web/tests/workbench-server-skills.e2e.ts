/** The shipped workbench installs approved skills through its native enterprise commands. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

it('separates approved server skills from saved local skills and retries submission', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const skill = { slug: 'meeting-summary', name: '会议纪要与行动项整理', description: '整理会议记录，提取责任人和待办事项。', content: 'Summarize supplied notes and extract action items.' }
  const submissions: typeof skill[] = []
  let submitAvailable = false
  await page.exposeFunction('testSkillCatalog', () => [{ id: 'approved-version', ...skill }])
  await page.exposeFunction('testSkillDownload', (id: string) => {
    if (id !== 'approved-version') throw new Error('Skill is unavailable')
    return skill
  })
  await page.exposeFunction('testSkillSubmit', (value: typeof skill) => {
    if (!submitAvailable) throw new Error('Submission service unavailable')
    submissions.push(value)
    return 'pending'
  })
  await page.addInitScript(() => {
    const port = window as typeof window & {
      testSkillCatalog: () => Promise<{ id: string; slug: string; name: string; description: string }[]>
      testSkillDownload: (id: string) => Promise<{ slug: string; name: string; description: string; content: string }>
      testSkillSubmit: (value: { slug: string; name: string; description: string; content: string }) => Promise<string>
    }
    Object.defineProperty(window, 'dshJingwork', { value: {
      agents: async () => [], knowledgeBases: async () => [],
      skills: () => port.testSkillCatalog(),
      downloadSkill: (id: string) => port.testSkillDownload(id),
      submitSkill: (value: { slug: string; name: string; description: string; content: string }) => port.testSkillSubmit(value),
    } })
  })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: '专家·技能·连接器', exact: true }).click()
  await page.getByRole('button', { name: '技能', exact: true }).click()
  const server = page.getByRole('region', { name: '服务器技能', exact: true })
  const local = page.getByRole('region', { name: '本地技能', exact: true })
  await server.getByRole('heading', { name: skill.name, exact: true }).waitFor()
  await compareOrRefreshGolden(
    fileURLToPath(new URL('./expected/workbench-skills/server-list.expected.md', import.meta.url)),
    await captureStableAria(page, 'section[aria-label="服务器技能"]', scaffold.workspaceCwd),
    webSnapshotMode(),
  )
  await server.getByRole('button', { name: '安装到本地', exact: true }).click()
  await local.getByRole('heading', { name: skill.name, exact: true }).waitFor()
  expect(await server.getByRole('button', { name: '本地已有同名技能', exact: true }).isDisabled()).toBe(true)
  await local.getByRole('button', { name: '提交审核', exact: true }).click()
  await page.getByText('提交审核失败，本地内容已保存，可在本地技能列表重试', { exact: true }).first().waitFor()
  await local.getByRole('heading', { name: skill.name, exact: true }).waitFor()
  submitAvailable = true
  await local.getByRole('button', { name: '提交审核', exact: true }).click()
  await page.getByText('已提交后台审核，审核通过后可在服务器列表中安装', { exact: true }).waitFor()
  expect(submissions).toEqual([skill])
  const evidence = process.env.DSH_UI_EVIDENCE_DIR
  if (evidence) {
    await mkdir(evidence, { recursive: true })
    await page.getByRole('textbox', { name: '搜索名称、描述或文件', exact: true }).fill('会议纪要')
    await page.screenshot({ path: join(evidence, 'client-skills-light.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: join(evidence, 'client-skills-dark.png'), fullPage: true })
    await page.getByRole('button', { name: '收起侧边栏', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(evidence, 'client-skills-narrow.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  }
})
