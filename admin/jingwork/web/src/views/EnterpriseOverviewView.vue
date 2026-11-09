<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Users,
  ShieldCheck,
  Monitor,
  ArrowUpRight,
  RefreshCw,
  Bot,
  LibraryBig,
  Sparkles,
  ScrollText
} from '@lucide/vue'
import { dashboardApi } from '@/apis/dashboard_api'
import { companyApi } from '@/apis/company_api'
const router = useRouter()
const loading = ref(false)
const error = ref('')
const data = ref(null)
const company = ref(null)
const updated = ref('')
const go = (page) => router.push({ path: '/enterprise', query: { page } })
const value = (number) => (number == null ? '—' : Number(number).toLocaleString('zh-CN'))
const steps = [
  {
    title: '导入成员',
    description: '管理企业通讯录，添加成员并设置所属部门',
    action: '添加成员',
    page: 'organization',
    icon: Users
  },
  {
    title: '授权智能体',
    description: '配置智能体访问权限，成员即可在客户端使用',
    action: '立即配置',
    page: 'agents',
    icon: ShieldCheck
  },
  {
    title: '登录账号',
    description: '使用统一账号登录 JING WORK，开始智能协作',
    action: '查看专家',
    page: 'experts',
    icon: Monitor
  }
]
const suites = computed(() => [
  {
    name: '企业智能体',
    description: '统一配置 · 权限共享 · 桌面端协同',
    count: data.value?.agents?.total_agents,
    unit: '个智能体',
    page: 'agents',
    icon: Bot
  },
  {
    name: '企业知识库',
    description: '文档解析 · 检索问答 · 企业知识管理',
    count: data.value?.knowledge?.total_databases,
    unit: '个知识库',
    page: 'knowledge',
    icon: LibraryBig
  },
  {
    name: '技能与专家',
    description: '技能市场 · 专家模板 · 用户独立工作区',
    count: null,
    unit: '按用户管理',
    page: 'skills',
    icon: Sparkles
  },
  {
    name: '安全与效能',
    description: '操作审计 · 对话日志 · 使用数据分析',
    count: data.value?.basic?.total_conversations,
    unit: '条会话',
    page: 'auditLogs',
    icon: ScrollText
  }
])
async function load() {
  loading.value = true
  error.value = ''
  const results = await Promise.allSettled([companyApi.get(), dashboardApi.getAllStats()])
  company.value = results[0].status === 'fulfilled' ? results[0].value : null
  data.value = results[1].status === 'fulfilled' ? results[1].value : null
  error.value = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || '数据加载失败')
    .join('；')
  if (!error.value) updated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  loading.value = false
}
onMounted(load)
</script>
<template>
  <section class="overview">
    <header class="heading">
      <h1>组织概览</h1>
      <div>
        <span>{{ updated ? `数据更新于 ${updated}` : '组织运行与资源使用' }}</span
        ><a-button :loading="loading" @click="load"><RefreshCw :size="14" />刷新</a-button>
      </div>
    </header>
    <a-alert v-if="error" type="error" :message="error" show-icon style="margin-bottom: 16px" />
    <a-spin :spinning="loading">
      <section class="panel onboarding">
        <h2>快速上手</h2>
        <div class="steps">
          <article v-for="(step, index) in steps" :key="step.page">
            <span class="step-number">{{ index + 1 }}</span>
            <div>
              <h3>{{ step.title }}</h3>
              <p>{{ step.description }}</p>
              <button class="text-action" @click="go(step.page)">
                {{ step.action }}<ArrowUpRight :size="14" />
              </button>
            </div>
            <component :is="step.icon" :size="28" class="step-icon" />
          </article>
        </div>
      </section>
      <div class="summary-grid">
        <section class="panel">
          <div class="section-heading">
            <h2>组织信息</h2>
            <a-button @click="go('company')">企业设置</a-button>
          </div>
          <p class="company-name">{{ company?.name || '企业信息暂不可用' }}</p>
          <div class="metrics">
            <div>
              <span>组织成员</span
              ><strong>{{ value(data?.basic?.total_users) }}<small> 人</small></strong
              ><button class="text-action" @click="go('organization')">
                管理成员<ArrowUpRight :size="13" />
              </button>
            </div>
            <div>
              <span>活跃成员</span
              ><strong>{{ value(data?.users?.active_users_30d) }}<small> 人</small></strong
              ><small>最近 30 天</small>
            </div>
            <div>
              <span>订阅与席位</span><strong class="plain">未接入</strong
              ><small>当前未配置计费服务</small>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="section-heading">
            <h2>用量概览</h2>
            <a-button @click="go('statisticsDetails')">用量明细</a-button>
          </div>
          <div class="metrics usage">
            <div>
              <span>对话会话</span
              ><strong>{{ value(data?.basic?.total_conversations) }}<small> 条</small></strong
              ><small>系统累计会话数</small>
            </div>
            <div>
              <span>对话消息</span
              ><strong>{{ value(data?.basic?.total_messages) }}<small> 条</small></strong
              ><small>用户与 AI 消息</small>
            </div>
            <div>
              <span>知识库文件</span
              ><strong>{{ value(data?.knowledge?.total_files) }}<small> 个</small></strong
              ><small>企业知识资源</small>
            </div>
          </div>
        </section>
      </div>
      <section class="panel suite-panel">
        <div class="section-heading">
          <div>
            <h2>智能体套件</h2>
            <p>统一管理企业智能能力与协作资源</p>
          </div>
        </div>
        <div class="suite-table">
          <div class="table-head">
            <span>智能体套件</span><span>资源概况</span><span>管理入口</span>
          </div>
          <article v-for="suite in suites" :key="suite.name">
            <div class="suite-name">
              <span class="suite-icon"><component :is="suite.icon" :size="20" /></span>
              <div>
                <h3>{{ suite.name }}</h3>
                <p>{{ suite.description }}</p>
              </div>
            </div>
            <span>{{
              suite.count == null
                ? suite.unit === '按用户管理'
                  ? suite.unit
                  : '—'
                : `${value(suite.count)} ${suite.unit}`
            }}</span
            ><button class="text-action" @click="go(suite.page)">
              管理<ArrowUpRight :size="14" />
            </button>
          </article>
        </div>
      </section>
    </a-spin>
  </section>
</template>
<style scoped>
.overview {
  padding: 24px 28px;
  max-width: 1600px;
  margin: auto;
  color: var(--color-text);
  font-size: 13px;
}
.heading,
.heading > div,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.heading {
  margin-bottom: 22px;
}
.heading h1 {
  font-size: 20px;
  margin: 0;
}
.heading > div {
  font-size: 12px;
  color: var(--gray-600);
}
.panel {
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 20px;
}
h2 {
  font-size: 15px;
  margin: 0;
}
h3 {
  font-size: 14px;
  margin: 0;
}
p {
  color: var(--gray-600);
  font-size: 12px;
  line-height: 1.6;
}
.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin-top: 24px;
}
.steps article {
  display: flex;
  gap: 14px;
  position: relative;
  padding: 18px;
  background: var(--gray-50);
  border-radius: 10px;
}
.step-number {
  flex-shrink: 0;
  background: var(--gray-100);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-weight: 600;
}
.step-icon {
  position: absolute;
  right: 12px;
  color: var(--gray-300);
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: none;
  padding: 0;
  color: var(--main-color);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.text-action:hover {
  text-decoration: underline;
}
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.company-name {
  font-size: 14px;
  color: var(--color-text);
  margin: 24px 0;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.metrics > div {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.metrics > div > span,
.metrics small {
  font-size: 12px;
  color: var(--gray-600);
}
.metrics strong {
  font-size: 28px;
  line-height: 1.3;
  font-weight: 600;
}
.metrics strong small {
  font-weight: 400;
}
.metrics .plain {
  font-size: 20px;
}
.usage {
  margin-top: 40px;
}
.section-heading p {
  margin: 8px 0 0;
}
.table-head,
.suite-table article {
  display: grid;
  grid-template-columns: minmax(250px, 2fr) 1fr 100px;
  align-items: center;
  gap: 20px;
  padding: 18px 0;
}
.table-head {
  color: var(--gray-600);
  border-bottom: 1px solid var(--gray-150);
  margin-top: 12px;
  font-size: 12px;
}
.suite-table article + article {
  border-top: 1px solid var(--gray-100);
}
.suite-name {
  display: flex;
  align-items: center;
  gap: 14px;
}
.suite-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--gray-100);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.suite-name p {
  margin: 5px 0 0;
}
.heading :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
@media (max-width: 1000px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
  .steps {
    gap: 16px;
  }
  .step-icon {
    display: none;
  }
  .steps article {
    padding-right: 0;
  }
}
@media (max-width: 700px) {
  .overview {
    padding: 16px;
  }
  .steps {
    grid-template-columns: 1fr;
  }
  .heading {
    align-items: flex-start;
  }
  .heading > div {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .panel {
    padding: 18px;
  }
  .table-head,
  .suite-table article {
    grid-template-columns: minmax(0, 1fr) 80px;
  }
  .table-head > span:nth-child(2),
  .suite-table article > span {
    display: none;
  }
  .metrics {
    gap: 8px;
  }
  .metrics strong {
    font-size: 24px;
  }
}
</style>
