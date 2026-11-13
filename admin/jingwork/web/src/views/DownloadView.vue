<script setup>
import { appPath } from '@/utils/appPath'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Download,
  Globe,
  Layers3,
  Menu,
  ShieldCheck,
  Sparkles,
  Users,
  X
} from '@lucide/vue'
import { checksumUrl, desktopRelease, otherPlatforms } from '@/content/downloads'
import { isReleaseAvailable } from '@/apis/download_api'

const menuOpen = ref(false)
const copyStatus = ref('')
const copied = ref(false)
const previousTitle = document.title
const downloadStatus = ref('loading')
const platformStatus = ref({})
let downloadController
let copyTimer

async function checkDownload() {
  downloadStatus.value = 'loading'
  downloadController = new AbortController()
  const timeout = setTimeout(() => downloadController.abort(), 10000)
  try {
    downloadStatus.value = (await isReleaseAvailable(desktopRelease, {
      signal: downloadController.signal
    }))
      ? 'ready'
      : 'unavailable'
    await Promise.all(otherPlatforms.map(async (platform) => {
      try {
        platformStatus.value[platform.filename] = await isReleaseAvailable(platform, { signal: downloadController.signal })
      } catch {
        platformStatus.value[platform.filename] = false
      }
    }))
  } catch {
    downloadStatus.value = 'unavailable'
  } finally {
    clearTimeout(timeout)
  }
}

async function copyChecksum() {
  try {
    await navigator.clipboard.writeText(desktopRelease.sha256)
    copied.value = true
    copyStatus.value = 'SHA-256 已复制'
  } catch {
    copyStatus.value = '复制失败，请选择校验值后手动复制'
  }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
    copyStatus.value = ''
  }, 3000)
}

onMounted(() => {
  document.title = '下载 Jing Work · 竞网蓝鲸'
  checkDownload()
})
onBeforeUnmount(() => {
  document.title = previousTitle
  clearTimeout(copyTimer)
  downloadController?.abort()
})
</script>

<template>
  <div class="jing-home jing-download" @keydown.esc="menuOpen = false">
    <a class="skip-link" href="#download-products">跳到下载选项</a>
    <header class="site-header">
      <div class="nav-inner">
        <a class="brand" :href="appPath('/')" aria-label="竞网蓝鲸首页">
          <img :src="appPath('/home/jing-work-icon.png')" alt="" width="46" height="46" />
          <span><strong>竞网蓝鲸</strong><small>JING WORK</small></span>
        </a>
        <nav class="desktop-nav" aria-label="主导航">
          <a :href="appPath('/#overview')">概览</a><a :href="appPath('/#features')">产品能力</a
          ><a :href="appPath('/#companion')">桌面伙伴</a><a :href="appPath('/guide/')">产品文档</a>
        </nav>
        <div class="nav-actions">
          <a class="docs-link" :href="appPath('/guide/desktop')">安装指南</a>
          <a class="button nav-button" href="#download-products" aria-current="page"
            ><Download :size="16" /> 下载</a
          >
          <button
            class="menu-toggle"
            :aria-expanded="menuOpen"
            aria-controls="download-mobile-nav"
            :aria-label="menuOpen ? '关闭菜单' : '打开菜单'"
            @click="menuOpen = !menuOpen"
          >
            <X v-if="menuOpen" :size="24" /><Menu v-else :size="24" />
          </button>
        </div>
      </div>
      <nav
        v-if="menuOpen"
        id="download-mobile-nav"
        class="mobile-nav"
        aria-label="移动端导航"
        @click="menuOpen = false"
      >
        <a :href="appPath('/#overview')">概览<ChevronRight :size="16" /></a
        ><a :href="appPath('/#features')">产品能力<ChevronRight :size="16" /></a
        ><a :href="appPath('/guide/')">产品文档<BookOpen :size="16" /></a
        ><a :href="appPath('/guide/desktop')">安装指南<ChevronRight :size="16" /></a
        ><a class="button primary" href="#download-products"><Download :size="17" />下载</a>
      </nav>
    </header>

    <main>
      <section class="download-intro" aria-labelledby="download-title">
        <img
          class="download-mascot"
          :src="appPath('/home/jing-work-icon.png')"
          alt="Jing Work 蓝鲸伙伴"
          width="132"
          height="132"
        />
        <span class="download-eyebrow"><Sparkles :size="14" />你的 AI 工作伙伴</span>
        <h1 id="download-title">下载 <span>Jing Work</span></h1>
        <p>让蓝鲸常伴左右，选择适合你的工作方式。</p>
      </section>

      <section id="download-products" class="download-products" aria-label="下载与使用方式">
        <article class="download-product-card">
          <div class="download-product-visual download-client-visual">
            <img
              :src="appPath('/home/jing-chat.jpg')"
              alt="Jing Work 桌面客户端真实聊天界面"
              width="2398"
              height="1598"
            />
          </div>
          <div class="download-product-heading">
            <div>
              <h2>Jing Work 客户端</h2>
              <p>桌面工作伙伴，打开就能开始。</p>
            </div>
            <span class="download-version">内网版 v{{ desktopRelease.version }}</span>
          </div>
          <div class="download-product-body">
            <a
              v-if="downloadStatus === 'ready'"
              class="download-primary"
              :href="desktopRelease.url"
              :download="desktopRelease.filename"
              ><img :src="appPath('/downloads/apple.svg')" alt="" width="19" height="19" />下载 macOS Apple
              Silicon 版本<Download :size="18"
            /></a>
            <button
              v-else
              class="download-primary"
              :disabled="downloadStatus === 'loading'"
              @click="checkDownload"
            >
              {{ downloadStatus === 'loading' ? '正在检查安装包…' : '安装包暂不可用，点击重试' }}
            </button>
            <p class="download-file-meta">
              {{ desktopRelease.system }}<span>DMG · {{ desktopRelease.size }}</span>
            </p>
            <p class="download-preview-note">
              {{ desktopRelease.date }} 内网构建 · 未经 Apple 公证。<a href="#release-details"
                >安装前请阅读版本说明<ChevronRight :size="13"
              /></a>
            </p>
            <h3>其他平台</h3>
            <ul class="download-platforms">
              <li
                v-for="platform in otherPlatforms"
                :key="platform.name"
                class="download-platform-row"
              >
                <span class="download-platform-icon"
                  ><img :src="platform.icon" alt="" width="19" height="19"
                /></span>
                <span class="download-row-copy"
                  ><strong>{{ platform.name }}</strong
                  ><small>{{ platform.description }}</small></span
                >
                <a v-if="platformStatus[platform.filename]" :href="platform.url" :download="platform.filename" :aria-label="`下载 ${platform.name}`">下载 · {{ platform.size }} <Download :size="16" /></a>
                <span v-else class="download-unavailable">{{ platformStatus[platform.filename] === false ? '暂不可用' : '检查中…' }}</span>
              </li>
            </ul>
            <p class="download-preview-note">
              Windows 用户建议使用 Google Chrome（谷歌浏览器）下载安装包。<a href="#windows-install-help"
                >下载后无法安装？查看说明<ChevronRight :size="13"
              /></a>
            </p>
          </div>
          <footer class="download-card-footer">
            <a :href="appPath('/guide/desktop')">查看安装指南<ChevronRight :size="15" /></a
            ><a href="#release-details">版本与校验信息<ChevronRight :size="15" /></a>
          </footer>
        </article>

        <article class="download-product-card">
          <div class="download-product-visual download-web-visual">
            <img
              :src="appPath('/home/jing-work-icon.png')"
              alt="陪你协作的蓝鲸伙伴"
              width="185"
              height="185"
            /><span><Globe :size="16" />浏览器即开即用</span>
          </div>
          <div class="download-product-heading">
            <div>
              <h2>Jing Work 网页版</h2>
              <p>无需安装，在浏览器中开启协作。</p>
            </div>
            <span class="download-version">在线工作台</span>
          </div>
          <div class="download-product-body">
            <a class="download-primary" :href="appPath('/agent')"
              ><Globe :size="19" />打开网页版工作台<ArrowRight :size="18"
            /></a>
            <p class="download-file-meta">使用管理员提供的账号登录<span>无需下载安装包</span></p>
            <p class="download-preview-note">Windows、Intel Mac 或其他设备，也可以先使用网页版。</p>
            <h3>为个人与团队而设计</h3>
            <div class="download-platforms">
              <a class="download-platform-row" :href="appPath('/guide/concepts/agents')"
                ><span class="download-platform-icon"><Users :size="19" /></span
                ><span class="download-row-copy"
                  ><strong>专业智能体</strong><small>选择适合当前任务的助手</small></span
                ><ChevronRight :size="17"
              /></a>
              <a class="download-platform-row" :href="appPath('/guide/concepts/knowledge')"
                ><span class="download-platform-icon"><Layers3 :size="19" /></span
                ><span class="download-row-copy"
                  ><strong>知识与技能</strong><small>连接资料，复用工作方法</small></span
                ><ChevronRight :size="17"
              /></a>
              <a class="download-platform-row" :href="appPath('/guide/enterprise')"
                ><span class="download-platform-icon"><ShieldCheck :size="19" /></span
                ><span class="download-row-copy"
                  ><strong>企业权限</strong><small>按账号权限使用团队资源</small></span
                ><ChevronRight :size="17"
              /></a>
            </div>
          </div>
          <footer class="download-card-footer">
            <a :href="appPath('/guide/quickstart')">快速开始<ChevronRight :size="15" /></a
            ><a :href="appPath('/guide/')">阅读产品文档<ChevronRight :size="15" /></a>
          </footer>
        </article>
      </section>

      <section class="download-team" aria-labelledby="download-team-title">
        <div class="download-team-visual">
          <img
            :src="appPath('/home/jing-experts.jpg')"
            alt="Jing Work 正在运行的专家库"
            width="2398"
            height="1598"
          />
        </div>
        <div class="download-team-content">
          <span class="download-version">团队协作 · 统一管理</span>
          <h2 id="download-team-title">让蓝鲸，加入你的团队</h2>
          <p>统一管理模型、知识与智能体，让每位成员在自己的权限范围内开展工作。</p>
          <a class="download-platform-row" :href="appPath('/enterprise')"
            ><span class="download-platform-icon"><Users :size="20" /></span
            ><span class="download-row-copy"
              ><strong>企业工作台</strong><small>供已有部署的管理员管理团队资源</small></span
            ><ArrowRight :size="18"
          /></a>
          <a class="download-platform-row" :href="appPath('/guide/enterprise')"
            ><span class="download-platform-icon"><BookOpen :size="20" /></span
            ><span class="download-row-copy"
              ><strong>部署与配置说明</strong><small>了解账号、服务与模型的准备要求</small></span
            ><ChevronRight :size="18"
          /></a>
        </div>
      </section>

      <section id="windows-install-help" class="download-release-details" aria-labelledby="windows-install-title">
        <div>
          <h2 id="windows-install-title">Windows 下载后无法安装？</h2>
          <p>建议使用 Google Chrome（谷歌浏览器）打开本页，重新下载完整的 .exe 安装包。</p>
        </div>
        <dl>
          <div>
            <dt>选择版本</dt>
            <dd>Intel / AMD 处理器选择 Windows x64；ARM 处理器设备选择 Windows ARM64。可在“设置 → 系统 → 系统信息”中查看系统类型。</dd>
          </div>
          <div>
            <dt>下载不完整</dt>
            <dd>等待浏览器显示下载完成后再打开安装包。若文件仍以 .crdownload 结尾，表示下载尚未完成；请重新下载，勿修改扩展名。</dd>
          </div>
          <div>
            <dt>系统阻止运行</dt>
            <dd>若出现“Windows 已保护你的电脑”，请先确认安装包来自本页并核对 SHA-256；确认可信后，点击“更多信息 → 仍要运行”。若没有此选项或设备由企业管理，请联系管理员。</dd>
          </div>
          <div>
            <dt>仍无法安装</dt>
            <dd>请记录完整报错、Windows 版本和系统类型，联系管理员排查；也可先使用<a :href="appPath('/agent')">网页版工作台</a>。</dd>
          </div>
        </dl>
        <p><a :href="checksumUrl" download="SHA256SUMS">下载全部平台 SHA256 校验文件</a></p>
      </section>

      <section
        id="release-details"
        class="download-release-details"
        aria-labelledby="release-title"
      >
        <div>
          <h2 id="release-title">macOS 安装后无法打开？</h2>
          <p>首次打开若提示“未打开 Jing Work.app”或“Apple 无法验证”，请按以下步骤操作。</p>
        </div>
        <dl>
          <div>
            <dt>版本</dt>
            <dd>v{{ desktopRelease.version }} · {{ desktopRelease.status }}</dd>
          </div>
          <div>
            <dt>构建日期</dt>
            <dd>{{ desktopRelease.date }}</dd>
          </div>
          <div>
            <dt>系统要求</dt>
            <dd>{{ desktopRelease.system }}</dd>
          </div>
          <div>
            <dt>签名状态</dt>
            <dd>{{ desktopRelease.signing }}</dd>
          </div>
        </dl>
        <p class="download-release-warning">
          客户端连接当前内网企业后台，通过企业统一登录使用。请在公司网络或企业 VPN 环境下载安装。
        </p>
        <div class="download-mac-guide">
          <figure class="download-mac-card">
            <figcaption><span>1</span><div><h3>遇到提示，先点击“完成”</h3><p>保留应用，随后在系统设置中允许打开。</p></div></figcaption>
            <a :href="appPath('/downloads/mac-open-warning.png')" target="_blank" rel="noopener" aria-label="查看无法打开提示的大图">
              <img :src="appPath('/downloads/mac-open-warning.png')" alt="macOS 提示未打开 Jing Work.app，点击左下方的完成按钮" width="520" height="470" loading="lazy" />
            </a>
          </figure>
          <figure class="download-mac-card">
            <figcaption><span>2</span><div><h3>进入“隐私与安全性”，点击“仍要打开”</h3><p>打开“系统设置”，向下找到“安全性”，按图中红框操作。</p></div></figcaption>
            <a :href="appPath('/downloads/mac-privacy-security.png')" target="_blank" rel="noopener" aria-label="查看隐私与安全性设置的大图">
              <img :src="appPath('/downloads/mac-privacy-security.png')" alt="系统设置的隐私与安全性页面，红框标出左侧入口和右侧仍要打开按钮" width="1446" height="1054" loading="lazy" />
            </a>
          </figure>
        </div>
        <p class="download-mac-finish"><strong>最后一步：</strong>按系统提示验证身份，再点击“打开”，即可启动 Jing Work。点击图片可查看大图。</p>
        <p class="download-release-warning">
          如果没有看到“仍要打开”，请先尝试打开一次“应用程序”中的 Jing Work，再返回此设置页面。仅在确认安装包来自本下载页后允许打开。
        </p>
        <div class="download-checksum">
          <span>SHA-256</span><code>{{ desktopRelease.sha256 }}</code
          ><button aria-label="复制 SHA-256 校验值" @click="copyChecksum">
            <Check v-if="copied" :size="16" /><Copy v-else :size="16" />{{
              copied ? '已复制' : '复制'
            }}
          </button>
        </div>
        <p><a :href="checksumUrl" download="SHA256SUMS">下载全部平台 SHA256 校验文件</a></p>
        <p class="download-copy-status" role="status">{{ copyStatus }}</p>
      </section>
    </main>

    <footer class="site-footer">
      <a class="brand" :href="appPath('/')"
        ><img :src="appPath('/home/jing-work-icon.png')" alt="" width="38" height="38" /><span
          ><strong>竞网蓝鲸</strong><small>JING WORK</small></span
        ></a
      >
      <p>© {{ new Date().getFullYear() }} 竞网蓝鲸 · 让智能融入每一天</p>
      <div>
        <a :href="appPath('/guide/')">产品文档</a><a :href="appPath('/guide/guides/faq')">帮助与支持</a
        ><a :href="appPath('/')">返回官网</a>
      </div>
    </footer>
  </div>
</template>

<style src="@/assets/css/jing-home.css" scoped></style>
<style src="@/assets/css/jing-download.css" scoped></style>
