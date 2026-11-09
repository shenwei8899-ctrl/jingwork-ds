<script setup>
import { onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { departmentApi } from '@/apis/department_api'
import PageHeader from '@/components/shared/PageHeader.vue'
import { useUserStore } from '@/stores/user'
import { operationLogApi } from '@/apis/operation_log_api'

const userStore = useUserStore()
const departments = ref([])
const roleOptions = [
  { value: 'superadmin', label: '超级管理员' },
  { value: 'admin', label: '管理员' },
  { value: 'user', label: '普通用户' }
]
const filters = reactive({
  department_id: undefined,
  role: undefined,
  user_id: undefined,
  operation: undefined,
  since: '',
  until: ''
})
const options = ref({ users: [], operations: [] })
const items = ref([])
const cursor = ref(null)
const selected = ref(null)
const loading = ref(false)
const error = ref('')
let generation = 0
let applied = {}
const columns = [
  { title: '时间', key: 'timestamp', dataIndex: 'timestamp', width: 200 },
  { title: '员工', key: 'username', width: 180 },
  { title: '操作类型', dataIndex: 'operation', width: 180 },
  { title: 'IP 地址', dataIndex: 'ip_address', width: 150 },
  { title: '操作详情', dataIndex: 'details', ellipsis: true },
  { title: '操作', key: 'detail', width: 80 }
]
const formatTime = (value) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
async function load(append = false) {
  const ticket = ++generation
  loading.value = true
  selected.value = null
  error.value = ''
  try {
    const result = await operationLogApi.list({
      ...applied,
      ...(append ? { before_id: cursor.value } : {})
    })
    if (ticket !== generation) return
    items.value = append ? [...items.value, ...result.items] : result.items
    cursor.value = result.next_cursor
  } catch (e) {
    if (ticket !== generation) return
    if (!append) {
      items.value = []
      cursor.value = null
    }
    error.value = e.message || '操作日志加载失败'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
function search() {
  if (filters.since && filters.until && new Date(filters.since) > new Date(filters.until)) {
    error.value = '开始时间不能晚于结束时间'
    return
  }
  applied = {
    department_id: filters.department_id,
    role: filters.role,
    user_id: filters.user_id,
    operation: filters.operation,
    since: filters.since ? new Date(filters.since).toISOString() : undefined,
    until: filters.until ? new Date(filters.until).toISOString() : undefined
  }
  void load()
}
function reset() {
  Object.assign(filters, {
    department_id: undefined,
    role: undefined,
    user_id: undefined,
    operation: undefined,
    since: '',
    until: ''
  })
  applied = {}
  void load()
}
onMounted(async () => {
  if (!userStore.isAdmin) return
  void load()
  try {
    const [logOptions, teams] = await Promise.all([
      operationLogApi.filters(),
      departmentApi.getDepartments()
    ])
    options.value = logOptions
    departments.value = teams
  } catch (e) {
    error.value = e.message || '筛选项加载失败'
  }
})
onBeforeUnmount(() => {
  generation++
})
</script>

<template>
  <section class="audit-view">
    <PageHeader title="操作日志" :show-border="true" />
    <div v-if="userStore.isAdmin" class="audit-content">
      <a-alert
        type="info"
        show-icon
        message="查询已记录的账号、用户及部门管理操作。"
        description="日志来自 Yuxi 持久化记录；不包含对话正文、模型密钥或尚未接入审计的操作。时间按当前浏览器时区显示。"
      />
      <a-alert v-if="error" type="error" show-icon :message="error" />
      <form class="audit-filters" @submit.prevent="search">
        <label
          >团队<a-select
            v-model:value="filters.department_id"
            aria-label="团队"
            allow-clear
            show-search
            option-filter-prop="label"
            placeholder="全部团队"
            :options="departments.map((team) => ({ value: team.id, label: team.name }))"
        /></label>
        <label
          >岗位<a-select
            v-model:value="filters.role"
            aria-label="岗位"
            allow-clear
            placeholder="全部岗位"
            :options="roleOptions"
        /></label>
        <label
          >员工<a-select
            v-model:value="filters.user_id"
            allow-clear
            show-search
            option-filter-prop="label"
            placeholder="全部员工"
            :options="
              options.users.map((user) => ({
                value: user.id,
                label: `${user.username} (${user.uid})`
              }))
            "
        /></label>
        <label
          >操作类型<a-select
            v-model:value="filters.operation"
            allow-clear
            show-search
            placeholder="全部操作"
            :options="options.operations.map((value) => ({ value, label: value }))"
        /></label>
        <label>开始时间<a-input v-model:value="filters.since" type="datetime-local" /></label>
        <label>结束时间<a-input v-model:value="filters.until" type="datetime-local" /></label>
        <a-button type="primary" html-type="submit" :loading="loading">查询</a-button>
        <a-button @click="reset">重置</a-button>
        <a-button :disabled="loading" @click="load()">刷新</a-button>
      </form>
      <a-table
        :columns="columns"
        :data-source="items"
        row-key="id"
        :loading="loading"
        :pagination="false"
        :scroll="{ x: 1000 }"
        :locale="{ emptyText: error ? '日志加载失败，请重试' : '暂无匹配操作日志' }"
      >
        <template #bodyCell="{ column, record, text }">
          <template v-if="column.key === 'timestamp'">{{ formatTime(text) }}</template>
          <template v-else-if="column.key === 'username'">{{
            record.username || record.user_id
          }}</template>
          <a-button v-else-if="column.key === 'detail'" type="link" @click="selected = record"
            >详情</a-button
          >
        </template>
      </a-table>
      <div class="audit-footer">
        <span>已加载 {{ items.length }} 条</span
        ><a-button v-if="cursor" :loading="loading" @click="load(true)">加载更多</a-button>
      </div>
      <a-drawer title="操作日志详情" :open="!!selected" width="560" @close="selected = null">
        <a-descriptions v-if="selected" bordered :column="1">
          <a-descriptions-item label="日志 ID">{{ selected.id }}</a-descriptions-item>
          <a-descriptions-item label="时间">{{
            formatTime(selected.timestamp)
          }}</a-descriptions-item>
          <a-descriptions-item label="员工"
            >{{ selected.username || '—' }} ({{
              selected.uid || selected.user_id
            }})</a-descriptions-item
          >
          <a-descriptions-item label="操作类型">{{ selected.operation }}</a-descriptions-item>
          <a-descriptions-item label="IP 地址">{{
            selected.ip_address || '—'
          }}</a-descriptions-item>
          <a-descriptions-item label="详情"
            ><div class="audit-detail">
              {{ selected.details || '无额外详情' }}
            </div></a-descriptions-item
          >
        </a-descriptions>
      </a-drawer>
    </div>
    <a-result v-else status="403" title="无权访问" sub-title="操作日志仅对管理员开放。" />
  </section>
</template>

<style scoped>
.audit-view {
  min-height: 100%;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
}
.audit-content {
  padding: 24px;
  display: grid;
  gap: 18px;
}
.audit-filters {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
}
.audit-filters label {
  display: grid;
  gap: 6px;
  min-width: 180px;
}
.audit-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--color-text-secondary);
}
.audit-detail {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
