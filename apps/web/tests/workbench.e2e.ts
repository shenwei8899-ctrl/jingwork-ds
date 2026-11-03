/** Keyless workbench workflow over the shipped Web profile and real Settings persistence. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createSystemMessage } from '@deepseek-ai/dsh-llm'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  seedSession,
  launchWebScaffold,
  captureStableAria,
  compareOrRefreshGolden,
  webSnapshotMode,
  watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const expected = fileURLToPath(new URL('./expected/workbench', import.meta.url))

describe('workbench expert and file workflow', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    await writeFile(join(scaffold.workspaceCwd, 'report.md'), '# Workbench report\n\nPreview and download fixture.\n')
    const at = (seq: number, event: object) => JSON.stringify({ ...event, seq, time: 1784974100000 + seq })
    await seedSession(
      scaffold,
      [
        JSON.stringify({
          type: 'session',
          version: SESSION_FORMAT_VERSION,
          id: '{{sessionId}}',
          createdAt: 1784974100000,
          cwd: '{{cwd}}',
          isSeeded: false,
          delegationDepth: 0,
        }),
        at(0, {
          type: 'turn/start',
          data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'seed' } } },
        }),
        at(1, { type: 'step/start', data: { turn: 1, step: 1 } }),
        at(2, {
          type: 'system/message',
          data: { turn: 1, step: 1, message: createSystemMessage('') },
          surfaceOp: 'append',
        }),
        at(3, {
          type: 'user/message',
          data: {
            id: '00000000-0000-4000-9000-000000000001',
            role: 'user',
            content: [{ type: 'text', text: 'Library fixture' }],
            source: { kind: 'user', rpcId: 'seed' },
          },
          surfaceOp: 'append',
        }),
        at(4, {
          type: 'session/title',
          data: { title: 'Library fixture', messageSeqs: [3], source: { kind: 'fallback' } },
        }),
        at(5, { type: 'step/end', data: { turn: 1, step: 1 } }),
        at(6, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
      ].join('\n'),
      'workbench-library-fixture',
    )
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Assistants', exact: true }).waitFor()
  }, 120_000)
  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      await scaffold?.close()
    }
  })
  it('creates and manages agents, persists a skill and previews workspace files', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-workbench'))
    await page.getByRole('button', { name: 'Assistants', exact: true }).click()
    expect(await page.getByRole('tab').allTextContents()).toEqual([
      'Enterprise agents', 'My agents', 'Built-in agents',
    ])
    await page.getByRole('tab', { name: 'My agents', exact: true }).click()
    await page.getByRole('heading', { name: 'No personal agents yet', exact: true }).waitFor()
    await compareOrRefreshGolden(
      join(expected, 'assistants-empty.expected.md'),
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    await page.getByRole('tab', { name: 'Enterprise agents', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Edit', exact: true }).count()).toBe(0)
    await page.getByRole('tab', { name: 'Built-in agents', exact: true }).click()
    await page.getByRole('heading', { name: '通用助理', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Start chat', exact: true }).count()).toBe(6)
    await expect.poll(() => page.getByRole('button', { name: 'Start chat', exact: true }).and(page.locator(':disabled')).count(), { timeout: 15_000 }).toBe(0)
    expect(await page.getByRole('button', { name: 'Edit', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Delete', exact: true }).count()).toBe(0)
    await compareOrRefreshGolden(
      join(expected, 'assistants.expected.md'),
      await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    await page.getByRole('button', { name: 'Experts · skills · connectors', exact: true }).click()
    await page.getByRole('button', { name: 'Skills', exact: true }).click()
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit configuration' })
    await dialog.getByLabel('Name', { exact: true }).fill('Meeting notes')
    await dialog.getByLabel('Key (lowercase letters, numbers or hyphens)', { exact: true }).fill('meeting-notes')
    await dialog.getByLabel('Description', { exact: true }).fill('Summarize decisions and action items')
    await dialog
      .getByLabel('Skill content (Markdown)', { exact: true })
      .fill('Summarize decisions, owners and deadlines.')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Experts · skills · connectors', exact: true }).click()
    await page.getByRole('button', { name: 'Skills', exact: true }).click()
    await page.getByRole('heading', { name: 'Meeting notes', exact: true }).waitFor()
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await exerciseAgentEditor(page, scaffold)
    await page.getByRole('button', { name: 'Assistants', exact: true }).click()
    await page.getByRole('tab', { name: 'Built-in agents', exact: true }).click()
    await page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: '通用助理', exact: true }) })
      .getByRole('button', { name: 'Start chat', exact: true })
      .click()
    await page.getByRole('button', { name: '通用助理', exact: true }).waitFor()
    const composer = page.locator('[data-composer-input][contenteditable="true"]')
    await composer.fill('/meeting')
    await page.getByRole('option', { name: /meeting-notes/ }).waitFor()
    await composer.press('Escape')
    await composer.fill('')
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await compareOrRefreshGolden(
      join(expected, 'library-empty.expected.md'),
      await captureStableAria(page, '[class*="libraryEmpty"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    const workspace = page.getByLabel('Session workspace', { exact: true })
    await workspace.selectOption('workbench-library-fixture')
    await page.getByText('report.md', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Video', exact: true }).click()
    await page.getByText('No matches found', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Documents', exact: true }).click()
    await page.getByText('report.md', { exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Search filenames' }).fill('report')
    await compareOrRefreshGolden(
      join(expected, 'library.expected.md'),
      await captureStableAria(page, '[class*="files"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    const row = page.locator('article').filter({ hasText: 'report.md' })
    const download = page.waitForEvent('download')
    await row.getByRole('button', { name: 'Download', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('report.md')
    await row.getByRole('button', { name: 'Preview', exact: true }).click()
    await expect
      .poll(async () => (await page.locator('[data-document-markdown]').allTextContents()).join('\n'), {
        timeout: 15_000,
      })
      .toContain('Preview and download fixture.')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})

async function advanceEditor(editor: Locator, from: number): Promise<void> {
  for (let step = from; step < 4; step++) {
    await editor.getByRole('button', { name: 'Next', exact: true }).click()
  }
}

async function exerciseAgentEditor(page: Page, scaffold: WebScaffold): Promise<void> {
  await page.getByRole('button', { name: 'Assistants', exact: true }).click()
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  let editor = page.getByRole('region', { name: 'New agent', exact: true })
  await editor.waitFor()
  expect(await editor.getAttribute('aria-modal')).toBeNull()
  expect(await page.getByRole('button', { name: 'Assistants', exact: true }).isVisible()).toBe(true)
  expect(await page.getByRole('dialog', { name: 'New agent', exact: true }).count()).toBe(0)
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  expect(await editor.getByLabel('Name', { exact: true }).isVisible()).toBe(true)
  expect(await editor.getByLabel('Role and instructions', { exact: true }).count()).toBe(0)
  await editor.getByLabel('Name', { exact: true }).fill('Cancelled agent')
  await editor.getByLabel('Agent ID', { exact: true }).fill('cancelled-agent')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  await editor.getByLabel('Role and instructions', { exact: true }).fill('This draft must never be saved.')
  await editor.getByRole('button', { name: 'Back', exact: true }).click()
  expect(await editor.getByLabel('Name', { exact: true }).inputValue()).toBe('Cancelled agent')
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  expect(await page.getByRole('heading', { name: 'Cancelled agent', exact: true }).count()).toBe(0)

  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  await editor.getByLabel('Name', { exact: true }).fill('Header closed agent')
  await editor.getByRole('button', { name: 'Close draft', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  expect(await page.getByRole('heading', { name: 'Header closed agent', exact: true }).count()).toBe(0)

  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  await editor.getByLabel('Name', { exact: true }).fill('Escape closed agent')
  await editor.getByLabel('Name', { exact: true }).press('Escape')
  await editor.waitFor({ state: 'hidden' })
  expect(await page.getByRole('heading', { name: 'Escape closed agent', exact: true }).count()).toBe(0)

  await page.getByRole('button', { name: 'New agent', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  await editor.getByLabel('Name', { exact: true }).fill('Test agent')
  await editor.getByLabel('Agent ID', { exact: true }).fill('test-agent')
  await editor.getByLabel('Description', { exact: true }).fill('Persistent assistant workflow fixture')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  await editor.getByLabel('Role and instructions', { exact: true }).fill('')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  expect(await editor.getByLabel('Role and instructions', { exact: true }).isVisible()).toBe(true)
  await editor.getByLabel('Role and instructions', { exact: true }).fill('Summarize decisions and check their owners.')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  await editor.getByRole('checkbox', { name: /Meeting notes/ }).check()
  await advanceEditor(editor, 2)
  await verifyAssistantWizardLayout(page, editor)
  await compareOrRefreshGolden(
    join(expected, 'assistant-review.expected.md'),
    await captureStableAria(page, '[data-agent-editor]', scaffold.workspaceCwd),
    webSnapshotMode(),
  )
  await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  let card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Test agent', exact: true }) })
  await card.waitFor()
  await card.getByRole('button', { name: 'Start chat', exact: true }).waitFor()
  const exported = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await exported
  const downloadPath = await download.path()
  if (downloadPath === null) throw new Error('Expected an exported agent configuration')
  expect(await readFile(downloadPath, 'utf8')).toContain('meeting-notes')
  await card.getByRole('switch', { name: 'Enable agent', exact: true }).click()
  await expect.poll(() => card.getByRole('switch', { name: 'Enable agent', exact: true }).getAttribute('aria-checked')).toBe('false')
  expect(await card.getByRole('button', { name: 'Start chat', exact: true }).isEnabled()).toBe(false)
  await card.getByRole('switch', { name: 'Enable agent', exact: true }).click()
  await expect.poll(() => card.getByRole('button', { name: 'Start chat', exact: true }).isEnabled(), { timeout: 15_000 }).toBe(true)
  await card.getByRole('button', { name: 'Set as default', exact: true }).click()
  await card.getByText('Default', { exact: true }).waitFor()
  expect(await card.getByRole('switch', { name: 'Enable agent', exact: true }).isEnabled()).toBe(false)
  expect(await card.getByRole('button', { name: 'Delete', exact: true }).isEnabled()).toBe(false)
  await page.getByRole('tab', { name: 'Built-in agents', exact: true }).click()
  const builtin = page.locator('article').filter({ has: page.getByRole('heading', { name: '通用助理', exact: true }) })
  await builtin.getByRole('button', { name: 'Set as default', exact: true }).click()
  await builtin.getByText('Default', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  await expect.poll(() => card.getByRole('switch', { name: 'Enable agent', exact: true }).isEnabled()).toBe(true)
  await card.getByRole('button', { name: 'Start chat', exact: true }).click()
  await page.getByRole('button', { name: 'Test agent', exact: true }).waitFor()

  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: 'Assistants', exact: true }).click()
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('test-agent')
  await page.getByRole('row').filter({ hasText: 'Test agent' }).waitFor()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('')
  card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Test agent', exact: true }) })
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  editor = page.getByRole('region', { name: 'Edit agent', exact: true })
  expect(await editor.getByLabel('Agent ID', { exact: true }).inputValue()).toBe('test-agent')
  await editor.getByLabel('Name', { exact: true }).fill('Test agent updated')
  await advanceEditor(editor, 0)
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Test agent updated', exact: true }) })
  await card.getByRole('button', { name: 'Duplicate', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  expect(await editor.getByLabel('Agent ID', { exact: true }).inputValue()).toBe('')
  await editor.getByLabel('Name', { exact: true }).fill('Duplicate agent')
  await advanceEditor(editor, 0)
  await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Duplicate agent', exact: true }).waitFor()
  const duplicateCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Duplicate agent', exact: true }) })
  const duplicateId = await exportAgentKey(page, duplicateCard)
  expect(duplicateId).not.toBe('test-agent')
  expect(duplicateId.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Create from built-in', exact: true }).click()
  const template = page.locator('article').filter({ has: page.getByRole('heading', { name: '文案专家', exact: true }) })
  await template.getByRole('button', { name: 'Create from template', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  expect(await editor.getByLabel('Name', { exact: true }).inputValue()).toContain('文案专家')
  expect(await editor.getByLabel('Agent ID', { exact: true }).inputValue()).toBe('')
  await editor.getByLabel('Name', { exact: true }).fill('Template copy')
  await advanceEditor(editor, 0)
  await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Template copy', exact: true }).waitFor()
  const templateCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Template copy', exact: true }) })
  const templateId = await exportAgentKey(page, templateCard)
  expect(templateId).not.toBe('writer')
  expect(templateId).not.toBe(duplicateId)
  await page.getByRole('tab', { name: 'Built-in agents', exact: true }).click()
  expect(await page.getByRole('heading', { name: '文案专家', exact: true }).count()).toBe(1)
  expect(await page.getByRole('button', { name: 'Start chat', exact: true }).count()).toBe(6)
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  for (const name of ['Test agent updated', 'Duplicate agent', 'Template copy']) {
    const row = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete this item?', exact: true })
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await confirmation.waitFor({ state: 'hidden' })
    await expect.poll(() => page.getByRole('heading', { name, exact: true }).count()).toBe(0)
  }
}


async function exportAgentKey(page: Page, card: Locator): Promise<string> {
  const pending = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Export', exact: true }).click()
  const path = await (await pending).path()
  if (path === null) throw new Error('Expected an exported agent configuration')
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof data !== 'object' || data === null || !('experts' in data) || !Array.isArray(data.experts)) {
    throw new Error('Expected exported expert definitions')
  }
  const expert: unknown = data.experts[0]
  if (typeof expert !== 'object' || expert === null || !('slug' in expert) || typeof expert.slug !== 'string') {
    throw new Error('Expected a saved agent ID')
  }
  return expert.slug
}

async function verifyAssistantWizardLayout(page: Page, editor: Locator): Promise<void> {
  const viewport = page.viewportSize()
  await editor.getByRole('button', { name: 'Basic information', exact: true }).click()
  const description = editor.getByLabel('Description', { exact: true })
  const originalDescription = await description.inputValue()
  await description.fill(`${originalDescription}\n${'Coordinate research, verify facts and prepare a deliverable for the project team. '.repeat(12)}`)
  await editor.getByRole('button', { name: 'Review', exact: true }).click()
  const header = editor.locator('[data-agent-editor-header]')
  const footer = editor.locator('[data-agent-editor-footer]')
  const body = editor.locator('[data-agent-editor-scroll]')
  const artifacts = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ state: 'attached' })
    await page.locator('[data-shortcut-modal="sidebar"]').waitFor({ state: 'attached' })
    await page.locator('[data-shortcut-modal="sidebar"]').waitFor({ state: 'hidden' })
    for (const palette of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: palette })
      await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(palette === 'dark')
      const box = await editor.boundingBox()
      if (box === null) throw new Error('Expected the creation wizard to remain visible at 390px')
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(844)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
      expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      for (const control of [editor.getByRole('button', { name: 'Close draft', exact: true }), editor.getByRole('button', { name: 'Cancel', exact: true })]) {
        expect(await control.isVisible()).toBe(true)
        expect(await control.evaluate((element) => {
          const box = element.getBoundingClientRect()
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          return hit !== null && element.contains(hit)
        })).toBe(true)
      }
      const headerBefore = await header.boundingBox()
      const footerBefore = await footer.boundingBox()
      if (headerBefore === null || footerBefore === null) throw new Error('Expected the editor header and footer')
      expect(headerBefore.y).toBeGreaterThanOrEqual(0)
      expect(footerBefore.y + footerBefore.height).toBeLessThanOrEqual(844)
      await body.getByText('Choose the model in the chat. File access, search and tool permissions use the current environment settings.', { exact: true }).scrollIntoViewIfNeeded()
      expect(await body.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      const headerAfter = await header.boundingBox()
      const footerAfter = await footer.boundingBox()
      if (headerAfter === null || footerAfter === null) throw new Error('Expected persistent editor actions after scrolling')
      expect(headerAfter.y).toBeCloseTo(headerBefore.y, 0)
      expect(footerAfter.y).toBeCloseTo(footerBefore.y, 0)
      const create = editor.getByRole('button', { name: 'Create agent', exact: true })
      const actionBox = await create.boundingBox()
      if (actionBox === null) throw new Error('Expected the create action to remain reachable at 390px')
      expect(actionBox.y).toBeGreaterThanOrEqual(0)
      expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(844)
      const colors = await editor.getByRole('heading', { name: 'Test agent', exact: true }).evaluate(element => ({
        foreground: getComputedStyle(element).color,
        background: getComputedStyle(element.closest('[data-agent-editor]')!).backgroundColor,
      }))
      const luminance = (color: string): number => {
        const [r, g, b] = color.match(/[\d.]+/gu)!.map(Number).slice(0, 3)
          .map(channel => channel / 255)
          .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
      }
      const foreground = luminance(colors.foreground), background = luminance(colors.background)
      expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5)
      await page.screenshot({ path: join(artifacts, `workbench-wizard-390-${palette}-${process.pid}.png`) })
    }
  } finally {
    await page.emulateMedia({ colorScheme: null })
    if (viewport !== null) await page.setViewportSize(viewport)
  }
  await editor.getByRole('button', { name: 'Basic information', exact: true }).click()
  await editor.getByLabel('Description', { exact: true }).fill(originalDescription)
  await editor.getByRole('button', { name: 'Review', exact: true }).click()
}
