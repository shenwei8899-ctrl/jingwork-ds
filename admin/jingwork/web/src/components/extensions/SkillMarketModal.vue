<script setup>
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { octopExpertApi } from '@/apis/octop_expert_api'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'prepared'])
const items = ref([])
const query = ref('')
const loading = ref(false)
const importing = ref('')
const error = ref('')
const filtered = computed(() =>
  items.value.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(query.value.toLowerCase())
  )
)
watch(
  () => props.open,
  async (open, _old, onCleanup) => {
    if (!open) return
    let active = true
    onCleanup(() => {
      active = false
    })
    loading.value = true
    error.value = ''
    try {
      const result = await octopExpertApi.list('market')
      if (active) items.value = result.items
    } catch (e) {
      if (active) error.value = e.message || '技能市场加载失败'
    } finally {
      if (active) loading.value = false
    }
  }
)
async function prepare(item) {
  if (importing.value) return
  importing.value = item.id
  try {
    const result = await octopExpertApi.prepareSkills(item.id)
    emit('prepared', result.data)
    emit('update:open', false)
  } catch (e) {
    message.error(e.message || '技能下载失败')
  } finally {
    importing.value = ''
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="从技能市场导入"
    :footer="null"
    :closable="!importing"
    :mask-closable="!importing"
    :keyboard="!importing"
    width="900px"
    @cancel="emit('update:open', false)"
  >
    <p>与桌面端同源的 SkillHub 技能集，导入前可审核依赖和共享范围。</p>
    <a-input v-model:value="query" placeholder="搜索技能市场" style="margin-bottom: 16px" />
    <a-alert v-if="error" type="error" :message="error" />
    <a-spin v-else-if="loading" />
    <a-empty v-else-if="!filtered.length" description="暂无匹配技能" />
    <div v-else class="market-grid">
      <a-card v-for="item in filtered" :key="item.id" :title="item.name">
        <p>{{ item.description }}</p>
        <span>{{ item.skill_count }} 个技能</span>
        <a-button
          type="primary"
          :loading="importing === item.id"
          :disabled="!!importing"
          @click="prepare(item)"
          >导入技能</a-button
        >
      </a-card>
    </div>
  </a-modal>
</template>

<style scoped>
.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  max-height: 60vh;
  overflow: auto;
}
.market-grid p {
  height: 66px;
  overflow: hidden;
  color: var(--color-text-secondary);
}
.market-grid button {
  float: right;
}
</style>
