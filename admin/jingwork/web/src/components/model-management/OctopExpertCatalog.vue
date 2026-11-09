<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { BookOpen, Search, RefreshCw } from '@lucide/vue'
import { octopExpertApi } from '@/apis/octop_expert_api'
import ShareConfigForm from '@/components/ShareConfigForm.vue'
import { useUserStore } from '@/stores/user'

const props = defineProps({ source: { type: String, required: true } })
const router = useRouter()
const user = useUserStore()
const items = ref([])
const loading = ref(false)
const error = ref('')
const query = ref('')
const scene = ref('')
const sceneLabels = {
  ecommerce: '电商',
  finance: '金融',
  content: '内容创作',
  lifestyle: '生活健康',
  marketing: '营销',
  metaphysics: '玄学命理',
  mysticism: '玄学命理',
  'content-creation': '内容创作',
  academic: '学术',
  legal: '法律',
  tech: '技术',
  education: '教育',
  healthcare: '医疗健康',
  hr: '人力行政',
  media: '影视媒体',
  design: '设计'
}
const selected = ref(null)
const importing = ref(false)
const name = ref('')
const share = ref(null)
const shareForm = ref(null)
const scenes = computed(() => [...new Set(items.value.map((item) => item.scene).filter(Boolean))])
const filtered = computed(() =>
  items.value.filter(
    (item) =>
      (!scene.value || item.scene === scene.value) &&
      `${item.name} ${item.description}`.toLowerCase().includes(query.value.trim().toLowerCase())
  )
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = (await octopExpertApi.list(props.source)).items
  } catch (e) {
    error.value = e.message || '专家目录加载失败'
  } finally {
    loading.value = false
  }
}
async function preview(item) {
  loading.value = true
  try {
    selected.value = await octopExpertApi.detail(props.source, item.id)
    name.value = item.name
    share.value = {
      version: 2,
      read_scope: { access_level: 'user', user_uids: [user.uid], department_ids: [] },
      manage_scope: null
    }
  } catch (e) {
    message.error(e.message || '模板加载失败')
  } finally {
    loading.value = false
  }
}
async function create() {
  if (!name.value.trim()) {
    message.error('请填写智能体名称')
    return
  }
  const validation = shareForm.value?.validate?.()
  if (validation && !validation.valid) {
    message.error(validation.message)
    return
  }
  importing.value = true
  try {
    const result = await octopExpertApi.create(props.source, selected.value.id, {
      name: name.value,
      share_config: share.value
    })
    message.success('已导入专家及全部技能，可继续配置模型后使用')
    await router.push({ path: '/enterprise', query: { page: 'quickstart', agent: result.slug } })
  } catch (e) {
    message.error(e.message || '导入失败')
  } finally {
    importing.value = false
  }
}
watch(
  () => props.source,
  () => {
    scene.value = ''
    selected.value = null
    load()
  },
  { immediate: true }
)
</script>

<template>
  <div class="expert-catalog">
    <div class="catalog-toolbar">
      <span>共 {{ items.length }} 个{{ source === 'bundled' ? '内置' : '市场' }}专家</span>
      <a-input v-model:value="query" placeholder="搜索专家" allow-clear
        ><template #prefix><Search :size="16" /></template
      ></a-input>
      <a-button :loading="loading" @click="load"><RefreshCw :size="16" /></a-button>
    </div>
    <a-alert v-if="error" :message="error" type="error" show-icon />
    <div v-if="scenes.length" class="scene-filter">
      <a-radio-group
        v-model:value="scene"
        option-type="button"
        :options="[
          { label: '全部', value: '' },
          ...scenes.map((value) => ({ label: sceneLabels[value] || value, value }))
        ]"
      />
    </div>
    <a-spin :spinning="loading">
      <div class="expert-grid">
        <article v-for="item in filtered" :key="item.id" class="expert-card">
          <h3>
            <span class="expert-icon"><BookOpen :size="20" /></span>{{ item.name }}
          </h3>
          <p>{{ item.description || '暂无描述' }}</p>
          <footer>
            <span>{{ item.skill_count }} 个技能</span
            ><a-button type="primary" @click="preview(item)"
              >从{{ source === 'bundled' ? '模板' : '市场' }}创建</a-button
            >
          </footer>
        </article>
      </div>
      <a-empty v-if="!loading && !error && !filtered.length" description="暂无匹配专家" />
    </a-spin>
    <a-modal
      :open="Boolean(selected)"
      title="创建企业专家"
      :width="800"
      :closable="!importing"
      :mask-closable="false"
      :confirm-loading="importing"
      ok-text="导入并创建"
      @cancel="selected = null"
      @ok="create"
    >
      <template v-if="selected">
        <a-alert
          message="提示词和技能会完整导入。模型、MCP 与知识库使用企业自己的配置，不复制桌面端凭据。技能读取权限与此处选择的共享范围一致；之后扩大智能体共享范围时，请同时授权依赖技能。"
          type="info"
          show-icon
        />
        <label class="field-label">智能体名称</label
        ><a-input v-model:value="name" :maxlength="100" :disabled="importing" />
        <label class="field-label">包含技能（{{ selected.skill_slugs.length }}）</label>
        <a-tag v-for="slug in selected.skill_slugs" :key="slug">{{ slug }}</a-tag
        ><span v-if="!selected.skill_slugs.length">无</span>
        <a-collapse class="prompt-review"
          ><a-collapse-panel key="prompt" header="查看角色提示词">
            <pre>{{ selected.system_prompt }}</pre>
          </a-collapse-panel></a-collapse
        >
        <ShareConfigForm ref="shareForm" v-model="share" :disabled="importing" require-read-scope />
      </template>
    </a-modal>
  </div>
</template>

<style scoped>
.catalog-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  color: var(--color-text-secondary);
}
.catalog-toolbar .ant-input-affix-wrapper {
  width: 280px;
  margin-left: auto;
}
.scene-filter {
  margin-bottom: 20px;
}
.expert-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 16px;
}
.expert-card {
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  padding: 20px;
  background: var(--gray-0);
}
.expert-card h3 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
  font-size: 15px;
}
.expert-icon {
  background: #f3f0ff;
  color: #635bff;
  border-radius: 10px;
  padding: 10px;
  display: flex;
}
.expert-card p {
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 44px;
}
.expert-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.field-label {
  display: block;
  margin: 20px 0 8px;
  font-weight: 600;
}
.prompt-review {
  margin: 20px 0;
}
pre {
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
  font-size: 12px;
}
@media (max-width: 600px) {
  .catalog-toolbar {
    flex-wrap: wrap;
  }
  .catalog-toolbar .ant-input-affix-wrapper {
    width: 100%;
    margin: 0;
  }
}
</style>
