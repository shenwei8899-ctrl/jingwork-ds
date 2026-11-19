<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { dashboardApi } from '@/apis/dashboard_api'
import { useThemeStore } from '@/stores/theme'
import { init } from '@/utils/dashboardCharts'
import { enterpriseProductivityTrendOption } from '@/utils/enterpriseProductivityChart'
import DashboardMetricCard from './DashboardMetricCard.vue'
import DashboardMetricGrid from './DashboardMetricGrid.vue'

const router = useRouter()
const theme = useThemeStore()
const timeRange = ref('30days')
const metric = ref('questions')
const data = ref(null)
const loading = ref(false)
const error = ref('')
const chartElement = ref(null)
let generation = 0
let chart
let observer
const count = (value) => (value == null ? '—' : Number(value).toLocaleString('zh-CN'))
const tokens = (value) => (value == null ? '未采集' : count(value))
const time = (value) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—'
const ranges = [
  { value: '7days', label: '近7天' },
  { value: '14days', label: '近14天' },
  { value: '30days', label: '近30天' },
  { value: '90days', label: '近90天' }
]
const metrics = [
  { value: 'questions', label: '对话次数' },
  { value: 'sessions', label: '活跃会话' },
  { value: 'active_users', label: '活跃成员' },
  { value: 'tokens', label: '已记录 Token' }
]
const cumulative = computed(() => [
  ['累计会话', count(data.value?.summary.sessions)],
  ['累计对话次数', count(data.value?.summary.questions)],
  ['累计消息', count(data.value?.summary.messages)],
  ['组织账号', count(data.value?.summary.members)],
  ['近30天活跃成员', count(data.value?.summary.active_users_30d)],
  ['累计已记录 Token', data.value ? tokens(data.value.summary.tokens) : '—']
])
const periodMetrics = computed(() => [
  ['期间活跃会话', count(data.value?.period.sessions)],
  ['期间对话次数', count(data.value?.period.questions)],
  ['期间活跃成员', count(data.value?.period.active_users)],
  ['期间已记录 Token', data.value ? tokens(data.value.period.tokens) : '—']
])
const memberColumns = [
  { title: '成员', dataIndex: 'username', key: 'username', width: 120 },
  { title: '对话次数', dataIndex: 'questions', key: 'questions', width: 100 },
  { title: '会话数', dataIndex: 'sessions', key: 'sessions', width: 90 },
  { title: '已记录 Token', dataIndex: 'tokens', key: 'tokens', width: 140 }
]
const expertColumns = [
  { title: '专家', dataIndex: 'agent_name', key: 'agent_name', width: 160 },
  { title: '会话数', dataIndex: 'sessions', key: 'sessions', width: 100 },
  { title: '对话次数', dataIndex: 'questions', key: 'questions', width: 110 }
]
const modelColumns = [
  { title: '模型', dataIndex: 'model_spec', key: 'model_spec', width: 220 },
  { title: '调用次数', dataIndex: 'calls', key: 'calls', width: 100 },
  { title: '输入 Token', dataIndex: 'input_tokens', key: 'input_tokens', width: 130 },
  { title: '输出 Token', dataIndex: 'output_tokens', key: 'output_tokens', width: 130 },
  { title: '已记录 Token', dataIndex: 'tokens', key: 'tokens', width: 140 },
  { title: '待补全调用', dataIndex: 'missing_usage_calls', key: 'missing_usage_calls', width: 110 }
]
const tokenKeys = new Set(['tokens', 'input_tokens', 'output_tokens'])
const openMembers = () => router.push({ path: '/enterprise', query: { page: 'statisticsDetails' } })
const openLogs = () => router.push({ path: '/enterprise', query: { page: 'conversationLogs' } })
async function load() {
  const ticket = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await dashboardApi.getEnterpriseProductivity(timeRange.value)
    if (ticket !== generation) return
    data.value = result
    await nextTick()
    renderChart()
  } catch (e) {
    if (ticket === generation) error.value = e.message || '企业研效读取失败，请刷新重试'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
function renderChart() {
  if (!chartElement.value || !data.value) return
  if (!chart) {
    chart = init(chartElement.value)
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(chartElement.value)
  }
  const styles = getComputedStyle(document.documentElement)
  chart.setOption(
    enterpriseProductivityTrendOption(data.value.daily, metric.value, {
      main: styles.getPropertyValue('--main-color').trim(),
      text: styles.getPropertyValue('--color-text-secondary').trim(),
      border: styles.getPropertyValue('--gray-150').trim()
    }),
    true
  )
}
watch([metric, () => theme.isDark], () => nextTick(renderChart))
onMounted(load)
onBeforeUnmount(() => {
  generation++
  observer?.disconnect()
  chart?.dispose()
  chart = undefined
})
</script>

<template>
  <section class="enterprise-productivity" aria-label="企业研效统计">
    <header class="toolbar">
      <span>数据更新于 {{ time(data?.generated_at) }}</span>
      <div class="actions">
        <a-button @click="openLogs">对话日志</a-button>
        <a-button @click="openMembers">成员用量</a-button>
        <a-button :loading="loading" :disabled="loading" @click="load">刷新统计</a-button>
      </div>
    </header>
    <p class="source">
      对话来自桌面已同步日志，最近同步
      {{ time(data?.last_received_at) }}。组织账号来自企业目录，Token 来自企业模型实际调用账本。
    </p>
    <a-alert v-if="error" type="error" :message="error" show-icon />
    <a-spin :spinning="loading">
      <DashboardMetricGrid class="cumulative-grid">
        <DashboardMetricCard
          v-for="[label, value] in cumulative"
          :key="label"
          :label="label"
          :value="value"
        />
      </DashboardMetricGrid>
      <section class="panel">
        <header class="panel-heading">
          <h2>期间使用情况</h2>
          <a-select
            v-model:value="timeRange"
            aria-label="统计日期范围"
            :options="ranges"
            @change="load"
          />
        </header>
        <p class="source">{{ time(data?.start) }} 至 {{ time(data?.end) }} · 北京时间</p>
        <DashboardMetricGrid class="period-grid">
          <DashboardMetricCard
            v-for="[label, value] in periodMetrics"
            :key="label"
            :label="label"
            :value="value"
            compact
          />
        </DashboardMetricGrid>
        <header class="panel-heading trend-heading">
          <h2>每日趋势</h2>
          <a-select v-model:value="metric" aria-label="趋势指标" :options="metrics" />
        </header>
        <p v-if="metric === 'tokens' && data?.period.tokens == null" class="source">
          所选日期的实际 Token 尚未采集
        </p>
        <div
          v-if="data"
          ref="chartElement"
          class="trend-chart"
          role="img"
          :aria-label="`${metrics.find((item) => item.value === metric)?.label}每日趋势`"
        />
        <p class="source">
          对话次数按用户提问计数，活跃会话按用户、设备、专家和线程去重。同一会话在多个日期有活动时会计入各日活跃会话。
        </p>
      </section>
      <div class="distribution-grid">
        <section class="panel">
          <header class="panel-heading">
            <h2>期间成员排行 TOP 10</h2>
            <a-button type="link" @click="openMembers">全部成员</a-button>
          </header>
          <a-table
            :columns="memberColumns"
            :data-source="data?.top_members || []"
            row-key="uid"
            :scroll="{ x: 450 }"
            :pagination="{ pageSize: 5, showSizeChanger: false }"
          >
            <template #bodyCell="{ column, text }"
              ><span>{{ column.key === 'tokens' ? tokens(text) : text }}</span></template
            >
          </a-table>
        </section>
        <section class="panel">
          <h2>期间专家会话分布</h2>
          <a-table
            :columns="expertColumns"
            :data-source="data?.experts || []"
            row-key="agent_id"
            :scroll="{ x: 370 }"
            :pagination="{ pageSize: 5, showSizeChanger: false }"
          />
        </section>
      </div>
      <section class="panel">
        <h2>期间模型调用与 Token</h2>
        <p class="source">
          输入 {{ tokens(data?.period.input_tokens) }} · 输出
          {{ tokens(data?.period.output_tokens) }} · 待补全用量
          {{ count(data?.period.missing_usage_calls) }} 次调用。历史 Token 缺失显示“未采集”。
        </p>
        <a-table
          :columns="modelColumns"
          :data-source="data?.models || []"
          row-key="model_spec"
          :scroll="{ x: 830 }"
          :pagination="{ pageSize: 5, showSizeChanger: false }"
        >
          <template #bodyCell="{ column, text }"
            ><span>{{ tokenKeys.has(column.key) ? tokens(text) : text }}</span></template
          >
        </a-table>
      </section>
    </a-spin>
  </section>
</template>

<style scoped>
.enterprise-productivity {
  padding: 20px var(--page-padding);
  color: var(--color-text);
  font-size: 13px;
}
.toolbar,
.actions,
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.toolbar {
  color: var(--color-text-secondary);
}
.actions {
  justify-content: flex-end;
}
.source {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.7;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.cumulative-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 16px 0;
}
.panel {
  border: 1px solid var(--gray-150);
  border-radius: 8px;
  background: var(--gray-0);
  padding: 20px;
  margin-top: 16px;
  min-width: 0;
}
h2 {
  font-size: 15px;
  font-weight: 500;
  margin: 0 0 12px;
}
.panel-heading h2 {
  margin: 0;
}
.panel-heading .ant-select {
  width: 150px;
}
.trend-heading {
  margin-top: 24px;
}
.trend-chart {
  height: 280px;
  width: 100%;
}
.distribution-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 500px), 1fr));
  gap: 16px;
}
.enterprise-productivity :deep(.dashboard-metric-value) {
  font-weight: 500;
}
@media (max-width: 700px) {
  .cumulative-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .panel {
    padding: 14px;
  }
  .enterprise-productivity {
    padding: 16px;
  }
}
</style>
