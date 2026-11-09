<script setup>
import { computed, ref } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import ModelProviderManagePanel from '@/components/model-management/ModelProviderManagePanel.vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const panel = ref(null)
const stats = computed(() => panel.value?.stats || {})
</script>

<template>
  <div class="enterprise-model-manage">
    <PageHeader title="模型管理" :loading="panel?.loading || false" :show-border="true">
      <template v-if="userStore.isAdmin" #info>
        <div class="summary-strip">
          <span>{{ stats.enabled || 0 }} 个启用</span>
          <span v-if="stats.warning > 0" class="warning-count">
            {{ stats.warning }} 个凭证缺失
          </span>
          <span>{{ stats.models || 0 }} 个模型</span>
        </div>
      </template>
    </PageHeader>
    <div class="model-content">
      <template v-if="userStore.isAdmin">
        <h2>模型供应商</h2>
        <ModelProviderManagePanel ref="panel" />
      </template>
      <a-result v-else status="403" title="无权访问" sub-title="模型供应商管理仅对管理员开放。" />
    </div>
  </div>
</template>

<style scoped>
.enterprise-model-manage {
  min-height: 100%;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
}
.summary-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.warning-count {
  color: var(--color-warning-700);
}
.model-content {
  padding: 20px 24px;
}
h2 {
  margin: 0 0 16px;
  font-size: 16px;
}
</style>
