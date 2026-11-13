<script setup>
import { appPath } from '@/utils/appPath'
import { computed, onActivated, onDeactivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Expand,
  GraduationCap,
  Layers3,
  Link2,
  Menu,
  MessageSquare,
  Monitor,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  X
} from '@lucide/vue'
import { useInfoStore } from '@/stores/info'
import { healthApi } from '@/apis/system_api'

const router = useRouter()
const infoStore = useInfoStore()
const docsUrl = appPath('/guide/')
const whale = appPath('/home/jing-work-icon.png')
const loading = ref(true)
const error = ref(false)
const menuOpen = ref(false)
const activeStart = ref(0)
const activeFeature = ref(0)
const openFaq = ref(0)
const preview = ref(null)
const previewImage = ref({ src: '', alt: '' })
let previousTitle = ''

const starts = [
  {
    label: '在线体验',
    icon: MessageSquare,
    title: '打开浏览器，让想法开始行动',
    description: '从一段对话开始，把整理资料、写作和分析交给你的智能伙伴。',
    steps: [
      ['登录工作台', '使用你的账号进入，找到自己的工作空间。'],
      ['选择智能体', '按任务选择合适的助手，连接需要的知识和工具。'],
      ['说出你的目标', '补充材料与要求，在对话中一起推进工作。']
    ],
    cta: '进入工作台',
    path: '/agent'
  },
  {
    label: '桌面工作',
    icon: Monitor,
    title: 'Jing Work，让 AI 走进日常工作',
    description: '在 Jing Work 客户端中，和蓝鲸一起处理文件、调用工具、完成任务。',
    steps: [
      ['打开 Jing Work', '启动已安装的桌面客户端，登录你的账号。'],
      ['挑选专属专家', '从内置专家开始，配置适合自己的技能。'],
      ['一起完成任务', '描述目标，按需授权工具操作，查看执行结果。']
    ],
    cta: '了解桌面伙伴',
    anchor: '#companion'
  },
  {
    label: '企业协作',
    icon: Users,
    title: '让每个人，都有自己的 AI 助手',
    description: '管理员统一管理成员、知识与智能体，团队在清晰的权限边界内协作。',
    steps: [
      ['进入企业控制台', '管理员配置组织和成员的访问权限。'],
      ['连接团队知识', '按需配置知识库、模型与共享智能体。'],
      ['开启团队协作', '成员使用授权能力，让知识融入日常工作。']
    ],
    cta: '进入企业控制台',
    path: '/enterprise'
  }
]
const features = [
  {
    label: '每种工作，都有合适的专家',
    icon: GraduationCap,
    tag: '专属 AI 专家',
    title: '换个专家，换一种超能力',
    description:
      '写文档、做研究、处理代码、整理资讯。从内置专家中挑选你的伙伴，再把常用技能交给它，让每一次协作更顺手。',
    image: appPath('/home/jing-experts.jpg'),
    alt: 'Jing Work 正在运行的内置专家库',
    tags: ['内置专家', '个性化配置', '多专家协作']
  },
  {
    label: '接上你每天在用的工具',
    icon: Link2,
    tag: '连接器',
    title: '熟悉的工具，现在一起工作',
    description:
      '文档、会议、笔记、邮箱……在 Jing Work 中连接常用服务，对话时按需选用。让信息在工具之间流动，把精力留给真正重要的事。',
    image: appPath('/home/jing-connectors.jpg'),
    alt: 'Jing Work 正在运行的内置连接器页面',
    tags: ['文档与会议', '笔记与知识', '按需连接']
  },
  {
    label: '把好方法，变成可复用的技能',
    icon: Layers3,
    tag: '技能包',
    title: '一次积累，让每次工作更轻松',
    description:
      '把专业方法和工作流程装进技能包。从内容创作到分镜设计，为专家搭配需要的技能，让你的经验成为持续可用的能力。',
    image: appPath('/home/jing-skills.jpg'),
    alt: 'Jing Work 正在运行的分镜设计技能包页面',
    tags: ['技能组合', '专家挂载', '工作流复用']
  },
  {
    label: '从一个想法，到一次行动',
    icon: Sparkles,
    tag: '智能工作伙伴',
    title: '说出目标，和蓝鲸一起完成',
    description:
      '总结长文、起草邮件、解释代码、拆分计划。用自然语言开启任务，把文件、工具和知识连接起来，在一个工作空间中推进。',
    image: appPath('/home/jing-chat.jpg'),
    alt: 'Jing Work 正在运行的智能助手对话首页',
    tags: ['自然语言交互', '文件与工具', '个人与企业空间']
  }
]
const faqs = [
  [
    '竞网蓝鲸能帮我做什么？',
    '竞网蓝鲸（Jing Work）是面向个人与团队的智能工作伙伴。你可以用它总结资料、起草文档、分析内容、辅助编程，也可以为专家配置知识、连接器与技能，让它参与更完整的工作流程。'
  ],
  [
    '网页版和 Jing Work 客户端有什么区别？',
    '网页版提供在线工作台与企业管理入口；Jing Work 客户端面向桌面工作，能结合配置好的本地工具处理任务。具体可用能力取决于管理员授权、已启用的工具和当前运行环境。'
  ],
  [
    '我的数据会存储在哪里？',
    '数据存储取决于你的部署方式。私有部署可将平台数据保存在自己的环境中；调用外部模型或连接器时，完成任务所需的内容会发送给相应服务。个人与企业对话按客户端所示的同步策略处理。'
  ],
  [
    '如何添加新的专家和技能？',
    '在 Jing Work 的「专家」页面选择内置模板，或创建自己的专家；在「技能包」中维护可复用技能，并按需挂载到专家。可用的企业智能体和共享能力由管理员配置。'
  ],
  [
    '是否支持团队和多用户？',
    '支持。管理员可以管理组织成员、模型、知识库和智能体的访问范围。每位成员登录自己的账号，使用获得授权的工作空间与能力。'
  ],
  [
    '如何开始使用？',
    '点击「开始使用」进入上手指引。网页版通过「进入工作台」登录；已安装 Jing Work 的用户可直接打开客户端。企业成员请使用管理员提供的账号和部署地址。'
  ]
]
const currentStart = computed(() => starts[activeStart.value])
const currentFeature = computed(() => features[activeFeature.value])

async function loadPage() {
  loading.value = true
  error.value = false
  try {
    const response = await healthApi.checkHealth()
    if (response.status !== 'ok') throw new Error('服务不可用')
    await infoStore.loadInfoConfig()
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

function enterWorkspace(path = '/agent') {
  menuOpen.value = false
  router.push(path)
}

function moveTab(event, group) {
  const selected = group === 'start' ? activeStart : activeFeature
  const count = group === 'start' ? starts.length : features.length
  const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  if (!(event.key in directions) && event.key !== 'Home' && event.key !== 'End') return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? count - 1
        : (selected.value + directions[event.key] + count) % count
  selected.value = next
  event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus()
}

function showPreview(src, alt) {
  previewImage.value = { src: appPath(src), alt }
  preview.value.showModal()
}

onMounted(loadPage)
onActivated(() => {
  previousTitle = document.title
  document.title = '竞网蓝鲸 Jing Work · 懂你、帮你、陪你成长的智能伙伴'
})
onDeactivated(() => {
  document.title = previousTitle
  menuOpen.value = false
  preview.value?.close()
})
</script>

<template>
  <div class="jing-home" @keydown.esc="menuOpen = false">
    <div v-if="loading" class="page-state" role="status">
      <img :src="whale" alt="" width="100" height="100" />
      <a-spin size="large" />
      <p>正在连接你的智能工作空间…</p>
    </div>
    <div v-else-if="error" class="page-state" role="alert">
      <img :src="whale" alt="" width="120" height="120" />
      <h1>暂时无法连接工作空间</h1>
      <p>请检查服务是否正常运行，然后再试一次。</p>
      <button class="button primary" @click="loadPage">重新连接 <ArrowRight :size="18" /></button>
      <a :href="docsUrl">查看帮助文档</a>
    </div>
    <template v-else>
      <a class="skip-link" href="#overview">跳转到主要内容</a>
      <header class="site-header">
        <div class="nav-inner">
          <a class="brand" href="#overview" aria-label="竞网蓝鲸首页" @click="menuOpen = false">
            <img :src="whale" alt="" width="46" height="46" />
            <span><strong>竞网蓝鲸</strong><small>JING WORK</small></span>
          </a>
          <nav class="desktop-nav" aria-label="主导航">
            <a href="#overview">概览</a><a href="#features">产品能力</a>
            <a href="#companion">桌面伙伴</a><a href="#faq">常见问题</a>
          </nav>
          <div class="nav-actions">
            <a class="docs-link" :href="docsUrl">产品文档</a>
            <router-link class="docs-link" to="/login?redirect=/extensions">管理后台</router-link>
            <a class="button nav-button" :href="appPath('/download')">下载 <ArrowRight :size="15" /></a>
            <button
              class="menu-toggle"
              :aria-expanded="menuOpen"
              aria-controls="mobile-nav"
              :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
              @click="menuOpen = !menuOpen"
            >
              <X v-if="menuOpen" :size="24" /><Menu v-else :size="24" />
            </button>
          </div>
        </div>
        <nav v-if="menuOpen" id="mobile-nav" class="mobile-nav" aria-label="移动端导航">
          <a href="#overview" @click="menuOpen = false">概览 <ChevronRight :size="16" /></a>
          <a href="#features" @click="menuOpen = false">产品能力 <ChevronRight :size="16" /></a>
          <a href="#companion" @click="menuOpen = false">桌面伙伴 <ChevronRight :size="16" /></a>
          <a href="#faq" @click="menuOpen = false">常见问题 <ChevronRight :size="16" /></a>
          <a :href="docsUrl" @click="menuOpen = false">产品文档 <BookOpen :size="16" /></a>
          <router-link to="/login?redirect=/extensions" @click="menuOpen = false">管理后台</router-link>
          <a class="button primary" :href="appPath('/download')">下载 <ArrowRight :size="17" /></a>
        </nav>
      </header>
      <main>
        <section id="overview" class="hero">
          <div class="hero-copy">
            <a class="eyebrow" href="#features"
              ><Sparkles :size="14" /> 你的 AI 工作伙伴 <span>JING WORK</span
              ><ChevronRight :size="13"
            /></a>
            <h1>
              <span class="hero-first"
                >懂你、帮你 <img :src="whale" alt="蓝鲸伙伴" width="108" height="108" /></span
              ><span class="gradient-text">陪你成长的智能伙伴</span>
            </h1>
            <p>把知识、工具和灵感连接起来。为个人与团队打造，让想法落地，让工作更轻松。</p>
            <div class="hero-actions">
              <a class="button primary" href="#start">开始使用 <ArrowRight :size="19" /></a>
              <a class="button secondary" :href="docsUrl"><BookOpen :size="18" /> 阅读文档</a>
            </div>
          </div>
          <div class="hero-product">
            <button
              class="product-screen"
              aria-label="放大 Jing Work 对话首页截图"
              @click="showPreview('/home/jing-chat.jpg', 'Jing Work 智能助手对话首页')"
            >
              <img
                src="/home/jing-chat.jpg"
                alt="Jing Work 客户端真实对话首页，包含蓝鲸伙伴和六种快速开始任务"
                width="2398"
                height="1598"
                fetchpriority="high"
              />
              <span class="screen-zoom"><Expand :size="15" /> 查看大图</span>
            </button>
            <div class="floating-card expert-float" aria-hidden="true">
              <p>换个专家来帮忙</p>
              <div class="chosen"><GraduationCap :size="17" /> 办公好搭档 <Check :size="14" /></div>
              <div><BookOpen :size="17" /> 知识研究员</div>
              <div><Sparkles :size="17" /> 创意小助手</div>
            </div>
            <div class="floating-card action-float" aria-hidden="true">
              <strong><Monitor :size="16" /> 让想法，真正落地</strong>
              <span><Check :size="13" /> 整理文件与资料</span
              ><span><Check :size="13" /> 连接日常工作工具</span
              ><span><Check :size="13" /> 拆解并推进任务</span>
            </div>
            <div class="floating-card privacy-float" aria-hidden="true">
              <strong><ShieldCheck :size="17" /> 你的空间，由你掌控</strong>
              <p>个人工作与企业协作，各有边界</p>
              <span class="mini-badge">私有部署 · 权限管理</span>
            </div>
          </div>
          <a href="#start" class="scroll-cue">探索更多可能 <ArrowDown :size="14" /></a>
        </section>
        <section id="start" class="section start-section">
          <div class="section-intro">
            <p class="section-kicker">START WITH JING WORK</p>
            <h2>三步<span class="accent-underline">上手</span></h2>
            <p>选一种适合你的方式，<br />和蓝鲸开启第一段协作。</p>
            <img
              class="start-whale"
              :src="whale"
              alt="向你挥手的蓝鲸伙伴"
              width="238"
              height="238"
              loading="lazy"
            />
          </div>
          <div class="start-card">
            <div class="start-tabs" role="tablist" aria-label="使用方式">
              <button
                v-for="(item, index) in starts"
                :id="`start-tab-${index}`"
                :key="item.label"
                role="tab"
                :aria-selected="activeStart === index"
                aria-controls="start-panel"
                :tabindex="activeStart === index ? 0 : -1"
                @click="activeStart = index"
                @keydown="moveTab($event, 'start')"
              >
                <component :is="item.icon" :size="17" />{{ item.label }}
              </button>
            </div>
            <div
              id="start-panel"
              class="start-panel"
              role="tabpanel"
              :aria-labelledby="`start-tab-${activeStart}`"
              tabindex="0"
            >
              <h3>{{ currentStart.title }}</h3>
              <p>{{ currentStart.description }}</p>
              <ol class="steps">
                <li v-for="(step, index) in currentStart.steps" :key="step[0]">
                  <span class="step-number">0{{ index + 1 }}</span>
                  <div>
                    <strong>{{ step[0] }}</strong>
                    <p>{{ step[1] }}</p>
                  </div>
                </li>
              </ol>
              <a v-if="currentStart.anchor" class="button primary" :href="currentStart.anchor"
                >{{ currentStart.cta }} <ArrowRight :size="17"
              /></a>
              <button v-else class="button primary" @click="enterWorkspace(currentStart.path)">
                {{ currentStart.cta }} <ArrowRight :size="17" />
              </button>
            </div>
          </div>
        </section>
        <section id="companion" class="section companion-section">
          <div class="companion-visual">
            <span class="companion-label"><span></span> YOUR EVERYDAY AI PARTNER</span>
            <img :src="whale" alt="竞网蓝鲸 3D 吉祥物" width="370" height="370" loading="lazy" />
            <div class="companion-message">
              <MessageSquare :size="19" /><span>嗨，今天有什么可以帮你？</span>
            </div>
          </div>
          <div class="companion-copy">
            <p class="section-kicker">MEET YOUR BLUE WHALE</p>
            <h2>你的<span class="gradient-text">蓝鲸伙伴</span><br />就在身旁</h2>
            <p>
              一个念头冒出来，就和它聊聊。写一封邮件、整理一份资料、把灵感变成计划——打开 Jing
              Work，让熟悉的蓝鲸陪你一起完成。
            </p>
            <div class="companion-points">
              <span><Check :size="16" /> 自然对话</span><span><Check :size="16" /> 专家协作</span
              ><span><Check :size="16" /> 工具连接</span>
            </div>
            <a class="button primary" href="#features">认识 Jing Work <ArrowRight :size="18" /></a>
          </div>
        </section>
        <section id="features" class="section features-section">
          <div class="feature-sidebar">
            <p class="section-kicker">BUILT FOR YOUR WORK</p>
            <h2>为什么选择<br /><span class="accent-underline">竞网蓝鲸</span></h2>
            <div
              class="feature-tabs"
              role="tablist"
              aria-label="产品能力"
              aria-orientation="vertical"
            >
              <button
                v-for="(feature, index) in features"
                :id="`feature-tab-${index}`"
                :key="feature.label"
                role="tab"
                :aria-selected="activeFeature === index"
                aria-controls="feature-panel"
                :tabindex="activeFeature === index ? 0 : -1"
                @click="activeFeature = index"
                @keydown="moveTab($event, 'features')"
              >
                <component :is="feature.icon" :size="19" /><span>{{ feature.label }}</span
                ><ChevronRight :size="16" />
              </button>
            </div>
          </div>
          <div
            id="feature-panel"
            class="feature-content"
            role="tabpanel"
            :aria-labelledby="`feature-tab-${activeFeature}`"
            tabindex="0"
          >
            <span class="feature-tag">{{ currentFeature.tag }}</span>
            <h3>{{ currentFeature.title }}</h3>
            <p>{{ currentFeature.description }}</p>
            <button
              class="feature-shot"
              :aria-label="`放大${currentFeature.alt}`"
              @click="showPreview(currentFeature.image, currentFeature.alt)"
            >
              <img
                :src="currentFeature.image"
                :alt="currentFeature.alt"
                width="2398"
                height="1598"
                loading="lazy"
              /><span class="screen-zoom"><Expand :size="15" /> 查看大图</span>
            </button>
            <div class="feature-tags">
              <span v-for="tag in currentFeature.tags" :key="tag"
                ><Check :size="14" />{{ tag }}</span
              >
            </div>
          </div>
        </section>
        <section id="faq" class="section faq-section">
          <div class="section-intro">
            <p class="section-kicker">A LITTLE HELP</p>
            <h2>常问问题<br /><span class="accent-underline">与帮助</span></h2>
            <p>关于蓝鲸，你可能还想知道这些。</p>
            <img class="faq-whale" :src="whale" alt="" width="210" height="210" loading="lazy" />
          </div>
          <div class="faq-list">
            <div
              v-for="(faq, index) in faqs"
              :key="faq[0]"
              class="faq-item"
              :class="{ 'is-open': openFaq === index }"
            >
              <h3>
                <button
                  :id="`faq-question-${index}`"
                  :aria-expanded="openFaq === index"
                  :aria-controls="`faq-answer-${index}`"
                  @click="openFaq = openFaq === index ? null : index"
                >
                  {{ faq[0] }}<ChevronDown v-if="openFaq === index" :size="19" /><Plus
                    v-else
                    :size="19"
                  />
                </button>
              </h3>
              <div
                v-show="openFaq === index"
                :id="`faq-answer-${index}`"
                role="region"
                :aria-labelledby="`faq-question-${index}`"
              >
                <p>{{ faq[1] }}</p>
              </div>
            </div>
          </div>
        </section>
        <section class="closing-section">
          <img :src="whale" alt="" width="94" height="94" loading="lazy" />
          <p class="section-kicker">A NEW WAY TO WORK</p>
          <h2>下一段精彩，<br class="mobile-break" />和蓝鲸一起开始</h2>
          <p>让知识成为行动，让每一天都有新的可能。</p>
          <div class="hero-actions">
            <button class="button primary" @click="enterWorkspace()">
              开启智能协作 <ArrowRight :size="18" /></button
            ><a class="button secondary" href="#start">了解使用方式</a>
          </div>
        </section>
      </main>
      <footer class="site-footer">
        <a class="brand" href="#overview"
          ><img :src="whale" alt="" width="42" height="42" /><span
            ><strong>竞网蓝鲸</strong><small>JING WORK</small></span
          ></a
        >
        <p>© {{ new Date().getFullYear() }} 竞网蓝鲸 · 让智能融入每一天</p>
        <div>
          <a href="#features">产品能力</a><a :href="docsUrl">产品文档</a><a href="#faq">帮助</a>
        </div>
      </footer>
    </template>
    <dialog
      ref="preview"
      class="image-preview"
      aria-label="Jing Work 产品截图"
      @click="$event.target === preview && preview.close()"
    >
      <button class="preview-close" aria-label="关闭大图" @click="preview.close()">
        <X :size="23" />
      </button>
      <img v-if="previewImage.src" :src="previewImage.src" :alt="previewImage.alt" />
      <p>{{ previewImage.alt }}</p>
    </dialog>
  </div>
</template>

<style scoped src="@/assets/css/jing-home.css"></style>
