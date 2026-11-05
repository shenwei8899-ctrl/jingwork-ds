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
  fixtureUserPrompts,
  readPersistedEvents,
  webSnapshotMode,
  watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const expected = fileURLToPath(new URL('./expected/workbench', import.meta.url))
const replyFixture = fileURLToPath(new URL('../../../snapshots/web/deepseek-messages-chat/session.v4.jsonl', import.meta.url))
const knowledge = 'product-kb'
const updatedKnowledge = 'support-kb'

describe('workbench expert and file workflow', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: replyFixture, compareReplaySession: false })
    await mkdir(join(scaffold.workspaceCwd, 'workspace'), { recursive: true })
    await writeFile(join(scaffold.workspaceCwd, 'report.md'), '# Workbench report\n\nPreview and download fixture.\n')
    await writeFile(join(scaffold.workspaceCwd, '缩略图 sample.png'), Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64',
    ))
    await writeFile(join(scaffold.workspaceCwd, 'broken.png'), 'invalid image')
    await Promise.all(Array.from({ length: 16 }, (_, index) => writeFile(
      join(scaffold.workspaceCwd, `layout-${index}-long-filename-for-responsive-library-layout.md`),
      '# Library layout fixture\n',
    )))
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
        at(5, {
          type: 'deliverables/presented',
          data: {
            turn: 1,
            callId: 'library-present',
            files: [
              { path: '{{cwd}}/report.md' },
              { path: '{{cwd}}/缩略图 sample.png' },
            ],
          },
        }),
        at(6, { type: 'step/end', data: { turn: 1, step: 1 } }),
        at(7, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
      ].join('\n'),
      'workbench-library-fixture',
    )
    await seedSession(
      scaffold,
      [
        JSON.stringify({
          type: 'session',
          version: SESSION_FORMAT_VERSION,
          id: '{{sessionId}}',
          createdAt: 1784974100100,
          cwd: '{{cwd}}',
          isSeeded: false,
          delegationDepth: 0,
        }),
        at(0, {
          type: 'turn/start',
          data: { turn: 1, trigger: { kind: 'message', source: { kind: 'user', rpcId: 'image-seed' } } },
        }),
        at(1, { type: 'step/start', data: { turn: 1, step: 1 } }),
        at(2, {
          type: 'user/message',
          data: {
            id: '00000000-0000-4000-9000-000000000002',
            role: 'user',
            content: [{ type: 'text', text: 'Repair image' }],
            source: { kind: 'user', rpcId: 'image-seed' },
          },
          surfaceOp: 'append',
        }),
        at(3, {
          type: 'session/title',
          data: { title: 'Image repair', messageSeqs: [2], source: { kind: 'fallback' } },
        }),
        at(4, {
          type: 'deliverables/presented',
          data: { turn: 1, callId: 'image-present', files: [{ path: '{{cwd}}/broken.png' }] },
        }),
        at(5, { type: 'step/end', data: { turn: 1, step: 1 } }),
        at(6, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
      ].join('\n'),
      'workbench-library-images',
    )
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.addInitScript(() => {
      Object.assign(window, { dshJingwork: {
        name: async () => null,
        signOut: async () => {},
        agents: async () => [],
        knowledgeBases: async () => [
          { id: 'product-kb', name: 'Product knowledge', description: 'Managed product reference' },
          { id: 'support-kb', name: 'Support knowledge', description: 'Managed support reference' },
        ],
      } })
    })
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
    const templates = page.locator('[data-expert-templates]')
    await templates.waitFor()
    expect(await templates.locator('article').count()).toBe(6)
    await compareOrRefreshGolden(
      join(expected, 'expert-templates.expected.md'),
      await captureStableAria(page, '[data-expert-templates]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    const templateArtifacts = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    await mkdir(templateArtifacts, { recursive: true })
    const templateViewport = page.viewportSize()
    for (const palette of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: palette })
      await expect.poll(() => page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))).toBe(palette === 'dark')
      await page.screenshot({ path: join(templateArtifacts, `expert-templates-${palette}.png`) })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ state: 'attached' })
      await page.locator('[data-shortcut-modal="sidebar"]').waitFor({ state: 'hidden' })
      await expect.poll(() => templates.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      for (const button of await templates.getByRole('button').all()) {
        const bounds = await button.boundingBox()
        if (bounds === null) throw new Error('Expected the template action to remain visible')
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
      }
      await page.screenshot({ path: join(templateArtifacts, `expert-templates-390-${palette}.png`) })
      if (templateViewport) await page.setViewportSize(templateViewport)
    }
    await page.emulateMedia({ colorScheme: null })
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
    const workspace = page.getByLabel('Session workspace', { exact: true })
    await expect.poll(() => workspace.inputValue()).not.toBe('')
    expect(await workspace.locator('option[value="workbench-library-fixture"]').count()).toBe(1)
    await workspace.selectOption('workbench-library-fixture')
    await page.getByText('report.md', { exact: true }).waitFor()
    for (const palette of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: palette })
      for (const viewport of [{ width: 1680, height: 1008 }, { width: 900, height: 600 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport)
        const geometry = await page.locator('[class*="libraryPanel"]').evaluate((panel) => {
          const bounds = panel.getBoundingClientRect()
          return {
            contained: [...panel.querySelectorAll('article, article button, [class*="libraryFootnote"]')].every((child) => {
              const rect = child.getBoundingClientRect()
              return rect.top >= bounds.top && rect.bottom <= bounds.bottom
                && rect.left >= bounds.left && rect.right <= bounds.right
            }),
            fits: document.documentElement.scrollWidth <= innerWidth,
          }
        })
        expect(geometry).toEqual({ contained: true, fits: true })
        await page.screenshot({ path: join(templateArtifacts, `library-${viewport.width}-${palette}.png`), fullPage: true })
      }
    }
    await page.emulateMedia({ colorScheme: null })
    await page.setViewportSize({ width: 1680, height: 1008 })
    await page.getByRole('button', { name: 'Images', exact: true }).click()
    const imageGroups = page.locator('[class*="libraryGroups"]')
    expect(await imageGroups.locator('article').count()).toBe(2)
    const thumbnail = imageGroups.getByRole('img', { name: '缩略图 sample.png', exact: true })
    await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await imageGroups.getByText('Thumbnail unavailable. Try preview or download.', { exact: true }).waitFor()
    await compareOrRefreshGolden(
      join(expected, 'library-images.expected.md'),
      await captureStableAria(page, '[class*="libraryGroups"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    for (const palette of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: palette })
      await page.screenshot({ path: join(templateArtifacts, `library-images-${palette}.png`) })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ state: 'attached' })
      await expect.poll(() => imageGroups.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.screenshot({ path: join(templateArtifacts, `library-images-390-${palette}.png`) })
      await page.setViewportSize({ width: 1680, height: 1008 })
    }
    await page.emulateMedia({ colorScheme: null })
    await page.getByRole('button', { name: 'Video', exact: true }).click()
    await page.getByText('No matches found', { exact: true }).waitFor()
    await compareOrRefreshGolden(
      join(expected, 'library-empty.expected.md'),
      await captureStableAria(page, '[class*="libraryEmpty"]', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
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
    await page.getByRole('button', { name: 'Library', exact: true }).click()
    await page.getByLabel('Session workspace', { exact: true }).selectOption('workbench-library-fixture')
    await page.getByRole('textbox', { name: 'Search filenames' }).fill('')
    await page.getByRole('button', { name: 'Images', exact: true }).click()
    await page.getByRole('button', { name: 'Preview 缩略图 sample.png', exact: true }).click()
    await expect.poll(() => page.locator('[data-image-preview] img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await page.getByRole('button', { name: 'Experts · skills · connectors', exact: true }).click()
    await page.getByRole('button', { name: 'Connectors', exact: true }).click()
    const catalog = page.getByRole('region', { name: 'Connectors', exact: true })
    await catalog.getByRole('heading', { name: 'Tencent Docs', exact: true }).waitFor()
    expect(await catalog.locator('article').count()).toBe(9)
    await compareOrRefreshGolden(
      join(expected, 'connectors-builtin.expected.md'),
      await captureStableAria(page, '[class*="catalog"]:has(> nav[aria-label="Connectors"])', scaffold.workspaceCwd),
      webSnapshotMode(),
    )
    const news = catalog.locator('article').filter({ has: page.getByRole('heading', { name: 'Tencent News', exact: true }) })
    await news.getByRole('button', { name: 'Connect', exact: true }).click()
    const connection = page.getByRole('dialog', { name: 'Tencent News', exact: true })
    await connection.getByRole('button', { name: 'Save', exact: true }).click()
    await connection.getByRole('alert').getByText('Complete every credential field', { exact: true }).waitFor()
    await connection.getByLabel('API key', { exact: true }).fill('keyless-connector-fixture')
    await connection.getByRole('button', { name: 'Save', exact: true }).click()
    await connection.waitFor({ state: 'hidden' })
    await catalog.getByRole('button', { name: 'Enabled connectors', exact: true }).click()
    await catalog.getByRole('heading', { name: 'Tencent News', exact: true }).waitFor()
    await catalog.getByRole('button', { name: 'Disable', exact: true }).click()
    await catalog.getByText('No enabled connectors yet. Start with a built-in connector.', { exact: true }).waitFor()
    expect(await catalog.getByRole('button', { name: 'Custom connectors', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Create', exact: true }).count()).toBe(0)
    await catalog.getByRole('button', { name: 'Built-in connectors', exact: true }).click()
    const connectorArtifacts = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    await page.screenshot({ path: join(connectorArtifacts, 'workbench-connectors.png') })
    const connectorViewport = page.viewportSize()
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    for (const palette of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: palette })
      await catalog.getByRole('heading', { name: 'Tencent Docs', exact: true }).scrollIntoViewIfNeeded()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: join(connectorArtifacts, `workbench-connectors-390-${palette}.png`) })
    }
    await page.emulateMedia({ colorScheme: null })
    if (connectorViewport !== null) await page.setViewportSize(connectorViewport)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })

})

async function advanceEditor(editor: Locator, from: number): Promise<void> {
  for (let step = from; step < 7; step++) {
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
  expect(await editor.locator('input[type="color"]').count()).toBe(0)
  expect(await page.getByRole('button', { name: 'Assistants', exact: true }).isVisible()).toBe(true)
  expect(await page.getByRole('dialog', { name: 'New agent', exact: true }).count()).toBe(0)
  expect(await editor.getByRole('textbox', { name: 'Agent ID', exact: true }).count()).toBe(1)
  expect(await editor.getByLabel('Name', { exact: true }).inputValue()).toBe('General expert')
  expect(await editor.getByLabel('Description', { exact: true }).inputValue()).toBe('Clarify goals, plan tasks and help with everyday work')
  await compareOrRefreshGolden(
    join(expected, 'assistant-basics.expected.md'),
    await captureStableAria(page, '[data-agent-editor]', scaffold.workspaceCwd, { replacements: [[await editor.getByLabel('Agent ID', { exact: true }).inputValue(), '{{agentId}}']] }),
    webSnapshotMode(),
  )
  await editor.getByLabel('Name', { exact: true }).fill('')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  expect(await editor.getByLabel('Name', { exact: true }).isVisible()).toBe(true)
  expect(await editor.getByLabel('Role and instructions', { exact: true }).count()).toBe(0)
  await editor.getByLabel('Name', { exact: true }).fill('Cancelled agent')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  await editor.getByLabel('Role and instructions', { exact: true }).fill('This draft must never be saved.')
  await editor.getByRole('button', { name: 'Knowledge base', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Support knowledge Managed support reference', exact: true }).check()
  await editor.getByRole('button', { name: 'Basic information', exact: true }).click()
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
  await editor.getByLabel('Description', { exact: true }).fill('Persistent assistant workflow fixture')
  await editor.getByRole('button', { name: 'Use and customize this example', exact: true }).click()
  await editor.getByLabel('Welcome message', { exact: true }).fill('Welcome to the fixture agent')
  const prompts = fixtureUserPrompts(await readFile(replyFixture, 'utf8'))
  expect(prompts).toHaveLength(1)
  await editor.getByLabel('Prompt', { exact: true }).fill(prompts[0]!)
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  await editor.getByLabel('Role and instructions', { exact: true }).fill('')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  expect(await editor.getByLabel('Role and instructions', { exact: true }).isVisible()).toBe(true)
  await editor.getByLabel('Role and instructions', { exact: true }).fill('Summarize decisions and check their owners.')
  await editor.getByRole('button', { name: 'Next', exact: true }).click()
  await editor.getByRole('button', { name: 'Skills', exact: true }).click()
  await editor.getByRole('checkbox', { name: /Meeting notes/ }).check()
  const builtinSkill = editor.getByRole('checkbox', { name: /Official plugin artwork/ })
  await builtinSkill.check()
  expect(await builtinSkill.isChecked()).toBe(true)
  await builtinSkill.uncheck()
  await editor.getByLabel('Upload skill (Markdown)', { exact: true }).setInputFiles({
    name: 'SKILL.md', mimeType: 'text/markdown',
    buffer: Buffer.from('---\nname: uploaded-notes\ndescription: Summarize uploaded notes\n---\nWrite a concise summary.'),
  })
  const uploadedSkill = editor.getByRole('checkbox', { name: /uploaded-notes/ })
  await uploadedSkill.waitFor()
  expect(await uploadedSkill.isChecked()).toBe(true)
  await uploadedSkill.uncheck()
  await compareOrRefreshGolden(
    join(expected, 'assistant-skills.expected.md'),
    await captureStableAria(page, '[data-agent-editor]', scaffold.workspaceCwd),
    webSnapshotMode(),
  )
  const skillArtifacts = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
  await mkdir(skillArtifacts, { recursive: true })
  await editor.locator('[data-agent-editor-scroll]').evaluate((element) => { element.scrollTo({ top: 0 }) })
  await page.screenshot({ path: join(skillArtifacts, 'workbench-skills.png') })
  const skillViewport = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-sidebar-drawer][data-sidebar-collapsed]').waitFor({ state: 'attached' })
  await page.locator('[data-shortcut-modal="sidebar"]').waitFor({ state: 'hidden' })
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(skillArtifacts, 'workbench-skills-390-dark.png') })
  await page.emulateMedia({ colorScheme: null })
  if (skillViewport) await page.setViewportSize(skillViewport)
  await page.locator('[data-sidebar-drawer]').waitFor({ state: 'detached' })


  await editor.getByRole('button', { name: 'Knowledge base', exact: true }).click()
  await editor.getByRole('checkbox', { name: 'Product knowledge Managed product reference', exact: true }).check()
  await advanceEditor(editor, 2)
  await verifyAssistantWizardLayout(page, editor)
  const agentId = await editor.getByRole('definition').first().innerText()
  expect(agentId).toMatch(/^agent-[0-9a-f]{8}$/u)
  await compareOrRefreshGolden(
    join(expected, 'assistant-review.expected.md'),
    await captureStableAria(page, '[data-agent-editor]', scaffold.workspaceCwd, {
      replacements: [[agentId, '{{agentId}}']],
    }),
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
  const exportedText = await readFile(downloadPath, 'utf8')
  expect(exportedText).toContain('meeting-notes')
  const exportedConfig: unknown = JSON.parse(exportedText)
  expect(exportedConfig).toMatchObject({ experts: [{ slug: agentId, knowledgeBases: [knowledge], welcomeMessage: 'Welcome to the fixture agent', quickPrompts: [{ title: 'Help me write a weekly report' }], tools: ['files', 'web', 'shell', 'tasks', 'interaction'], subagents: [] }] })
  expect(exportedText).not.toContain('Knowledge from a cancelled draft must never be saved.')
  await card.getByRole('switch', { name: 'Enable agent', exact: true }).click()
  await expect.poll(() => card.getByRole('switch', { name: 'Enable agent', exact: true }).getAttribute('aria-checked')).toBe('false')
  expect(await card.getByRole('button', { name: 'Start chat', exact: true }).isEnabled()).toBe(false)
  await card.getByRole('switch', { name: 'Enable agent', exact: true }).click()
  await expect.poll(() => card.getByRole('button', { name: 'Start chat', exact: true }).isEnabled(), { timeout: 15_000 }).toBe(true)
  await card.getByRole('button', { name: 'Set as default', exact: true }).click()
  await card.getByText('Default', { exact: true }).waitFor()
  expect(await card.getByRole('switch', { name: 'Enable agent', exact: true }).isEnabled()).toBe(false)
  expect(await card.getByRole('button', { name: 'Delete', exact: true }).isEnabled()).toBe(true)
  await page.getByRole('tab', { name: 'Built-in agents', exact: true }).click()
  const builtin = page.locator('article').filter({ has: page.getByRole('heading', { name: '通用助理', exact: true }) })
  await builtin.getByRole('button', { name: 'Set as default', exact: true }).click()
  await builtin.getByText('Default', { exact: true }).waitFor()
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  await expect.poll(() => card.getByRole('switch', { name: 'Enable agent', exact: true }).isEnabled()).toBe(true)
  await card.getByRole('button', { name: 'Start chat', exact: true }).click()
  await page.getByRole('button', { name: 'Test agent', exact: true }).waitFor()
  const settled = scaffold.whenTurnSettled()
  expect(await page.getByRole('heading', { name: 'Welcome to the fixture agent', exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: /Help me write a weekly report/ }).click()
  const sessionId = await settled
  const session = scaffold.ctx.sessions.get(sessionId)
  if (session === undefined) throw new Error('Expected the personal assistant session to remain available')
  expect(session.header.agentPreset).toBe(`workbench-${agentId}`)
  const events = await readPersistedEvents(scaffold, sessionId)
  expect(events.some(event => event.type === 'assistant/message')).toBe(true)
  expect(events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
  const system = events.flatMap(event => event.type === 'system/message'
    ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : [])
    : []).join('\n')
  expect(system).toBeTruthy()

  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: 'Assistants', exact: true }).click()
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill(agentId)
  await page.getByRole('row').filter({ hasText: 'Test agent' }).waitFor()
  await page.getByRole('button', { name: 'Cards', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search agents', exact: true }).fill('')
  card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Test agent', exact: true }) })
  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  editor = page.getByRole('region', { name: 'Edit agent', exact: true })
  expect(await editor.getByRole('textbox', { name: 'Agent ID', exact: true }).count()).toBe(1)
  await editor.getByLabel('Name', { exact: true }).fill('Test agent updated')
  await editor.getByRole('button', { name: 'Knowledge base', exact: true }).click()
  expect(await editor.getByRole('checkbox', { name: 'Product knowledge Managed product reference', exact: true }).isChecked()).toBe(true)
  await editor.getByRole('checkbox', { name: 'Product knowledge Managed product reference', exact: true }).uncheck()
  await editor.getByRole('checkbox', { name: 'Support knowledge Managed support reference', exact: true }).check()
  await advanceEditor(editor, 2)
  expect(await editor.getByRole('definition').first().innerText()).toBe(agentId)
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Test agent updated', exact: true }) })
  expect(await exportAgentConfiguration(page, card)).toMatchObject({ slug: agentId, knowledgeBases: [updatedKnowledge] })
  await card.getByRole('button', { name: 'Duplicate', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  expect(await editor.getByRole('textbox', { name: 'Agent ID', exact: true }).count()).toBe(1)
  await editor.getByLabel('Name', { exact: true }).fill('Duplicate agent')
  await editor.getByRole('button', { name: 'Knowledge base', exact: true }).click()
  expect(await editor.getByRole('checkbox', { name: 'Support knowledge Managed support reference', exact: true }).isChecked()).toBe(true)
  await advanceEditor(editor, 2)
  await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Duplicate agent', exact: true }).waitFor()
  const duplicateCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Duplicate agent', exact: true }) })
  const duplicate = await exportAgentConfiguration(page, duplicateCard)
  const duplicateId = duplicate.slug
  expect(duplicate.knowledgeBases).toEqual([updatedKnowledge])
  expect(duplicateId).not.toBe(agentId)
  expect(duplicateId).toMatch(/^agent-[0-9a-f]{8}$/u)

  await page.getByRole('button', { name: 'Create from built-in', exact: true }).click()
  const template = page.locator('article').filter({ has: page.getByRole('heading', { name: '文案专家', exact: true }) })
  await template.getByRole('button', { name: 'Create from template', exact: true }).click()
  editor = page.getByRole('region', { name: 'New agent', exact: true })
  expect(await editor.getByLabel('Name', { exact: true }).inputValue()).toContain('文案专家')
  expect(await editor.getByRole('textbox', { name: 'Agent ID', exact: true }).count()).toBe(1)
  await editor.getByLabel('Name', { exact: true }).fill('Template copy')
  await advanceEditor(editor, 0)
  await editor.getByRole('button', { name: 'Create agent', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: 'Template copy', exact: true }).waitFor()
  const templateCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Template copy', exact: true }) })
  const templateConfiguration = await exportAgentConfiguration(page, templateCard)
  const templateId = templateConfiguration.slug
  expect(templateConfiguration.knowledge ?? '').toBe('')
  expect(templateId).toMatch(/^agent-[0-9a-f]{8}$/u)
  expect(templateId).not.toBe('writer')
  expect(templateId).not.toBe(agentId)
  expect(templateId).not.toBe(duplicateId)
  await page.getByRole('tab', { name: 'Built-in agents', exact: true }).click()
  expect(await page.getByRole('heading', { name: '文案专家', exact: true }).count()).toBe(1)
  expect(await page.getByRole('button', { name: 'Start chat', exact: true }).count()).toBe(6)
  await page.getByRole('tab', { name: 'My agents', exact: true }).click()
  for (const name of ['Test agent updated', 'Duplicate agent', 'Template copy']) {
    const row = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) })
    if (name === 'Test agent updated') {
      await row.getByRole('button', { name: 'Set as default', exact: true }).click()
      await row.getByText('Default', { exact: true }).waitFor()
    }
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete this item?', exact: true })
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    if (name === 'Test agent updated') {
      await expect.poll(() => scaffold.ctx.agentPresets.defaultId).toBe('standard')
    }
    await confirmation.waitFor({ state: 'hidden' })
    await expect.poll(() => page.getByRole('heading', { name, exact: true }).count()).toBe(0)
  }
}


async function exportAgentConfiguration(
  page: Page, card: Locator,
): Promise<{ slug: string; knowledge?: string; knowledgeBases?: string[] }> {
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
  if ('knowledgeBases' in expert) {
    if (!Array.isArray(expert.knowledgeBases) || !expert.knowledgeBases.every((id: unknown) => typeof id === 'string')) throw new Error('Invalid knowledge assignments')
    return { slug: expert.slug, knowledgeBases: expert.knowledgeBases }
  }
  if ('knowledge' in expert) {
    if (typeof expert.knowledge !== 'string') throw new Error('Expected saved knowledge to be text')
    return { slug: expert.slug, knowledge: expert.knowledge }
  }
  return { slug: expert.slug }
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
      await editor.getByRole('button', { name: 'Knowledge base', exact: true }).click()
      const knowledgeField = editor.getByRole('checkbox', { name: 'Product knowledge Managed product reference', exact: true })
      expect(await knowledgeField.isChecked()).toBe(true)
      const knowledgeBox = await knowledgeField.boundingBox()
      if (knowledgeBox === null) throw new Error('Expected the knowledge field to remain visible at 390px')
      expect(knowledgeBox.x).toBeGreaterThanOrEqual(0)
      expect(knowledgeBox.x + knowledgeBox.width).toBeLessThanOrEqual(390)
      expect(await editor.getByRole('button', { name: 'Next', exact: true }).isVisible()).toBe(true)
      await page.screenshot({ path: join(artifacts, `workbench-knowledge-390-${palette}-${process.pid}.png`) })
      await editor.getByRole('button', { name: 'Review', exact: true }).click()
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
      await body.getByText('The saved agent settings select its model and tools. Execution follows the current environment permissions.', { exact: true }).scrollIntoViewIfNeeded()
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
