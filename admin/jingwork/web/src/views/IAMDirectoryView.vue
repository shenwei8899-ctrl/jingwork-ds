<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { iamApi } from '@/apis/iam_api'

const resource = ref('users')
const page = ref(1)
const rows = ref([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
let controller
const columns = computed(() => {
  const fields = {
    users: [['user_name', '登录账号'], ['emp_name', '员工姓名'], ['user_status', '账号状态'],
      ['plat_admin', '平台管理员'], ['plat_tenant_admin', '企业管理员']],
    emps: [['emp_id', '员工编号'], ['emp_name', '员工姓名'], ['org_id', '组织编号'], ['emp_status', '员工状态']],
    orgs: [['org_id', '组织编号'], ['org_name', '组织名称'], ['org_parent', '上级组织编号'], ['org_status', '组织状态']]
  }
  return fields[resource.value].map(([dataIndex, title]) => ({ dataIndex, title, key: dataIndex }))
})
function rowKey(row) {
  return row.user_id || row.emp_id || row.org_id
}
async function load() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  rows.value = []
  try {
    const data = await iamApi.directory(resource.value, {
      page: page.value, size: 20, signal: current.signal
    })
    if (current.signal.aborted) return
    rows.value = data.items
    total.value = data.meta.total
  } catch {
    if (!current.signal.aborted) error.value = '企业目录加载失败，请重试。'
  } finally {
    if (!current.signal.aborted) loading.value = false
  }
}
watch(resource, () => { page.value = 1; load() })
watch(page, load)
load()
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section aria-label="企业身份目录">
    <h1>企业人员与组织</h1>
    <a-alert type="info" show-icon message="人员、组织和管理员权限由竞网统一身份平台维护。此处展示 IAM 权威目录。" />
    <a-tabs v-model:active-key="resource">
      <a-tab-pane key="users" tab="用户账号" />
      <a-tab-pane key="emps" tab="员工目录" />
      <a-tab-pane key="orgs" tab="组织架构" />
    </a-tabs>
    <a-alert v-if="error" type="error" show-icon :message="error">
      <template #action><a-button @click="load">重试</a-button></template>
    </a-alert>
    <a-table :columns="columns" :data-source="rows" :row-key="rowKey" :loading="loading"
      :scroll="{ x: 640 }" :pagination="{ current: page, pageSize: 20, total, showSizeChanger: false }"
      @change="pagination => page = pagination.current">
      <template #bodyCell="{ column, text }">
        <template v-if="['plat_admin', 'plat_tenant_admin'].includes(column.key)">{{ text === 1 ? '是' : '否' }}</template>
        <template v-else-if="column.key === 'emp_status'">{{ text === 0 ? '在职' : '离职' }}</template>
        <template v-else-if="['user_status', 'org_status'].includes(column.key)">{{ text === 1 ? '正常' : '停用' }}</template>
        <template v-else>{{ text }}</template>
      </template>
    </a-table>
  </section>
</template>
