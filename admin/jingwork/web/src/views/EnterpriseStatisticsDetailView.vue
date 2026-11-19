<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { Download, RefreshCw } from '@lucide/vue'
import { dashboardApi } from '@/apis/dashboard_api'
import { departmentApi } from '@/apis/department_api'
import { useUserStore } from '@/stores/user'
const store = useUserStore()
const today = () =>
  dayjs(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()))
const mode = ref('members')
const period = ref('month')
const dates = ref([today().startOf('month'), today()])
const department = ref()
const search = ref('')
const departments = ref([])
const rows = ref([])
const loading = ref(false)
const error = ref('')
let generation = 0
const presets = [
  { value: 'yesterday', label: '昨日' },
  { value: 'today', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: '7', label: '近7天' },
  { value: '30', label: '近30天' },
  { value: 'custom', label: '自定义' }
]
const dailyMember = ref(null)
const dailyRows = ref([])
const dailyLoading = ref(false)
const dailyError = ref('')
let dailyGeneration = 0
const tokenFields = new Set(['tokens', 'input_tokens', 'output_tokens', 'total_tokens'])
const number = (value) => (value == null ? '未采集' : Number(value).toLocaleString('zh-CN'))
const metrics = [
  { title: '累计对话次数', dataIndex: 'total_questions', key: 'total_questions' },
  { title: '累计会话数', dataIndex: 'total_sessions', key: 'total_sessions' },
  { title: '累计已记录 Token', dataIndex: 'total_tokens', key: 'total_tokens', width: 160 },
  { title: '期间对话次数', dataIndex: 'questions', key: 'questions' },
  { title: '期间会话数', dataIndex: 'sessions', key: 'sessions' },
  { title: '输入 Token', dataIndex: 'input_tokens', key: 'input_tokens' },
  { title: '输出 Token', dataIndex: 'output_tokens', key: 'output_tokens' },
  { title: '期间已记录 Token', dataIndex: 'tokens', key: 'tokens', width: 160 },
  { title: '用量缺失调用', dataIndex: 'missing_usage_calls', key: 'missing_usage_calls' }
].map((column) => ({
  width: 120,
  ...column,
  sorter: (left, right) => (left[column.dataIndex] ?? -1) - (right[column.dataIndex] ?? -1),
  ...(column.key === 'total_questions' ? { defaultSortOrder: 'descend' } : {})
}))
const columns = computed(() => [
  ...(mode.value === 'members'
    ? [
        { title: '姓名', dataIndex: 'username', key: 'username', width: 100, fixed: 'left' },
        { title: '部门', dataIndex: 'department', key: 'department', width: 120 }
      ]
    : [
        { title: '部门', dataIndex: 'department', key: 'department', width: 200, fixed: 'left' },
        { title: '成员数', dataIndex: 'members', key: 'members' }
      ]),
  ...metrics,
  ...(mode.value === 'members'
    ? [{ title: '明细', key: 'action', width: 100, fixed: 'right' }]
    : [])
])
const dailyColumns = [
  {
    title: '日期',
    dataIndex: 'date',
    key: 'date',
    width: 120,
    sorter: (left, right) => left.date.localeCompare(right.date),
    defaultSortOrder: 'descend'
  },
  { title: '对话次数', dataIndex: 'questions', key: 'questions' },
  { title: '会话数', dataIndex: 'sessions', key: 'sessions' },
  { title: '消息数', dataIndex: 'messages', key: 'messages' },
  { title: '输入 Token', dataIndex: 'input_tokens', key: 'input_tokens' },
  { title: '输出 Token', dataIndex: 'output_tokens', key: 'output_tokens' },
  { title: '已记录 Token', dataIndex: 'tokens', key: 'tokens' },
  { title: '用量缺失调用', dataIndex: 'missing_usage_calls', key: 'missing_usage_calls' }
]
async function showDaily(member) {
  const ticket = ++dailyGeneration
  dailyMember.value = member
  dailyLoading.value = true
  dailyError.value = ''
  dailyRows.value = []
  try {
    const result = await dashboardApi.statisticsDetails({
      mode: 'daily',
      uid: member.uid,
      start: dates.value[0].format('YYYY-MM-DD'),
      end: dates.value[1].format('YYYY-MM-DD')
    })
    if (ticket === dailyGeneration) dailyRows.value = result.items
  } catch (e) {
    if (ticket === dailyGeneration) dailyError.value = e.message || '每日明细加载失败'
  } finally {
    if (ticket === dailyGeneration) dailyLoading.value = false
  }
}
function closeDaily() {
  dailyGeneration++
  dailyMember.value = null
}
async function load() {
  const ticket = ++generation
  if (!dates.value?.[0] || !dates.value?.[1]) return
  loading.value = true
  error.value = ''
  const params = {
    mode: mode.value,
    start: dates.value[0].format('YYYY-MM-DD'),
    end: dates.value[1].format('YYYY-MM-DD')
  }
  if (department.value != null) params.department_id = department.value
  if (search.value.trim()) params.search = search.value.trim()
  try {
    const result = await dashboardApi.statisticsDetails(params)
    if (ticket === generation) rows.value = result.items
  } catch (e) {
    if (ticket === generation) {
      rows.value = []
      error.value = e.message || '明细加载失败'
    }
  } finally {
    if (ticket === generation) loading.value = false
  }
}
function customDates() {
  period.value = 'custom'
  void load()
}
function preset() {
  const now = today()
  let start = now
  if (period.value === 'custom') return
  if (period.value === 'yesterday') start = now.subtract(1, 'day')
  if (period.value === 'week') start = now.subtract((now.day() + 6) % 7, 'day')
  if (period.value === 'month') start = now.startOf('month')
  if (period.value === '7' || period.value === '30')
    start = now.subtract(Number(period.value) - 1, 'day')
  dates.value = [start, period.value === 'yesterday' ? start : now]
  void load()
}
function exportData(daily = false) {
  const exportColumns = daily ? dailyColumns : columns.value.filter((column) => column.dataIndex)
  const exportRows = daily ? dailyRows.value : rows.value
  const cell = (value) => {
    const text = String(value ?? '未采集')
    const safe = /^[\t\r\n]|^\s*[=+@-]/.test(text) ? "'" + text : text
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  const csv = [
    exportColumns.map((c) => cell(c.title)).join(','),
    ...exportRows.map((row) => exportColumns.map((c) => cell(row[c.dataIndex])).join(','))
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = daily
    ? `${dailyMember.value.username}-每日明细.csv`
    : `${mode.value === 'members' ? '成员' : '部门'}明细.csv`
  a.click()
  URL.revokeObjectURL(url)
}
onMounted(async () => {
  if (!store.isSuperAdmin) return
  void load()
  try {
    departments.value = await departmentApi.getDepartments()
  } catch (e) {
    error.value = e.message
  }
})
onBeforeUnmount(() => {
  generation++
  dailyGeneration++
})
</script>
<template>
  <section class="statistics-details">
    <h1>明细数据</h1>
    <template v-if="store.isSuperAdmin">
      <p class="description">
        对话次数按每次用户提问计数，会话数按用户、设备、专家和线程去重。累计数据覆盖全部已保存记录，期间及每日数据按北京时间筛选。Token
        汇总企业模型调用返回的实际输入与输出，历史桌面素材缺失的用量显示“未采集”。
      </p>
      <div class="detail-card">
        <a-radio-group v-model:value="mode" button-style="solid" @change="load"
          ><a-radio-button value="members">成员明细</a-radio-button
          ><a-radio-button value="departments">部门明细</a-radio-button></a-radio-group
        >
        <div class="date-toolbar">
          <a-radio-group v-model:value="period" @change="preset"
            ><a-radio-button v-for="item in presets" :key="item.value" :value="item.value">{{
              item.label
            }}</a-radio-button></a-radio-group
          ><a-range-picker v-model:value="dates" :allow-clear="false" @change="customDates" />
        </div>
        <div class="filters">
          <label>部门</label
          ><a-select
            v-model:value="department"
            placeholder="全部部门"
            allow-clear
            :options="departments.map((d) => ({ value: d.id, label: d.name }))"
            @change="load"
          /><a-input-search
            v-model:value="search"
            placeholder="搜索成员姓名 / ID"
            allow-clear
            @search="load"
          /><a-button :loading="loading" @click="load"><RefreshCw :size="14" />刷新</a-button
          ><a-button :disabled="loading || !rows.length || !!error" @click="exportData(false)"
            ><Download :size="14" />导出数据</a-button
          >
        </div>
        <a-alert v-if="error" type="error" :message="error" show-icon />
        <a-table
          :columns="columns"
          :data-source="rows"
          :loading="loading"
          :row-key="(row) => (mode === 'members' ? row.uid : String(row.id))"
          :scroll="{ x: 1480 }"
          :pagination="{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条数据`
          }"
          ><template #bodyCell="{ column, text, record }">
            <a-button v-if="column.key === 'action'" type="link" @click="showDaily(record)"
              >每日明细</a-button
            >
            <span v-else-if="tokenFields.has(column.key)">
              {{ number(text) }}
              <small
                v-if="column.key === 'total_tokens' && record.total_missing_usage_calls"
                class="unavailable"
              >
                {{ record.total_missing_usage_calls }} 次用量待补全
              </small>
            </span>
            <span v-else>{{ text ?? '—' }}</span>
          </template></a-table
        >
      </div>
      <a-modal
        :open="!!dailyMember"
        :title="`${dailyMember?.username || ''} · 每日明细`"
        :footer="null"
        :width="1040"
        @cancel="closeDaily"
      >
        <p class="description">
          {{ dates[0].format('YYYY-MM-DD') }} 至 {{ dates[1].format('YYYY-MM-DD') }} · 北京时间
        </p>
        <a-alert v-if="dailyError" type="error" :message="dailyError" show-icon />
        <a-button
          class="daily-export"
          :disabled="dailyLoading || !dailyRows.length || !!dailyError"
          @click="exportData(true)"
          >导出每日数据</a-button
        >
        <a-table
          :columns="dailyColumns"
          :data-source="dailyRows"
          row-key="date"
          :loading="dailyLoading"
          :scroll="{ x: 900 }"
          :pagination="{ pageSize: 10 }"
        >
          <template #bodyCell="{ column, text }"
            ><span>{{ tokenFields.has(column.key) ? number(text) : text }}</span></template
          >
        </a-table>
      </a-modal> </template
    ><a-result v-else status="403" title="仅超级管理员可查看明细数据" />
  </section>
</template>
<style scoped>
h1 {
  font-size: 18px;
  margin: 4px 0 18px;
}
.description {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin-bottom: 20px;
}
.detail-card {
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  border-radius: 10px;
  padding: 24px;
}
.date-toolbar {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin: 24px 0;
}
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  font-size: 13px;
}
.filters .ant-select {
  width: 180px;
}
.filters .ant-input-search {
  width: 250px;
  margin-right: auto;
}
.filters .ant-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.unavailable {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.daily-export {
  margin-bottom: 12px;
}
</style>
