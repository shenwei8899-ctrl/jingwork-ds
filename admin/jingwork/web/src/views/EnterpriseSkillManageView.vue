<script setup>
import { ref } from 'vue'
import PageHeader from '@/components/shared/PageHeader.vue'
import SkillCardList from '@/components/extensions/SkillCardList.vue'

const skillPanel = ref(null)
</script>

<template>
  <div class="enterprise-skill-manage">
    <PageHeader title="Skill 管理" :loading="skillPanel?.loading || false" :show-border="true" />
    <SkillCardList ref="skillPanel" />
  </div>
</template>

<style scoped>
.enterprise-skill-manage {
  min-height: 100%;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
}
</style>
