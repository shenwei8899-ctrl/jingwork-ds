<script setup>
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { desktopToolsApi as api } from '@/apis/desktop_tools_api'
const members = ref([])
const uid = ref('')
const policy = ref(null)
const disabled = ref([])
const loading = ref(false)
const error = ref('')
let ticket = 0
async function load() {
  const current = ++ticket
  policy.value = null
  error.value = ''
  loading.value = true
  try {
    const value = await api.read(uid.value)
    if (current === ticket) {
      policy.value = value
      disabled.value = [...value.disabled_tools]
    }
  } catch (e) {
    if (current === ticket) error.value = e.message
  } finally {
    if (current === ticket) loading.value = false
  }
}
async function save() {
  loading.value = true
  error.value = ''
  try {
    const value = await api.save(uid.value, {
      expected_revision: policy.value.revision,
      disabled_tools: disabled.value
    })
    policy.value = value
    disabled.value = [...value.disabled_tools]
    message.success('授权已保存，桌面端工具调用立即检查最新授权')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
function toggle(name, enabled) {
  disabled.value = enabled
    ? disabled.value.filter((item) => item !== name)
    : [...new Set([...disabled.value, name])]
}
onMounted(async () => {
  try {
    members.value = await api.members()
    if (members.value.length) {
      uid.value = members.value[0].uid
      await load()
    }
  } catch (e) {
    error.value = e.message
  }
})
</script>
<template>
  <section class="tool-management">
    <h1>工具管理</h1>
    <p>按账号授权桌面端工具。员工可在「个性化 → 工具」中关闭已授权工具，不能开启后台禁止的工具。</p>
    <a-alert v-if="error" type="error" :message="error" show-icon />
    <a-space class="toolbar">
      <a-select
        v-model:value="uid"
        aria-label="选择成员"
        :disabled="loading"
        style="min-width: 240px"
        :options="members.map((m) => ({ value: m.uid, label: `${m.username} (${m.uid})` }))"
        @change="load"
      />
      <a-button :loading="loading" :disabled="!uid" @click="load">刷新</a-button>
      <a-button type="primary" :loading="loading" :disabled="!policy" @click="save"
        >保存授权</a-button
      >
    </a-space>
    <a-spin :spinning="loading">
      <a-empty v-if="!policy && !loading && !error" description="请选择成员" />
      <template v-if="policy">
        <h2>内置工具</h2>
        <div class="tool-grid">
          <article
            v-for="tool in policy.tools.filter((t) => t.source === 'builtin')"
            :key="tool.name"
          >
            <div>
              <strong>{{ tool.label || tool.name }}</strong
              ><small>{{ tool.category }} · {{ tool.name }}</small>
            </div>
            <a-switch
              :aria-label="tool.name"
              :checked="!disabled.includes(tool.name)"
              :disabled="loading"
              @change="(value) => toggle(tool.name, value)"
            />
          </article>
        </div>
        <h2>插件工具</h2>
        <p>
          成员在桌面端打开工具页面后，已安装插件的工具目录会同步到这里。新增插件工具须经管理员授权才能使用。
        </p>
        <a-empty
          v-if="!policy.tools.some((t) => t.source === 'plugin')"
          description="暂无已同步插件工具"
        />
        <div class="tool-grid">
          <article
            v-for="tool in policy.tools.filter((t) => t.source === 'plugin')"
            :key="tool.name"
          >
            <div>
              <strong>{{ tool.label || tool.name }}</strong
              ><small>{{ tool.name }}</small>
            </div>
            <a-switch
              :aria-label="tool.name"
              :checked="!disabled.includes(tool.name)"
              :disabled="loading"
              @change="(value) => toggle(tool.name, value)"
            />
          </article>
        </div>
      </template>
    </a-spin>
  </section>
</template>
<style scoped>
.toolbar {
  margin: 20px 0;
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: 16px;
}
article {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--border-color);
  background: var(--bg-color);
  border-radius: 12px;
}
small {
  display: block;
  color: var(--text-secondary);
  margin-top: 8px;
}
h2 {
  margin: 24px 0 16px;
}
</style>
