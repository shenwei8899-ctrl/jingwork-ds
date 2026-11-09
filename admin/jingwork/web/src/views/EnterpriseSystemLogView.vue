<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import { useUserStore } from '@/stores/user'
import { runtimeLogApi } from '@/apis/runtime_log_api'
const userStore = useUserStore()
const filters = reactive({ username: '', uid: '', user_id: '', since: '', until: '' })
const items = ref([]), loading = ref(false), error = ref(''), cursor = ref(null), selected = ref(null)
let generation = 0, applied = {}
const columns = [
  { title: '发生时间', dataIndex: 'created_at', key: 'time', width: 190 },
  { title: '用户', key: 'user', width: 200 },
  { title: '来源', dataIndex: 'source', width: 90 },
  { title: '操作', dataIndex: 'operation', ellipsis: true },
  { title: '错误码', dataIndex: 'error_code', width: 160 },
  { title: '错误信息', dataIndex: 'message', ellipsis: true },
  { title: '详情', key: 'detail', width: 80 }
]
async function load(append = false) {
  const ticket = ++generation
  loading.value = true; error.value = ''; selected.value = null
  try {
    const data = await runtimeLogApi.list({ ...applied, ...(append ? { before_id: cursor.value } : {}) })
    if (ticket !== generation) return
    items.value = append ? [...items.value, ...data.items] : data.items
    cursor.value = data.next_cursor
  } catch (e) {
    if (ticket !== generation) return
    if (!append) { items.value = []; cursor.value = null }
    error.value = e.message || '系统日志加载失败'
  } finally { if (ticket === generation) loading.value = false }
}
function search() {
  if (filters.since && filters.until && new Date(filters.since) > new Date(filters.until)) {
    error.value = '开始时间不能晚于结束时间'; return
  }
  applied = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value != null))
  for (const key of ['since', 'until']) if (applied[key]) applied[key] = new Date(applied[key]).toISOString()
  void load()
}
function reset() { for (const key of Object.keys(filters)) filters[key] = ''; applied = {}; void load() }
onMounted(() => { if (userStore.isAdmin) void load() })
onBeforeUnmount(() => { generation++ })
</script>
<template>
  <div class="system-log-page">
    <PageHeader title="系统日志" :show-border="true" />
    <template v-if="userStore.isAdmin">
      <p>采集用户操作中的运行错误。用户身份由登录会话绑定；客户端上报内容已脱敏，不包含对话正文。</p>
      <a-space wrap class="filters">
        <a-input v-model:value="filters.username" placeholder="用户名（精确匹配）" allow-clear />
        <a-input v-model:value="filters.uid" placeholder="账号 UID" allow-clear />
        <a-input-number v-model:value="filters.user_id" :min="1" placeholder="内部用户 ID" />
        <label>开始时间 <input v-model="filters.since" type="datetime-local" /></label>
        <label>结束时间 <input v-model="filters.until" type="datetime-local" /></label>
        <a-button type="primary" :loading="loading" @click="search">查询</a-button>
        <a-button :disabled="loading" @click="reset">重置</a-button>
      </a-space>
      <a-alert v-if="error" :message="error" type="error" show-icon />
      <a-table :columns="columns" :data-source="items" row-key="id" :pagination="false" :loading="loading" :scroll="{ x: 1200 }" :locale="{ emptyText: error ? '日志加载失败，请重试' : '暂无匹配系统日志' }">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'time'">{{ new Date(record.created_at).toLocaleString('zh-CN', { hour12: false }) }}</template>
          <template v-else-if="column.key === 'user'"><strong>{{ record.username }}</strong><div>UID: {{ record.uid }} · ID: {{ record.user_id }}</div></template>
          <a-button v-else-if="column.key === 'detail'" type="link" @click="selected = record">查看</a-button>
        </template>
      </a-table>
      <a-button v-if="cursor" :loading="loading" @click="load(true)">加载更多</a-button>
      <a-drawer title="系统日志详情" :open="!!selected" width="640" @close="selected = null">
        <template v-if="selected">
          <p>用户：{{ selected.username }} · UID {{ selected.uid }} · ID {{ selected.user_id }}</p>
          <p>来源：{{ selected.source }} · 操作：{{ selected.operation }}</p>
          <p>关联 ID：{{ selected.correlation_id || '—' }}</p>
          <p>错误码：{{ selected.error_code }}</p><pre>{{ selected.message }}</pre>
          <h4>报错前的操作</h4><ol><li v-for="(action, index) in selected.context.actions" :key="index">{{ action }}</li></ol>
        </template>
      </a-drawer>
    </template>
    <a-result v-else status="403" title="仅管理员可查看系统日志" />
  </div>
</template>
<style scoped>
.system-log-page { padding: 24px; }
.filters { margin: 16px 0; }
.filters :deep(.ant-input-affix-wrapper) { width: 200px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
