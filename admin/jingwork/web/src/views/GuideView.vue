<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  List,
  Menu,
  Moon,
  Search,
  Sun,
  X
} from '@lucide/vue'
import { useThemeStore } from '@/stores/theme'
import { guideGroups } from '@/content/guide/navigation'
import { renderGuide, searchGuides } from '@/utils/guide'

const files = import.meta.glob('../content/guide/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
})
const pages = guideGroups.flatMap((group) =>
  group.pages.map((page) => ({
    ...page,
    group: group.title,
    path: `/guide/${page.slug}`,
    content: files[`../content/guide/${page.slug || 'index'}.md`]
  }))
)
const route = useRoute()
const router = useRouter()
const theme = useThemeStore()
const slug = computed(() =>
  (Array.isArray(route.params.slug)
    ? route.params.slug.join('/')
    : route.params.slug || ''
  ).replace(/\/$/, '')
)
const pageIndex = computed(() => pages.findIndex((entry) => entry.slug === slug.value))
const page = computed(() => pages[pageIndex.value])
const rendered = computed(() => renderGuide(page.value?.content || ''))
const previous = computed(() => pages[pageIndex.value - 1])
const following = computed(() => pages[pageIndex.value + 1])
const menuOpen = ref(false)
const outlineOpen = ref(false)
const headerOpen = ref(false)
const searchDialog = ref(null)
const searchInput = ref(null)
const main = ref(null)
const query = ref('')
const selectedResult = ref(0)
const results = computed(() => searchGuides(pages, query.value))
const activeHeading = ref('')
const copied = ref(false)
const copyMessage = ref('')
const codeBlocks = computed(() =>
  [...(page.value?.content || '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) =>
    match[1].trimEnd()
  )
)
const previousTitle = document.title
let scrollFrame = 0
let copyTimer

const startCards = [
  { slug: 'quickstart', title: '快速开始', description: '从第一段对话开始，与蓝鲸一起完成任务' },
  { slug: 'desktop', title: '安装与登录', description: '打开桌面客户端，进入你的工作空间' },
  { slug: 'enterprise', title: '企业工作台', description: '管理团队资源与共享智能体' },
  { slug: 'concepts/overview', title: '核心概念', description: '了解专家、知识库、连接器和技能' }
]

async function openSearch() {
  query.value = ''
  searchDialog.value.showModal()
  await nextTick()
  searchInput.value.focus()
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  outlineOpen.value = false
}

function toggleOutline() {
  outlineOpen.value = !outlineOpen.value
  menuOpen.value = false
}

function closePanels() {
  menuOpen.value = false
  outlineOpen.value = false
}

function selectSearchResult(index) {
  const result = results.value[index]
  if (!result) return
  searchDialog.value.close()
  router.push(result.path)
}

function searchKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const offset = event.key === 'ArrowDown' ? 1 : -1
    selectedResult.value = Math.max(
      0,
      Math.min(results.value.length - 1, selectedResult.value + offset)
    )
    document
      .getElementById(`guide-result-${selectedResult.value}`)
      ?.scrollIntoView({ block: 'nearest' })
  } else if (event.key === 'Enter') {
    event.preventDefault()
    selectSearchResult(selectedResult.value)
  }
}

function shortcut(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (searchDialog.value.open) searchDialog.value.close()
    else openSearch()
  }
  if (event.key === 'Escape') {
    menuOpen.value = false
    outlineOpen.value = false
    headerOpen.value = false
  }
}

function followArticleLink(event) {
  const anchor = event.target.closest('a')
  if (
    !anchor ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return
  const href = anchor.getAttribute('href')
  if (href?.startsWith('/guide/')) {
    event.preventDefault()
    router.push(href)
  }
}

async function copyExamples() {
  try {
    await navigator.clipboard.writeText(codeBlocks.value.join('\n\n'))
    copied.value = true
    copyMessage.value = '示例已复制'
  } catch {
    copyMessage.value = '复制失败，请选择代码后手动复制'
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
    copyMessage.value = ''
  }, 2500)
}

function updateHeading() {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    const headings = rendered.value.headings
    activeHeading.value = headings[0]?.id || ''
    for (const heading of headings) {
      if (document.getElementById(heading.id)?.getBoundingClientRect().top <= 150)
        activeHeading.value = heading.id
    }
    scrollFrame = 0
  })
}

function backToTop() {
  router.replace({ path: route.path })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

watch(query, () => {
  selectedResult.value = 0
})
watch(
  () => route.fullPath,
  async () => {
    menuOpen.value = false
    outlineOpen.value = false
    headerOpen.value = false
    copied.value = false
    copyMessage.value = ''
    document.title = `${page.value?.title || '文档未找到'} · Jing Work 文档`
    await nextTick()
    if (route.hash) {
      let target = route.hash.slice(1)
      try {
        target = decodeURIComponent(target)
      } catch {
        target = route.hash.slice(1)
      }
      document.getElementById(target)?.scrollIntoView({ block: 'start' })
    } else {
      window.scrollTo({ top: 0 })
      main.value?.focus({ preventScroll: true })
    }
    updateHeading()
  },
  { immediate: true }
)

onMounted(() => {
  window.addEventListener('keydown', shortcut)
  window.addEventListener('scroll', updateHeading, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', shortcut)
  window.removeEventListener('scroll', updateHeading)
  cancelAnimationFrame(scrollFrame)
  clearTimeout(copyTimer)
  document.title = previousTitle
})
</script>

<template>
  <div class="jing-guide">
    <a class="guide-skip" href="#guide-content">跳到正文</a>
    <header class="guide-header">
      <RouterLink to="/" class="guide-brand" aria-label="Jing Work 官网">
        <img src="/home/jing-work-icon.png" alt="蓝鲸" width="38" height="38" />
        <span>Jing Work <small>文档</small></span>
      </RouterLink>
      <div class="guide-header-actions">
        <button class="guide-search-trigger" aria-label="搜索文档" @click="openSearch">
          <Search :size="17" /><span>搜索文档</span><kbd>⌘ K</kbd>
        </button>
        <nav
          class="guide-top-links"
          :class="{ 'is-open': headerOpen }"
          aria-label="顶部导航"
          @click="headerOpen = false"
        >
          <RouterLink to="/guide/" :class="{ active: !slug }">指南</RouterLink>
          <RouterLink to="/guide/concepts/overview">核心概念</RouterLink>
          <RouterLink to="/guide/configuration/config-file">配置参考</RouterLink>
          <RouterLink to="/">返回官网</RouterLink>
        </nav>
        <button
          class="guide-icon-button"
          :aria-label="theme.isDark ? '切换为浅色' : '切换为深色'"
          @click="theme.toggleTheme"
        >
          <Sun v-if="theme.isDark" :size="19" /><Moon v-else :size="19" />
        </button>
        <button
          class="guide-icon-button guide-header-menu"
          aria-label="网站导航"
          :aria-expanded="headerOpen"
          @click="headerOpen = !headerOpen"
        >
          <X v-if="headerOpen" :size="20" /><Menu v-else :size="20" />
        </button>
      </div>
    </header>

    <div class="guide-mobile-bar">
      <button :aria-expanded="menuOpen" aria-controls="guide-navigation" @click="toggleMenu">
        <List :size="16" />菜单
      </button>
      <button :aria-expanded="outlineOpen" aria-controls="guide-outline" @click="toggleOutline">
        目录<ChevronDown :size="16" />
      </button>
    </div>
    <button
      v-if="menuOpen || outlineOpen"
      class="guide-backdrop"
      aria-label="关闭目录"
      @click="closePanels"
    />

    <aside
      id="guide-navigation"
      class="guide-sidebar"
      :class="{ 'is-open': menuOpen }"
      aria-label="文档导航"
    >
      <nav>
        <section v-for="group in guideGroups" :key="group.title" class="guide-nav-group">
          <h2>{{ group.title }}</h2>
          <RouterLink
            v-for="entry in group.pages"
            :key="entry.slug"
            :to="`/guide/${entry.slug}`"
            :class="{ active: slug === entry.slug }"
            :aria-current="slug === entry.slug ? 'page' : undefined"
            @click="closePanels"
          >
            {{ entry.label }}
          </RouterLink>
        </section>
      </nav>
      <div class="guide-sidebar-footer">JING WORK <span>使用文档</span></div>
    </aside>

    <main
      id="guide-content"
      ref="main"
      class="guide-article"
      tabindex="-1"
      @click="followArticleLink"
    >
      <template v-if="page">
        <h1>{{ page.title }}</h1>
        <template v-if="!slug">
          <div class="guide-prose guide-introduction" v-html="rendered.lead" />
          <div class="guide-cards">
            <RouterLink
              v-for="card in startCards"
              :key="card.slug"
              :to="`/guide/${card.slug}`"
              class="guide-card"
            >
              <span
                ><BookOpen :size="18" /><strong>{{ card.title }}</strong
                ><ChevronRight :size="16"
              /></span>
              <p>{{ card.description }}</p>
            </RouterLink>
          </div>
          <div class="guide-prose" v-html="rendered.body" />
        </template>
        <div v-else class="guide-prose" v-html="rendered.html" />
        <div v-if="codeBlocks.length" class="guide-copy-row">
          <button @click="copyExamples">
            <Check v-if="copied" :size="16" /><Copy v-else :size="16" />{{
              copied ? '已复制' : '复制本页示例'
            }}
          </button>
          <span role="status">{{ copyMessage }}</span>
        </div>
        <div class="guide-article-note">
          适用于 Jing Work 桌面与企业集成版本 · 配置与权限以实际部署为准
        </div>
        <nav class="guide-pagination" aria-label="章节翻页">
          <RouterLink v-if="previous" :to="previous.path" class="previous"
            ><small>上一页</small
            ><span><ChevronLeft :size="16" />{{ previous.label }}</span></RouterLink
          >
          <RouterLink v-if="following" :to="following.path" class="next"
            ><small>下一页</small><span>{{ following.label }}<ChevronRight :size="16" /></span
          ></RouterLink>
        </nav>
      </template>
      <div v-else class="guide-not-found">
        <BookOpen :size="40" />
        <h1>没有找到这篇文档</h1>
        <p>链接可能有误，请从左侧目录选择章节，或搜索关键词。</p>
        <RouterLink to="/guide/">返回文档首页<ChevronRight :size="16" /></RouterLink>
      </div>
    </main>

    <aside
      id="guide-outline"
      class="guide-outline"
      :class="{ 'is-open': outlineOpen }"
      aria-label="本页目录"
    >
      <h2>目录</h2>
      <nav>
        <RouterLink
          v-for="heading in rendered.headings"
          :key="heading.id"
          :to="{ path: route.path, hash: `#${heading.id}` }"
          :class="{ active: activeHeading === heading.id, nested: heading.level > 2 }"
          :aria-current="activeHeading === heading.id ? 'location' : undefined"
          >{{ heading.title }}</RouterLink
        >
      </nav>
      <button @click="backToTop"><ArrowUp :size="15" />回到顶部</button>
    </aside>

    <dialog
      ref="searchDialog"
      class="guide-search-dialog"
      aria-labelledby="guide-search-title"
      @click="$event.target === searchDialog && searchDialog.close()"
    >
      <h2 id="guide-search-title" class="guide-visually-hidden">搜索 Jing Work 文档</h2>
      <div class="guide-search-field">
        <Search :size="21" /><input
          ref="searchInput"
          v-model="query"
          aria-label="搜索文档内容"
          placeholder="搜索文档…"
          autocomplete="off"
          @keydown="searchKeydown"
        />
        <button aria-label="关闭搜索" @click="searchDialog.close()"><X :size="19" /></button>
      </div>
      <div class="guide-search-results" aria-live="polite">
        <template v-if="!query.trim()"
          ><div class="guide-search-hint">
            <BookOpen :size="28" />
            <p>查找你需要的答案</p>
            <span>试试“模型”“连接器”或“统一账号”</span>
          </div></template
        >
        <template v-else-if="results.length">
          <p class="guide-result-count">找到 {{ results.length }} 篇相关文档</p>
          <button
            v-for="(result, index) in results"
            :id="`guide-result-${index}`"
            :key="result.slug"
            class="guide-search-result"
            :class="{ selected: index === selectedResult }"
            @click="selectSearchResult(index)"
            @focus="selectedResult = index"
          >
            <small>{{ result.group }}</small
            ><strong>{{ result.title }}</strong
            ><span>{{ result.excerpt }}</span>
          </button>
        </template>
        <div v-else class="guide-search-hint">
          <Search :size="28" />
          <p>没有找到相关文档</p>
          <span>请缩短关键词，或试试其他说法。</span>
        </div>
      </div>
      <div class="guide-search-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>打开</span
        ><span><kbd>Esc</kbd>关闭</span>
      </div>
    </dialog>
  </div>
</template>

<style src="@/assets/css/jing-guide.css"></style>
