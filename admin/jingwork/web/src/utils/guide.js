import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true })

export function renderGuide(source) {
  const tokens = markdown.parse(source, {})
  const headings = []
  const usedIds = new Map()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'heading_open' || token.tag === 'h1') continue
    const title = tokens[index + 1].content
    const base =
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '') || 'section'
    const count = usedIds.get(base) || 0
    usedIds.set(base, count + 1)
    const id = count ? `${base}-${count + 1}` : base
    token.attrSet('id', id)
    headings.push({ id, title, level: Number(token.tag.slice(1)) })
  }
  const body = tokens[0]?.tag === 'h1' ? tokens.slice(3) : tokens
  const firstSection = body.findIndex((token) => token.type === 'heading_open')
  const splitAt = firstSection < 0 ? body.length : firstSection
  return {
    html: markdown.renderer.render(body, markdown.options, {}),
    lead: markdown.renderer.render(body.slice(0, splitAt), markdown.options, {}),
    body: markdown.renderer.render(body.slice(splitAt), markdown.options, {}),
    headings
  }
}

export function searchGuides(pages, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return pages
    .map((page) => {
      const text = page.content
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[#*`>|]/g, '')
        .replace(/\s+/g, ' ')
      const title = `${page.title} ${page.label}`.toLowerCase()
      const searchable = `${title} ${page.description} ${text}`.toLowerCase()
      if (!terms.every((term) => searchable.includes(term))) return null
      const position = text.toLowerCase().indexOf(terms[0])
      const start = Math.max(0, position - 28)
      return {
        ...page,
        score: terms.filter((term) => title.includes(term)).length,
        excerpt: `${start > 0 ? '…' : ''}${text.slice(start, start + 110)}${text.length > start + 110 ? '…' : ''}`
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)
}
