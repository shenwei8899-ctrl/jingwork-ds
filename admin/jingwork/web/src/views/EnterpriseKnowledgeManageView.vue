<script setup>
import { ref } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import DataBaseView from '@/views/DataBaseView.vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const knowledgePanel = ref(null)
</script>

<template>
  <div class="enterprise-knowledge-manage">
    <PageHeader title="知识库" :loading="knowledgePanel?.loading || false" :show-border="true" />
    <DataBaseView v-if="userStore.isAdmin" ref="knowledgePanel" embedded />
    <a-result v-else status="403" title="无权访问" sub-title="知识库管理仅对管理员开放。" />
  </div>
</template>

<style scoped>
.enterprise-knowledge-manage {
  min-height: 100%;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
}
</style>
