<script setup>
import { computed, ref } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import AgentManagePanel from '@/components/model-management/AgentManagePanel.vue'
import OctopExpertCatalog from '@/components/model-management/OctopExpertCatalog.vue'

const panel = ref(null)
const tab = ref('agents')
const stats = computed(() => panel.value?.stats || {})
</script>

<template>
  <div class="enterprise-agent-manage">
    <PageHeader
      title="智能体管理"
      :loading="panel?.loading || panel?.saving || false"
      :show-border="true"
    >
      <template #info>
        <div class="summary-strip">
          <span>{{ stats.total || 0 }} 个智能体</span>
          <span>{{ stats.manageable || 0 }} 个可管理</span>
        </div>
      </template>
    </PageHeader>
    <div class="agent-content">
      <a-tabs v-model:active-key="tab">
        <a-tab-pane key="agents" tab="企业智能体"><AgentManagePanel ref="panel" /></a-tab-pane>
        <a-tab-pane key="bundled" tab="内置专家"
          ><OctopExpertCatalog v-if="tab === 'bundled'" source="bundled"
        /></a-tab-pane>
        <a-tab-pane key="market" tab="专家市场"
          ><OctopExpertCatalog v-if="tab === 'market'" source="market"
        /></a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<style scoped>
.enterprise-agent-manage {
  min-height: 100%;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
}
.summary-strip {
  display: flex;
  gap: 12px;
  color: var(--color-text-secondary);
  font-size: 12px;
}
.agent-content {
  padding: 20px 24px;
}
</style>
