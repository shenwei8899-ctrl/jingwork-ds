<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const iamDenied = computed(() => route.query.iam_denied === '1')
const requiredRole = computed(() => route.query.role === 'superadmin' ? '超级管理员' : '管理员')
</script>

<template>
  <main class="access-help">
    <a-result
      status="403"
      title="当前账号没有此页面的访问权限"
      :sub-title="iamDenied ? '当前账号尚未获准使用此系统，请联系企业管理员开通权限。' : `此页面需要${requiredRole}权限。请联系企业管理员确认账号角色。`"
    >
      <template #extra>
        <p v-if="!iamDenied">模型供应商、API Key 和可用模型由管理员在「AI 资源管理 → 模型管理」中配置；普通成员使用获授权的模型。</p>
        <router-link v-if="!iamDenied" to="/agent"><a-button type="primary">返回对话</a-button></router-link>
        <router-link to="/"><a-button>返回官网</a-button></router-link>
      </template>
    </a-result>
  </main>
</template>

<style scoped>
.access-help {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--gray-10);
}
p {
  max-width: 560px;
  margin: 0 auto 24px;
  color: var(--color-text-secondary);
}
a + a { margin-left: 12px; }
</style>
