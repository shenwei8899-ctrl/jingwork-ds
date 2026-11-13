<template>
  <main class="cli-auth-view">
    <section class="cli-auth-panel" aria-labelledby="authorization-title">
      <header class="brand">
        <img :src="appPath('/jingwork-logo.png')" alt="" width="40" height="40" />
        <span>JingWork</span>
      </header>
      <h1 id="authorization-title">{{ approved ? '登录已确认' : '确认设备登录' }}</h1>
      <p class="intro">{{ approved ? '设备已获授权，可以返回客户端继续工作' : '请核对授权码，确认这是你本人发起的登录' }}</p>

      <a-spin v-if="loading" class="loading" tip="正在读取设备授权…" />
      <template v-else>
        <a-alert v-if="errorMessage" class="authorization-error" type="error" :message="errorMessage" show-icon />
        <a-result v-if="approved" status="success" title="授权成功" sub-title="可以关闭此页面并返回 JingWork" />
        <div v-else-if="session" class="session-summary">
          <div class="code-block">
            <span class="code-label">设备授权码</span>
            <strong>{{ userCode }}</strong>
          </div>
          <dl>
            <div><dt>应用名称</dt><dd>{{ applicationName }}</dd></div>
            <div><dt>授权状态</dt><dd><span class="status">{{ canApprove ? statusLabel : '已失效' }}</span></dd></div>
            <div><dt>有效期至</dt><dd>{{ expiryLabel }}</dd></div>
          </dl>
          <p v-if="canApprove" class="security-note">确认后，此设备将使用你的企业账号。统一登录退出或失效后，设备授权同步失效。</p>
          <a-button v-if="canApprove" class="authorize-button" type="primary" size="large" :loading="approving" @click="approveSession">
            确认登录 JingWork
          </a-button>
        </div>
        <a-button v-else class="retry-button" @click="loadSession">重新读取</a-button>
      </template>
    </section>
  </main>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { appPath } from '@/utils/appPath'
import { authApi } from '@/apis/auth_api'

const route = useRoute()
const loading = ref(true)
const approving = ref(false)
const approved = ref(false)
const errorMessage = ref('')
const session = ref(null)
const applicationName = computed(() => {
  const name = session.value?.key_name
  return !name || name === 'DeepSeek Harness' ? 'JingWork' : name
})
const statusLabel = computed(() => approved.value ? '已授权' : '等待确认')
const expiryLabel = computed(() => {
  const date = new Date(session.value?.expires_at)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date)
})
const canApprove = computed(() => session.value?.status === 'pending' && !approved.value)

const userCode = computed(() =>
  String(route.query.user_code || '')
    .trim()
    .toUpperCase()
)

async function loadSession() {
  if (!userCode.value) {
    errorMessage.value = '缺少设备授权码，请返回客户端重新登录'
    loading.value = false
    return
  }
  try {
    loading.value = true
    errorMessage.value = ''
    session.value = await authApi.getCLIAuthSession(userCode.value)
    if (['approved', 'consumed'].includes(session.value.status)) approved.value = true
    else if (session.value.status !== 'pending') errorMessage.value = '登录请求已失效，请返回客户端重新登录'
  } catch (error) {
    errorMessage.value = error.message || '无法读取设备授权，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function approveSession() {
  try {
    approving.value = true
    errorMessage.value = ''
    await authApi.approveCLIAuthSession(userCode.value)
    approved.value = true
  } catch (error) {
    errorMessage.value = error.message || '设备授权未完成，请重试'
  } finally {
    approving.value = false
  }
}

onMounted(loadSession)
</script>
<style scoped lang="less">
.cli-auth-view {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: 40px 20px;
  background: var(--gray-50);
  color: var(--color-text);
}
.cli-auth-panel {
  width: min(460px, 100%);
  padding: 36px;
  border: 1px solid var(--gray-150);
  border-radius: 20px;
  background: var(--color-bg-container);
  box-shadow: 0 12px 40px var(--shadow-1);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
  font-size: 20px;
  font-weight: 500;
  img { object-fit: contain; border-radius: 10px; }
}
h1 { margin: 0; font-size: 26px; line-height: 1.4; font-weight: 500; }
.intro { margin: 10px 0 28px; color: var(--color-text-secondary); font-size: 14px; line-height: 1.7; }
.loading { display: block; padding: 36px 0; }
.session-summary { display: flex; flex-direction: column; gap: 24px; }
.code-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 16px;
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  background: var(--gray-50);
  .code-label { color: var(--color-text-secondary); font-size: 12px; }
  strong { color: var(--color-text); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 28px; font-weight: 500; letter-spacing: 2px; }
}
dl {
  display: grid;
  gap: 16px;
  margin: 0;
  font-size: 14px;
  div { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; }
  dt { flex-shrink: 0; color: var(--color-text-secondary); }
  dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
}
.status { color: var(--main-color); }
.security-note { margin: 0; padding-top: 20px; border-top: 1px solid var(--gray-150); color: var(--color-text-secondary); font-size: 12px; line-height: 1.8; }
.authorize-button { width: 100%; height: 46px; border-radius: 999px; font-size: 15px; }
.authorization-error { margin-bottom: 20px; }
.retry-button { margin-top: 24px; }
@media (max-width: 560px) {
  .cli-auth-view { padding: 24px 16px; }
  .cli-auth-panel { padding: 28px 24px; }
  h1 { font-size: 24px; }
  .code-block strong { font-size: 26px; }
}
</style>
