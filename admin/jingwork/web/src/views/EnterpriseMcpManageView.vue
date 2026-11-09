<script setup>
import PageHeader from '@/components/shared/PageHeader.vue'
import McpCardList from '@/components/extensions/McpCardList.vue'
import { useUserStore } from '@/stores/user'
const userStore = useUserStore()
</script>

<template>
  <div class="enterprise-mcp-manage">
    <PageHeader title="MCP 管理" :show-border="true" />
    <McpCardList v-if="userStore.isAdmin" />
    <a-result v-else status="403" title="无权访问" sub-title="MCP 管理仅对管理员开放。" />
  </div>
</template>

<style scoped>
.enterprise-mcp-manage {
  min-height: 100%;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
}
</style>
