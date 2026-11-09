<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import { Bot, Microscope, RefreshCw, Upload, Rocket } from '@lucide/vue'
import { agentApi } from '@/apis/agent_api'
import { userApi } from '@/apis/user_api'
import AgentRuntimeConfigForm from '@/components/AgentRuntimeConfigForm.vue'
import ShareConfigForm from '@/components/ShareConfigForm.vue'
import FallbackAvatar from '@/components/common/FallbackAvatar.vue'
import { isBuiltinAgent, useAgentStore } from '@/stores/agent'
import { useUserStore } from '@/stores/user'
import { generatePixelAvatar } from '@/utils/pixelAvatar'
import { createAgentConfigDraft } from '@/utils/agentEditorConfig'
import { normalizeAgentBackendOption } from '@/utils/agentConfigUtils'
import { MAX_IMAGE_UPLOAD_SIZE_BYTES, MAX_IMAGE_UPLOAD_SIZE_MB } from '@/utils/upload_limits'

const userStore = useUserStore()
const agentStore = useAgentStore()
const route = useRoute()
const router = useRouter()
const agentModalActiveTab = ref('basic')
const sections = [
  { key: 'basic', label: '基本信息' },
  { key: 'model', label: '模型配置' },
  { key: 'knowledge', label: '知识库' },
  { key: 'skills', label: 'Skills' },
  { key: 'mcp', label: 'MCP' },
  { key: 'builtinTools', label: '工具' },
  { key: 'subagents', label: '子智能体' },
  { key: 'other', label: '其他配置' }
]
const currentStep = computed(() =>
  sections.findIndex((section) => section.key === agentModalActiveTab.value)
)
const isLastStep = computed(() => currentStep.value === sections.length - 1)
function nextStep() {
  if (!isLastStep.value) agentModalActiveTab.value = sections[currentStep.value + 1].key
}
const backendOptions = ref([])
const editingAgentId = ref(null)
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const agentIconUploading = ref(false)
const agentShareConfigFormRef = ref(null)
const agentNameInputRef = ref(null)
const agentForm = reactive({
  name: '',
  slug: '',
  backend_id: 'ChatbotAgent',
  description: '',
  icon: ''
})
const agentShareConfig = ref({
  version: 2,
  read_scope: {
    access_level: 'user',
    department_ids: [],
    user_uids: userStore.uid ? [userStore.uid] : []
  },
  manage_scope: null
})
const config = ref({})
const items = ref({})
const baseline = ref('')
const draftKey = () => `yuxi:enterprise-agent-draft:${userStore.uid}:${route.query.agent || 'new'}`
const draftRestored = ref(false)
const saveDraft = () => {
  if (loading.value || saving.value || agentIconUploading.value || loadError.value) return
  try {
    localStorage.setItem(draftKey(), JSON.stringify({ version: 1, data: JSON.parse(snapshot()) }))
    baseline.value = snapshot()
    draftRestored.value = true
    message.success('草稿已保存在当前浏览器，尚未发布')
  } catch {
    message.error('草稿保存失败，请检查浏览器存储空间')
  }
}
const snapshot = () =>
  JSON.stringify({ form: agentForm, share: agentShareConfig.value, config: config.value })
const dirty = computed(() => baseline.value && snapshot() !== baseline.value)
const canEditAgentShareConfig = computed(() => !isBuiltinAgent({ id: editingAgentId.value }))
const getAgentShareAllowedLevels = () =>
  canEditAgentShareConfig.value
    ? userStore.isAdmin
      ? ['global', 'department', 'user']
      : ['user']
    : ['global']
const selectedBackendOption = computed(() =>
  backendOptions.value.find((item) => item.value === agentForm.backend_id)
)
const selectedBackendLabel = computed(
  () => selectedBackendOption.value?.label || agentForm.backend_id
)
const selectedBackendIcon = computed(() =>
  /deep|search/i.test(agentForm.backend_id) ? Microscope : Bot
)
const agentPreviewDefaultIcon = computed(() =>
  editingAgentId.value ? generatePixelAvatar(editingAgentId.value) : ''
)
const agentPreviewName = computed(() => agentForm.name || '你的企业 Agent')
const previewPrompt = computed(() => {
  const key =
    Object.keys(items.value).find((key) => key === 'system_prompt') ||
    Object.keys(items.value).find((key) => items.value[key]?.kind === 'prompt')
  return key ? config.value[key] || '尚未设置角色与行为' : '尚未设置角色与行为'
})
let schemaGeneration = 0
const refreshSchema = async (reset = false) => {
  const generation = ++schemaGeneration
  const backend = agentForm.backend_id
  const detail = await agentApi.getAgentBackendDetail(backend)
  if (generation !== schemaGeneration || backend !== agentForm.backend_id) return
  const schema = Object.fromEntries(
    Object.entries(detail.configurable_items || {}).map(([key, value]) => [
      key,
      { ...value, ...value.x_oap_ui_config }
    ])
  )
  items.value = schema
  if (reset) config.value = createAgentConfigDraft(schema)
}
const editor = computed(() => ({
  agent: { id: editingAgentId.value || 'new-agent', can_manage: true },
  config: config.value,
  items: items.value,
  update: (updates) => Object.assign(config.value, updates),
  refresh: () => refreshSchema(false)
}))
const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const backends = await agentApi.getAgentBackends()
    backendOptions.value = (backends.backends || []).map(normalizeAgentBackendOption)
    if (route.query.agent) {
      const result = await agentApi.getAgentDetail(String(route.query.agent))
      const detail = result.agent || result
      if (!detail.can_manage) throw new Error('当前智能体不可编辑')
      editingAgentId.value = detail.agent_id || detail.slug || detail.id
      Object.assign(agentForm, {
        name: detail.name || '',
        slug: editingAgentId.value,
        backend_id: detail.backend_id,
        description: detail.description || '',
        icon: detail.icon || ''
      })
      agentShareConfig.value = detail.share_config || agentShareConfig.value
      await refreshSchema(true)
      config.value = createAgentConfigDraft(
        items.value,
        detail.config_json?.context || detail.config_json || {}
      )
    } else await refreshSchema(true)
    baseline.value = snapshot()
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey()) || 'null')
      if (
        draft?.version === 1 &&
        draft.data?.form &&
        draft.data?.config &&
        draft.data?.share &&
        backendOptions.value.some((option) => option.value === draft.data.form.backend_id) &&
        (!editingAgentId.value || draft.data.form.backend_id === agentForm.backend_id)
      ) {
        Object.assign(agentForm, draft.data.form)
        agentShareConfig.value = draft.data.share
        await refreshSchema(true)
        config.value = createAgentConfigDraft(items.value, draft.data.config)
        baseline.value = snapshot()
        draftRestored.value = true
      }
    } catch {
      message.warning('本地草稿无法恢复，已加载服务器配置')
    }
  } catch (error) {
    loadError.value = error.message || '加载智能体配置失败'
  } finally {
    loading.value = false
  }
}
watch(
  () => agentForm.backend_id,
  async () => {
    if (loading.value || editingAgentId.value) return
    loading.value = true
    loadError.value = ''
    try {
      await refreshSchema(true)
    } catch (error) {
      loadError.value = error.message || '加载后端配置失败'
    } finally {
      loading.value = false
    }
  }
)
watch(agentModalActiveTab, async (tab) => {
  if (tab !== 'mcp' || loading.value || loadError.value) return
  try {
    await refreshSchema(false)
  } catch (error) {
    message.error(error.message || '刷新 MCP 选项失败')
  }
})
onMounted(load)
const beforeAgentIconUpload = (file) => {
  if (!file.type.startsWith('image/')) {
    message.error('只能上传图片文件')
    return false
  }
  if (file.size > MAX_IMAGE_UPLOAD_SIZE_BYTES) {
    message.error(`图片大小不能超过 ${MAX_IMAGE_UPLOAD_SIZE_MB}MB`)
    return false
  }
  uploadAgentIcon(file)
  return false
}
const uploadAgentIcon = async (file) => {
  agentIconUploading.value = true
  try {
    const data = await userApi.uploadImage(file)
    agentForm.icon = data.image_url || data.url || ''
  } catch (error) {
    message.error(error.message || '图标上传失败')
  } finally {
    agentIconUploading.value = false
  }
}
const saveAgent = async () => {
  if (saving.value || loading.value || loadError.value) return
  if (!agentForm.name.trim()) {
    agentModalActiveTab.value = 'basic'
    message.error('请填写智能体名称')
    return
  }
  const validation = canEditAgentShareConfig.value
    ? agentShareConfigFormRef.value?.validate?.()
    : null
  if (validation && !validation.valid) {
    agentModalActiveTab.value = 'basic'
    message.error(validation.message)
    return
  }
  saving.value = true
  const publishingDraftKey = draftKey()
  try {
    const payload = {
      name: agentForm.name.trim(),
      description: agentForm.description.trim() || null,
      icon: agentForm.icon || null,
      share_config: agentShareConfig.value,
      config_json: { context: JSON.parse(JSON.stringify(config.value)) },
      is_subagent: agentForm.backend_id === 'SubAgentBackend'
    }
    const saved = editingAgentId.value
      ? await agentStore.updateAgentProfile(editingAgentId.value, payload)
      : await agentStore.createAgent({
          ...payload,
          slug: agentForm.slug.trim() || undefined,
          backend_id: agentForm.backend_id
        })
    try {
      localStorage.removeItem(publishingDraftKey)
    } catch {
      /* 发布成功不受本地清理失败影响 */
    }
    draftRestored.value = false
    editingAgentId.value = saved.id
    agentForm.slug = saved.id
    baseline.value = snapshot()
    await router.replace({ path: '/enterprise', query: { page: 'quickstart', agent: saved.id } })
    message.success('智能体已发布')
  } catch (error) {
    message.error(error.message || '发布智能体失败')
  } finally {
    saving.value = false
  }
}
const confirmLeave = () => {
  if (saving.value) return false
  if (!dirty.value) return true
  return new Promise((resolve) =>
    Modal.confirm({
      title: '离开并放弃未保存的配置？',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  )
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate((to, from) => {
  if (to.query.page === from.query.page && to.query.agent === from.query.agent) return true
  if (saving.value && to.query.agent === editingAgentId.value) return true
  return confirmLeave()
})
</script>
<template>
  <section class="quickstart-editor">
    <header class="editor-header">
      <h1>{{ editingAgentId ? '编辑智能体' : '新建 Agent' }}</h1>
      <div>
        <span v-if="dirty" class="dirty-label">有未保存修改</span>
        <span v-else-if="draftRestored" class="dirty-label">草稿未发布</span>
        <a-button
          :disabled="loading || saving || !!loadError || agentIconUploading"
          @click="saveDraft"
          >保存草稿</a-button
        >
        <a-button
          class="publish-button"
          type="primary"
          :loading="saving"
          :disabled="loading || !!loadError || agentIconUploading"
          @click="saveAgent"
          ><Rocket :size="16" />发布</a-button
        >
      </div>
    </header>
    <a-alert v-if="loadError" type="error" :message="loadError" show-icon
      ><template #action><a-button @click="load">重试</a-button></template></a-alert
    >
    <a-spin :spinning="loading"
      ><div class="editor-body">
        <nav class="editor-navigation" aria-label="Agent 配置菜单">
          <button
            v-for="section in sections"
            :key="section.key"
            :class="{ active: agentModalActiveTab === section.key }"
            :aria-current="agentModalActiveTab === section.key ? 'step' : undefined"
            @click="agentModalActiveTab = section.key"
          >
            {{ section.label }}
          </button>
        </nav>
        <div class="agent-modal-main">
          <section v-show="agentModalActiveTab === 'basic'" class="agent-modal-section">
            <div class="agent-profile-header">
              <div class="agent-icon-preview" aria-label="智能体图标、名称与后端">
                <div class="agent-profile-main">
                  <a-upload
                    :show-upload-list="false"
                    :before-upload="beforeAgentIconUpload"
                    :disabled="agentIconUploading"
                    accept="image/*"
                  >
                    <div
                      class="agent-icon-upload"
                      :class="{
                        uploading: agentIconUploading,
                        'is-empty': !agentForm.icon && !editingAgentId
                      }"
                    >
                      <FallbackAvatar
                        v-if="agentForm.icon || editingAgentId"
                        :src="agentForm.icon"
                        :default-src="agentPreviewDefaultIcon"
                        :name="agentPreviewName"
                        :seed="editingAgentId || agentForm.slug || agentForm.name"
                        kind="agent"
                        :size="56"
                        shape="rounded"
                        :alt="`${agentForm.name || '智能体'}图标`"
                        class="agent-icon-preview-avatar"
                      />
                      <div class="agent-icon-mask">
                        <RefreshCw v-if="agentIconUploading" :size="16" class="spinning" />
                        <Upload v-else :size="16" />
                        <span>{{ agentForm.icon ? '更换图标' : '上传图标' }}</span>
                      </div>
                    </div>
                  </a-upload>
                  <div class="agent-icon-preview-text">
                    <input
                      ref="agentNameInputRef"
                      v-model="agentForm.name"
                      class="agent-inline-name-input"
                      type="text"
                      placeholder="点击输入智能体名称"
                      aria-label="智能体名称"
                    />
                    <input
                      v-if="!editingAgentId"
                      v-model="agentForm.slug"
                      class="agent-inline-slug-input"
                      type="text"
                      placeholder="标识可选，留空自动生成"
                      aria-label="智能体标识"
                    />
                    <span v-else class="agent-inline-slug">{{
                      agentForm.slug || editingAgentId
                    }}</span>
                  </div>
                </div>
                <div
                  class="agent-backend-summary"
                  :class="{ editable: !editingAgentId }"
                  aria-label="智能体后端"
                >
                  <span class="agent-backend-icon">
                    <component :is="selectedBackendIcon" :size="16" />
                  </span>
                  <div class="agent-backend-text">
                    <span class="agent-backend-label">智能体后端</span>
                    <a-select
                      v-if="!editingAgentId"
                      v-model:value="agentForm.backend_id"
                      class="agent-backend-select"
                      :bordered="false"
                      :options="backendOptions"
                      :disabled="loading || saving"
                    />
                    <span v-else class="agent-backend-name">{{ selectedBackendLabel }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-form">
              <label class="form-label full-width">
                <span>描述</span>
                <a-textarea
                  v-model:value="agentForm.description"
                  class="agent-description-textarea"
                  :rows="3"
                  placeholder="可选"
                />
              </label>
            </div>

            <div v-if="canEditAgentShareConfig" class="share-config-block">
              <div class="section-heading">
                <span>共享权限</span>
              </div>
              <ShareConfigForm
                ref="agentShareConfigFormRef"
                v-model="agentShareConfig"
                :auto-select-user-dept="true"
                :allowed-access-levels="getAgentShareAllowedLevels()"
              />
            </div>
          </section>

          <a-alert
            v-if="agentModalActiveTab === 'mcp' && !loading && !loadError"
            type="info"
            show-icon
            style="margin-bottom: 16px"
          >
            <template #message>
              选择已启用的 MCP 供当前智能体使用。
              <router-link :to="{ path: '/enterprise', query: { page: 'mcp' } }" target="_blank">
                管理 MCP
              </router-link>
              后，可点击下方刷新更新选项。
            </template>
          </a-alert>
          <AgentRuntimeConfigForm
            v-if="!loading && !loadError"
            v-show="agentModalActiveTab !== 'basic'"
            :editor="editor"
            :segment="agentModalActiveTab"
            :show-segmented="false"
          />
          <footer class="step-actions">
            <a-button
              type="primary"
              :loading="saving"
              :disabled="loading || saving || !!loadError || agentIconUploading"
              @click="isLastStep ? saveAgent() : nextStep()"
              >{{ isLastStep ? '保存并发布' : '下一步' }}</a-button
            >
          </footer>
        </div>
        <aside class="configuration-preview" aria-label="配置预览">
          <h2>配置预览</h2>
          <div class="preview-introduction">
            <FallbackAvatar
              :src="agentForm.icon"
              default-src="/enterprise-logo.png"
              :name="agentPreviewName"
              :seed="editingAgentId || agentForm.name"
              kind="agent"
              :size="100"
              shape="rounded"
              :alt="`${agentPreviewName}头像`"
            />
            <h3>Hi，我是 {{ agentPreviewName }}</h3>
            <p>{{ agentForm.description || '配置模型、工具和知识，创建你的企业助手' }}</p>
          </div>
          <a-alert
            type="info"
            message="这里是配置预览。保存后可在 Yuxi 智能体列表中打开对话，使用已配置的智能体。"
          />
          <section class="preview-role">
            <h3>角色与设定</h3>
            <pre>{{ previewPrompt }}</pre>
          </section>
        </aside>
      </div></a-spin
    >
  </section>
</template>
<style lang="less" scoped>
.step-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 28px;
  padding: 16px 0;
}

.quickstart-editor {
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  min-height: 100%;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--gray-150);
}
.editor-header h1 {
  font-size: 20px;
  margin: 0;
}
.editor-header > div {
  display: flex;
  align-items: center;
  gap: 12px;
}
.publish-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: #635bff;
  border-color: #635bff;
}
.dirty-label {
  font-size: 12px;
  color: var(--color-warning-600);
}
.editor-body {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) minmax(260px, 29%);
  min-height: 720px;
}
.editor-navigation {
  padding: 20px 12px;
  background: var(--gray-10);
}
.editor-navigation button {
  width: 100%;
  min-height: 60px;
  margin-bottom: 12px;
  padding: 16px 18px;
  border: 0;
  border-right: 3px solid transparent;
  border-radius: 12px 0 0 12px;
  color: var(--color-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.editor-navigation button:hover {
  background: var(--gray-50);
}
.editor-navigation button.active {
  background: var(--gray-0);
  border-right-color: #635bff;
  font-weight: 600;
}
.editor-navigation button:focus-visible {
  outline: 2px solid var(--main-color);
}
.configuration-preview {
  min-width: 0;
  padding: 28px 24px;
  border-left: 1px solid var(--gray-150);
  background: var(--gray-50);
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
}
.preview-introduction {
  padding: 64px 0 28px;
  text-align: center;
  h3 {
    margin: 24px 0 16px;
    font-size: 22px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: 14px;
    line-height: 1.8;
    overflow-wrap: anywhere;
  }
}
.preview-role {
  margin-top: 28px;
  h3 {
    margin: 0 0 14px;
    font-size: 14px;
    font-weight: 500;
  }
  pre {
    margin: 0;
    padding: 20px;
    border-radius: 12px;
    background: var(--gray-0);
    color: var(--color-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 13px/1.7 monospace;
    max-height: 440px;
    overflow: auto;
  }
}
@media (max-width: 1000px) {
  .editor-body {
    grid-template-columns: 130px minmax(0, 1fr);
  }
  .configuration-preview {
    grid-column: 2;
    border-left: 0;
    border-top: 1px solid var(--gray-150);
  }
  .preview-introduction {
    padding-top: 24px;
  }
}
@media (max-width: 768px) {
  .editor-body {
    grid-template-columns: 1fr;
  }
  .configuration-preview {
    grid-column: 1;
  }
  .editor-navigation {
    display: flex;
    overflow-x: auto;
  }
  .editor-navigation button {
    min-width: 110px;
    margin-bottom: 0;
  }
  .agent-icon-preview {
    flex-wrap: wrap;
  }
}

.agent-modal-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
}

.agent-modal-title {
  color: var(--gray-900);
  font-size: 16px;
  font-weight: 600;
}

.agent-modal-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  :deep(.ant-btn) {
    min-width: 56px;
    border-radius: 6px;
    font-weight: 500;
  }

  :deep(.ant-btn-primary) {
    border-color: var(--main-700);
    background: var(--main-700);

    &:hover,
    &:focus {
      border-color: var(--main-800);
      background: var(--main-800);
    }
  }
}

.agent-modal-content {
  display: grid;
  grid-template-columns: 144px minmax(0, 1fr);
  height: min(72vh, 640px);
  min-height: 0;
  overflow: hidden;
  background: var(--gray-0);

  &.without-sidebar {
    grid-template-columns: minmax(0, 1fr);
  }

  &.create-mode {
    height: auto;
    min-height: 360px;
  }
}

.agent-modal-sidebar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  padding: 14px 10px;
  overflow-y: auto;
  border-right: 1px solid var(--gray-150);
  background: transparent;
}

.agent-modal-nav-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 34px;
  padding: 6px 9px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--gray-800);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: var(--gray-50);
    color: var(--gray-900);
  }

  &:focus-visible {
    outline: 2px solid var(--main-100);
    outline-offset: 1px;
    border-color: var(--main-200);
  }

  &.active {
    background: var(--gray-100);
    color: var(--gray-900);

    span {
      font-weight: 600;
    }
  }
}

.nav-item-main {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 8px;

  svg {
    flex-shrink: 0;
    color: var(--gray-600);
  }
}

.agent-modal-nav-item.active .nav-item-main svg {
  color: var(--gray-700);
}

.nav-dirty-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-warning-600);
}

.agent-modal-main {
  min-width: 0;
  min-height: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
  padding: 22px 18px 24px 24px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--gray-300) transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: var(--gray-300);
    background-clip: content-box;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--gray-400);
    background-clip: content-box;
  }
}

.agent-modal-section {
  min-height: 0;
  background: var(--gray-0);
}

.runtime-section {
  display: flex;
  flex-direction: column;
  min-height: 100%;

  :deep(.agent-runtime-config-form) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
    background: transparent;
  }

  :deep(.runtime-config-content) {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0;
    overflow: visible;
  }
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--gray-900);
  font-size: 14px;
  font-weight: 600;
}

.agent-profile-header {
  margin-bottom: 16px;
}

.agent-icon-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-width: 0;
  gap: 16px;

  :deep(.ant-upload) {
    display: block;
  }
}

.agent-profile-main {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.agent-icon-upload {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  overflow: hidden;
  border: 1px solid var(--gray-200);
  border-radius: 12px;
  background: var(--main-30);
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease;

  .agent-icon-preview-avatar {
    width: 100%;
    height: 100%;
    border: 0;
  }

  &:hover,
  &:focus-within,
  &.uploading {
    border-color: var(--main-300);
    box-shadow: 0 0 0 3px var(--main-50);
  }

  &:hover .agent-icon-mask,
  &:focus-within .agent-icon-mask,
  &.uploading .agent-icon-mask,
  &.is-empty .agent-icon-mask {
    opacity: 1;
  }

  &.is-empty {
    border-style: dashed;
    background: var(--gray-0);
  }
}

.agent-icon-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: color-mix(in srgb, var(--gray-900) 62%, transparent);
  color: var(--gray-0);
  font-size: 11px;
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.agent-icon-upload.is-empty .agent-icon-mask {
  background: transparent;
  color: var(--gray-600);
}

.agent-icon-preview-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  line-height: 1.25;
}

.agent-inline-name-input {
  width: 200px;
  max-width: 100%;
  padding: 1px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--gray-900);
  caret-color: var(--main-700);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;

  &::placeholder {
    color: var(--gray-400);
  }

  &:hover {
    border-color: var(--gray-300);
    background: var(--gray-0);
  }

  &:focus {
    border-color: var(--main-300);
    background: var(--gray-0);
    box-shadow: 0 0 0 3px var(--main-50);
    outline: none;
  }
}

.agent-inline-slug,
.agent-inline-slug-input {
  padding: 1px 4px;
  width: 200px;
  max-width: 100%;
  overflow: hidden;
  color: var(--gray-500);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-inline-slug-input {
  border: 1px solid transparent;
  border-radius: 2px;
  background: transparent;

  &::placeholder {
    color: var(--gray-400);
  }

  &:hover,
  &:focus {
    border-color: var(--gray-300);
    background: var(--gray-0);
    outline: none;
  }
}

.agent-backend-summary {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 10px;
  width: 190px;
  min-height: 56px;
  padding: 10px 12px;
  border: 1px solid var(--gray-200);
  border-radius: 12px;
  background: var(--gray-10);
  color: var(--gray-700);

  &.editable {
    padding-right: 8px;
  }
}

.agent-backend-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--gray-100);
  color: var(--gray-700);
}

.agent-backend-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
  line-height: 1.2;
}

.agent-backend-label {
  color: var(--gray-500);
  font-size: 11px;
}

.agent-backend-name {
  max-width: 128px;
  overflow: hidden;
  color: var(--gray-900);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-backend-select {
  width: 128px;
  margin: -3px 0 -5px -11px;

  :deep(.ant-select-selector) {
    background: transparent !important;
    box-shadow: none !important;
  }

  :deep(.ant-select-selection-item) {
    color: var(--gray-900);
    font-size: 13px;
    font-weight: 600;
  }

  :deep(.ant-select-arrow) {
    color: var(--gray-500);
  }
}

.share-config-block {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--gray-150);
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-label {
  display: flex;
  flex-direction: column;
  gap: 6px;

  > span {
    color: var(--gray-700);
    font-size: 12px;
    font-weight: 500;
  }
}

.agent-description-textarea {
  min-height: 80px;
  padding: 10px 12px;
  border-color: var(--gray-200);
  border-radius: 8px;
  background: var(--gray-10);
  color: var(--gray-900);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    box-shadow 0.16s ease;

  &::placeholder {
    color: var(--gray-400);
  }

  &:hover {
    border-color: var(--gray-300);
    background: var(--gray-0);
  }

  &:focus {
    border-color: var(--main-300);
    background: var(--gray-0);
    box-shadow: 0 0 0 3px var(--main-50);
  }
}

.full-width {
  grid-column: 1 / -1;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 768px) {
  .agent-modal-content {
    grid-template-columns: 1fr;
    height: min(78vh, 680px);
  }

  .agent-modal-sidebar {
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--gray-150);
  }
}

:global(.agent-edit-modal .ant-modal-content) {
  overflow: hidden;
  padding: 0;
  border-radius: 12px;
}

:global(.agent-edit-modal .ant-modal-header) {
  margin: 0;
  padding: 10px 24px;
  border-bottom: 1px solid var(--gray-150);
  background: var(--gray-0);
}

:global(.agent-edit-modal .ant-modal-title) {
  width: 100%;
}

:global(.agent-edit-modal .ant-modal-body) {
  padding: 0;
}
</style>
