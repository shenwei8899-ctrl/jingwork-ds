/** Chinese repository-skill discovery works without selecting a Session workspace. */
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
} from './scaffold.ts'
import { REPO_ROOT, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const expected = fileURLToPath(new URL('./expected/workbench-skills', import.meta.url))

/** Enumerate actual skill bundles, including skills omitted by local Git ignore rules.
 * @returns Sorted immediate directory names containing a SKILL.md file.
 */
async function repositorySkillNames(): Promise<string[]> {
  const root = join(REPO_ROOT, '.agents', 'skills')
  const directories = await readdir(root, { withFileTypes: true })
  const names = await Promise.all(directories.filter(entry => entry.isDirectory()).map(async (entry) => {
    try {
      await access(join(root, entry.name, 'SKILL.md'))
      return entry.name
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }))
  return names.filter((name): name is string => name !== undefined).sort()
}

it('lists built-in skills with Chinese descriptions and searches their names and purposes', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1000 },
    locale: ZH_BROWSER_LOCALE,
    timezoneId: 'Asia/Shanghai',
  })
  onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench-skills'))
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.getByRole('button', { name: '专家·技能·连接器', exact: true }).click()
  await page.getByRole('button', { name: '技能', exact: true }).click()

  const builtin = page.getByRole('region', { name: '内置技能', exact: true })
  const custom = page.getByRole('region', { name: '我的技能', exact: true })
  await builtin.getByRole('heading', { name: '客户端界面设计', exact: true }).waitFor()
  await custom.waitFor()
  const names = await repositorySkillNames()
  expect(names.length).toBeGreaterThan(0)
  expect(await builtin.locator('article').count()).toBe(names.length)
  for (const name of names) expect(await builtin.getByText(name, { exact: true }).count(), name).toBe(1)
  expect(await builtin.getByRole('button', { name: '编辑', exact: true }).count()).toBe(0)
  expect(await builtin.getByRole('button', { name: '删除', exact: true }).count()).toBe(0)
  expect(await custom.locator('article').count()).toBe(0)

  const search = page.getByRole('textbox', { name: '搜索名称、描述或文件', exact: true })
  for (const term of ['dsh-client-ui-ux', '客户端界面设计', '组件复用']) {
    await search.fill(term)
    await builtin.getByRole('heading', { name: '客户端界面设计', exact: true }).waitFor()
    expect(await builtin.locator('article').count()).toBe(1)
  }
  await compareOrRefreshGolden(
    join(expected, 'builtin-card.expected.md'),
    await captureStableAria(page, 'section[aria-label="内置技能"] article', scaffold.workspaceCwd),
    webSnapshotMode(),
  )
  await builtin.getByRole('button', { name: '查看说明', exact: true }).click()
  const details = page.getByRole('dialog', { name: '技能说明', exact: true })
  await details.getByRole('heading', { name: '客户端界面设计', exact: true }).waitFor()
  expect(await details.textContent()).toContain('组件复用')
  expect(await details.textContent()).toContain('.agents/skills/dsh-client-ui-ux/SKILL.md')
  await compareOrRefreshGolden(
    join(expected, 'builtin-details.expected.md'),
    await captureStableAria(page, '[role="dialog"][aria-label="技能说明"]', scaffold.workspaceCwd),
    webSnapshotMode(),
  )
  await details.press('Escape')
  await details.waitFor({ state: 'hidden' })

  await search.fill('no-such-repository-skill')
  expect(await builtin.locator('article').count()).toBe(0)
  await page.getByText('没有找到匹配项', { exact: true }).first().waitFor()
  await search.fill('')
  await page.setViewportSize({ width: 390, height: 844 })
  await builtin.getByRole('heading', { name: '客户端界面设计', exact: true }).waitFor()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const narrowCard = builtin.locator('article').filter({
    has: page.getByRole('heading', { name: '客户端界面设计', exact: true }),
  })
  await narrowCard.getByRole('button', { name: '查看说明', exact: true }).click()
  await details.waitFor()
  const bounds = await details.boundingBox()
  if (bounds === null) throw new Error('Skill details dialog is not visible')
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect(await details.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await details.getByRole('button', { name: '关闭', exact: true }).click()
  await details.waitFor({ state: 'hidden' })
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
