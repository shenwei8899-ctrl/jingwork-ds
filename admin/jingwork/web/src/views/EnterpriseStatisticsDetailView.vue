<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { Download, RefreshCw } from '@lucide/vue'
import { dashboardApi } from '@/apis/dashboard_api'
import { departmentApi } from '@/apis/department_api'
import { useUserStore } from '@/stores/user'
const store = useUserStore()
const mode = ref('members')
const period = ref('month')
const dates = ref([dayjs().startOf('month'), dayjs()])
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
const metrics = [
  { title: '对话次数', dataIndex: 'sessions', key: 'sessions' },
  { title: '消息数', dataIndex: 'messages', key: 'messages' },
  { title: '用户消息数', dataIndex: 'questions', key: 'questions' },
  { title: 'AI 回复数', dataIndex: 'replies', key: 'replies' }
]
const columns = computed(() => [
  ...(mode.value === 'members'
    ? [
        { title: '成员 ID', dataIndex: 'uid', key: 'uid', width: 130 },
        { title: '姓名', dataIndex: 'username', key: 'username', width: 130 },
        { title: '部门', dataIndex: 'department', key: 'department', width: 180 }
      ]
    : [
        { title: '部门', dataIndex: 'department', key: 'department', width: 200 },
        { title: '成员数', dataIndex: 'members', key: 'members' }
      ]),
  ...metrics,
  ...(mode.value === 'members'
    ? [{ title: '使用专家数', dataIndex: 'experts', key: 'experts' }]
    : []),
  ...[
    '对话使用的指令次数',
    '对话引用的上下文次数',
    '对话使用的知识库次数',
    '补全生成次数',
    '补全采纳次数',
    '补全采纳率'
  ].map((title, index) => ({ title, key: 'unavailable' + index, width: 160 }))
])
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
  const now = dayjs()
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
function exportData() {
  const cell = (value) =>
    '"' +
    String(value ?? '未采集')
      .replace(/^[=+@-]/, "'$&")
      .replaceAll('"', '""') +
    '"'
  const csv = [
    columns.value.map((c) => cell(c.title)).join(','),
    ...rows.value.map((row) => columns.value.map((c) => cell(row[c.dataIndex])).join(','))
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${mode.value === 'members' ? '成员' : '部门'}明细.csv`
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
onBeforeUnmount(() => generation++)
</script>
<template>
  <section class="statistics-details">
    <h1>明细数据</h1>
    <template v-if="store.isSuperAdmin">
      <p class="description">
        统计桌面端已同步的聊天素材；对话次数按用户、设备、专家和会话去重。日期采用北京时间，尚未采集的指标显示为“未采集”。
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
          ><a-button :disabled="loading || !rows.length || !!error" @click="exportData"
            ><Download :size="14" />导出数据</a-button
          >
        </div>
        <a-alert v-if="error" type="error" :message="error" show-icon />
        <a-table
          :columns="columns"
          :data-source="rows"
          :loading="loading"
          :row-key="(row) => (mode === 'members' ? row.uid : String(row.id))"
          :scroll="{ x: 2000 }"
          :pagination="{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条数据`
          }"
          ><template #bodyCell="{ column, text }"
            ><span v-if="column.key.startsWith('unavailable')" class="unavailable">未采集</span
            ><span v-else>{{ text ?? '—' }}</span></template
          ></a-table
        >
      </div></template
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
</style>
