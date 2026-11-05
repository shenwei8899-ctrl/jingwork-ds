/** Chat task mode through the shipped Web profile with scripted model responses. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterEach, expect, it, onTestFailed, vi } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@deepseek-ai/dsh-super-agent'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, recordFixture,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const directory = fileURLToPath(new URL('../../../snapshots/web/super-agent-task', import.meta.url))
const fixture = join(directory, 'session.v4.jsonl')
let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let activePage: Page | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  if (activePage !== undefined) await saveFailureShot(activePage, 'super-agent-latest')
  try { await browser?.close() } finally { await scaffold?.close() }
})

it.skipIf(webSnapshotMode() === 'record')('starts a task from the composer, pauses, resumes, stops, and retains a completed task after reload', async () => {
  const mode = webSnapshotMode()
  const fixtureText = await readFile(fixture, 'utf8')
  const recorded = parseSessionLog(fixtureText)
  const objective = recorded.find(event => event.type === 'super-agent/start')
  if (objective?.type !== 'super-agent/start') { throw new Error('task fixture has no objective') }
  scaffold = await launchWebScaffold({ replayFixture: fixture, replayOverride: join(directory, 'replay.override.json'), compareReplaySession: true })
  browser = await chromium.launch()
  const page: Page = await newEnglishPage(browser)
  activePage = page
  page.setDefaultTimeout(15_000)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-super-agent'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const clearGoal = scaffold.ctx.goals.clear.bind(scaffold.ctx.goals)
  vi.spyOn(scaffold.ctx.goals, 'clear').mockImplementation((agent, ref) => {
    // A fixed forward clock makes the persisted clear timestamp independent of wall time.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2100, 0, 1))
    try { return clearGoal(agent, ref) } finally { clock.mockRestore() }
  })
  const input = page.locator('[data-composer-input]').first()
  const toggle = page.getByRole('button', { name: 'Super Agent', exact: true })
  await toggle.waitFor()
  await input.fill(objective.data.objective)
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('true')
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('false')
  expect(await input.innerText()).toBe(objective.data.objective)
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-pressed')).toBe('true')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  const card = page.locator('[data-super-agent-task]')
  await card.getByText('1 / 2 steps completed').waitFor()
  await page.getByText('partial', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => card.getByRole('status').innerText()).toBe('Paused')
  await card.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect.poll(() => card.getByRole('status').innerText()).toBe('Running')
  await page.getByText('partial', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect.poll(() => card.getByRole('status').innerText()).toBe('Stopped')
  const settled = scaffold.whenTurnSettled()
  await toggle.click()
  await input.press('End')
  await input.pressSequentially(objective.data.objective)
  await input.press('Enter')
  // A task command has its own zero-step turn before its model-driven work.
  await settled
  await expect.poll(() => card.getByRole('status').innerText(), { timeout: 30_000 }).toBe('Completed')
  await page.getByText('Check each factual claim against its source.', { exact: false }).waitFor()
  const taskAgent = scaffold.ctx.agents.list().find(agent => scaffold!.ctx.sessionProjections.snapshot(agent.session).values.superAgent?.phase === 'complete')
  if (taskAgent === undefined) throw new Error('completed task agent is unavailable')
  await taskAgent.whenIdle()
  await scaffold.ctx.sessions.flush(taskAgent.session)
  if (mode === 'refresh') await recordFixture(scaffold, taskAgent.id, fixture)
  await card.locator('summary').click()
  await compareOrRefreshGolden(join(directory, 'ui.expected.md'), await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), mode)
  await page.screenshot({ path: '.artifacts/super-agent-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForSelector('[data-sidebar-drawer]')
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
  if (await collapse.isVisible()) await collapse.click()
  await page.waitForSelector('[data-sidebar-drawer][data-sidebar-collapsed]')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '.artifacts/super-agent-mobile.png' })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: '.artifacts/super-agent-dark.png' })
  await page.reload({ waitUntil: 'load' })
  await page.locator('[data-super-agent-task]').getByText('2 / 2 steps completed').waitFor()
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
}, 120_000)
