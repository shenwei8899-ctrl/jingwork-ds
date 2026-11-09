import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import { guideGroups } from '../../src/content/guide/navigation.js'
import { renderGuide, searchGuides } from '../../src/utils/guide.js'

const root = new URL('../../src/content/guide/', import.meta.url)
const pages = guideGroups.flatMap((group) =>
  group.pages.map((page) => ({
    ...page,
    path: `/guide/${page.slug}`,
    content: readFileSync(new URL(`${page.slug || 'index'}.md`, root), 'utf8')
  }))
)

test('公开文档包含完整分组与独立章节，标题和目录一致', () => {
  assert.equal(guideGroups.length, 4)
  assert.equal(pages.length, 25)
  assert.equal(new Set(pages.map((page) => page.slug)).size, pages.length)
  for (const page of pages) {
    assert.equal(page.content.split('\n')[0], `# ${page.title}`)
    assert.ok(page.content.length > 200, page.slug)
    const rendered = renderGuide(page.content)
    assert.ok(rendered.headings.length >= 2, page.slug)
    assert.equal(
      new Set(rendered.headings.map((heading) => heading.id)).size,
      rendered.headings.length
    )
    assert.ok(!rendered.html.includes('<h1>'))
  }
})

test('全部正文站内链接及图片指向存在的文档或本地资源', () => {
  const parser = new MarkdownIt()
  const paths = new Set(pages.map((page) => page.path))
  for (const page of pages) {
    const tokens = parser.parse(page.content, {})
    for (const token of tokens.flatMap((entry) => entry.children || [])) {
      if (token.type === 'link_open') {
        const href = token.attrGet('href')
        if (href.startsWith('/guide/'))
          assert.ok(paths.has(href.split('#')[0]), `${page.slug}: ${href}`)
        else assert.ok(['/agent', '/enterprise', '/download'].includes(href.split('?')[0]), href)
      }
      if (token.type === 'image') {
        const source = token.attrGet('src')
        assert.ok(source.startsWith('/home/'))
        assert.ok(existsSync(new URL(`../../public${source}`, import.meta.url)), source)
      }
    }
  }
})

test('搜索覆盖正文，标题命中优先，支持多个词和无结果', () => {
  assert.equal(searchGuides(pages, '连接器')[0].slug, 'concepts/connectors')
  assert.ok(
    searchGuides(pages, 'OCTOP_HOME').some(
      (page) => page.slug === 'configuration/environment-variables'
    )
  )
  assert.ok(searchGuides(pages, '统一 账号').length > 0)
  assert.deepEqual(searchGuides(pages, '  '), [])
  assert.deepEqual(searchGuides(pages, 'unfindable-987654321'), [])
  assert.deepEqual(searchGuides(pages, '<script>'), [])
})

test('渲染为重复标题生成唯一锚点，并禁止正文执行 HTML 或脚本链接', () => {
  const source =
    '# 标题\n\n介绍\n\n## 配置\n\n内容\n\n## 配置\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))'
  const rendered = renderGuide(source)
  assert.deepEqual(
    rendered.headings.map((heading) => heading.id),
    ['配置', '配置-2']
  )
  assert.ok(rendered.lead.includes('介绍'))
  assert.ok(!rendered.lead.includes('<h2'))
  assert.ok(!rendered.html.includes('<script>'))
  assert.ok(!rendered.html.includes('href="javascript:'))
  assert.ok(rendered.body.includes('id="配置-2"'))
})

test('空正文可渲染，未知文档不被静默映射到首页', () => {
  assert.deepEqual(renderGuide(''), { html: '', lead: '', body: '', headings: [] })
  assert.equal(
    pages.find((page) => page.slug === 'missing-document'),
    undefined
  )
})

test('文档页面模板和格式化后的事件处理表达式可以编译', () => {
  const source = readFileSync(new URL('../../src/views/GuideView.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileTemplate({
    source: descriptor.template.content,
    filename: 'GuideView.vue',
    id: 'guide-test'
  })
  assert.deepEqual(compiled.errors, [])
})
