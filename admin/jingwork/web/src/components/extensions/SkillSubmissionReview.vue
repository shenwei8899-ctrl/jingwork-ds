<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  listSkillSubmissions,
  reviewSkillSubmission,
  scanSkillSubmission
} from '@/apis/skill_api'

const items = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const query = ref('')
const status = ref('all')
const selected = ref(null)
const comment = ref('')
const labels = { pending: '待审核', approved: '已发布', rejected: '已拒绝', withdrawn: '已下架' }
const filtered = computed(() => items.value.filter((item) =>
  (status.value === 'all' || item.status === status.value) &&
  `${item.name} ${item.slug} ${item.submitted_by}`.toLowerCase().includes(query.value.toLowerCase())
))

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = (await listSkillSubmissions()).data
  } catch (failure) {
    error.value = failure.message || '获取审核列表失败，请重试'
  } finally {
    loading.value = false
  }
}

function open(item) {
  selected.value = item
  comment.value = item.review_comment || ''
}

async function act(action) {
  busy.value = true
  try {
    const result = action === 'scan'
      ? await scanSkillSubmission(selected.value.id)
      : await reviewSkillSubmission(selected.value.id, action, comment.value)
    selected.value = result.data
    items.value = items.value.map((item) => item.id === result.data.id ? result.data : item)
    message.success(action === 'scan' ? '扫描报告已更新' : '审核结果已保存')
  } catch (failure) {
    message.error(failure.message || '操作失败，请重试')
  } finally {
    busy.value = false
  }
}

function scanLabel(report) {
  if (report.status === 'completed') return `${report.max_severity || '无风险项'} · ${(report.findings || []).length} 项提示`
  return report.status === 'failed' ? '扫描失败' : '等待扫描'
}

onMounted(load)
</script>

<template>
  <section class="review-panel" aria-label="桌面 Skill 审核">
    <div class="review-toolbar">
      <h2>桌面上传审核</h2>
      <a-input v-model:value="query" placeholder="搜索名称、标识或提交人" aria-label="搜索提交" />
      <a-select v-model:value="status" aria-label="审核状态">
        <a-select-option value="all">全部状态</a-select-option>
        <a-select-option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</a-select-option>
      </a-select>
      <a-button :loading="loading" @click="load">刷新</a-button>
    </div>
    <a-alert v-if="error" type="error" :message="error" show-icon />
    <a-spin :spinning="loading">
      <div class="review-list">
        <article v-for="item in filtered" :key="item.id" class="review-card">
          <div class="review-identity">
            <h3>{{ item.name }}</h3>
            <span>{{ item.slug }} · {{ item.submitted_by }}</span>
            <p>{{ item.description }}</p>
          </div>
          <div class="review-status">
            <span>{{ labels[item.status] }}</span>
            <span>{{ scanLabel(item.scan_report) }}</span>
            <a-button @click="open(item)">查看与审核</a-button>
          </div>
        </article>
        <a-empty v-if="!loading && !error && !filtered.length" description="暂无符合条件的桌面提交" />
      </div>
    </a-spin>
    <a-modal :open="!!selected" title="Skill 内容与安全审核" :footer="null" :width="900" :closable="!busy"
      :mask-closable="!busy" @cancel="selected = null">
      <template v-if="selected">
        <h3>{{ selected.name }} · {{ labels[selected.status] }}</h3>
        <p>提交人 {{ selected.submitted_by }} · {{ selected.created_at }}</p>
        <p class="content-hash">内容 SHA-256 {{ selected.content_hash }}</p>
        <pre class="skill-source">{{ selected.content }}</pre>
        <h3>安全扫描</h3>
        <p>Cisco Skill Scanner · {{ scanLabel(selected.scan_report) }}</p>
        <p v-if="selected.scan_report.error" role="alert">{{ selected.scan_report.error }}</p>
        <p>静态扫描可能存在漏报或误报，请结合正文和风险提示进行审核。</p>
        <ul class="findings">
          <li v-for="(finding, index) in selected.scan_report.findings || []" :key="index">
            <strong>{{ finding.severity }} · {{ finding.title }}</strong>
            <p>{{ finding.description }}</p>
            <p v-if="finding.remediation">{{ finding.remediation }}</p>
          </li>
        </ul>
        <label for="skill-review-comment">审核意见（拒绝或下架时必填）</label>
        <a-textarea id="skill-review-comment" v-model:value="comment" :maxlength="2000" :rows="3" :disabled="busy" />
        <p v-if="selected.reviewed_at">最近审核 {{ selected.reviewed_at }}</p>
        <div class="review-actions">
          <a-button :disabled="busy" @click="act('scan')">重新扫描</a-button>
          <a-button :disabled="busy || !comment.trim()" @click="act('rejected')">拒绝</a-button>
          <a-button danger :disabled="busy || !comment.trim() || selected.status !== 'approved'" @click="act('withdrawn')">下架</a-button>
          <a-button type="primary" :disabled="busy || selected.status === 'approved' || selected.scan_report.status !== 'completed'"
            @click="act('approved')">审核通过并发布</a-button>
        </div>
        <p v-if="busy" role="status">正在处理，请稍候…</p>
      </template>
    </a-modal>
  </section>
</template>

<style scoped>
.review-panel { padding: 24px; border-bottom: 1px solid var(--gray-150); }
.review-toolbar, .review-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.review-toolbar h2 { font-size: 18px; font-weight: 500; margin: 0 auto 0 0; }
.review-toolbar :deep(.ant-input) { width: 260px; max-width: 100%; }
.review-toolbar :deep(.ant-select) { width: 140px; }
.review-list { display: grid; gap: 12px; margin-top: 16px; }
.review-card { display: flex; gap: 16px; justify-content: space-between; padding: 16px; border: 1px solid var(--gray-150); border-radius: 8px; }
.review-identity { min-width: 0; overflow-wrap: anywhere; }
.review-identity h3 { margin: 0 0 6px; font-size: 16px; font-weight: 500; }
.review-identity span, .content-hash { color: var(--gray-600); font-size: 13px; overflow-wrap: anywhere; }
.review-identity p { margin: 8px 0 0; white-space: pre-wrap; }
.review-status { display: flex; flex-shrink: 0; flex-direction: column; gap: 8px; align-items: flex-end; font-size: 13px; }
.skill-source { max-height: 280px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 16px; background: var(--gray-50); border: 1px solid var(--gray-150); }
.findings { max-height: 240px; overflow: auto; padding-left: 20px; }
.findings strong { font-weight: 500; }
.review-actions { justify-content: flex-end; margin-top: 16px; }
@media (max-width: 600px) {
  .review-panel { padding: 16px; }
  .review-card { flex-direction: column; }
  .review-status { align-items: flex-start; }
}
</style>
