<script setup>
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { appPath } from '@/utils/appPath'
import { iamApi } from '@/apis/iam_api'
import { sanitizeRedirect } from '@/utils/oidcAutoStart'

const route = useRoute()
const loading = ref(true)
const error = ref('')
const loginUrl = ref('')
const passwordResetUrl = ref('')

function startLogin() {
  if (!loginUrl.value) return
  const url = new URL(loginUrl.value, window.location.origin)
  if (url.origin !== window.location.origin) {
    error.value = '企业登录入口配置异常，请联系管理员。'
    return
  }
  url.searchParams.set('redirect', sanitizeRedirect(route.query.redirect || '/enterprise'))
  window.location.replace(url.toString())
}

async function loadLogin() {
  loading.value = true
  error.value = ''
  try {
    const config = await iamApi.config()
    if (!config.enabled || !config.login_url) {
      error.value = '企业统一登录尚未配置，请联系管理员。'
      return
    }
    loginUrl.value = config.login_url
    passwordResetUrl.value = config.password_reset_url
    if (route.query.iam_error) {
      error.value = '企业登录未完成，请重新登录或联系管理员。'
      return
    }
    startLogin()
  } catch {
    error.value = '企业身份服务暂不可用，请稍后重试。'
  } finally {
    loading.value = false
  }
}

onMounted(loadLogin)
</script>

<template>
  <main class="login-view">
    <section class="login-panel" aria-labelledby="login-title">
      <img :src="appPath('/enterprise-logo.png')" alt="" class="brand-logo" />
      <h1 id="login-title">企业统一登录</h1>
      <a-spin v-if="loading" tip="正在连接企业身份平台…" />
      <template v-else>
        <a-alert v-if="error" type="error" :message="error" show-icon />
        <p v-else>请在企业身份平台完成登录。</p>
        <a-button type="primary" size="large" @click="loginUrl ? startLogin() : loadLogin()">
          {{ loginUrl ? '企业统一登录' : '重试连接' }}
        </a-button>
        <a v-if="passwordResetUrl" :href="passwordResetUrl">前往统一身份平台修改密码</a>
      </template>
    </section>
  </main>
</template>

<style scoped>
.login-view {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--gray-50);
}
.login-panel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
  width: min(420px, 100%);
  padding: 32px;
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  background: var(--color-bg-container);
  color: var(--color-text);
}
.brand-logo { width: 48px; height: 48px; }
h1 { margin: 0; font-size: 24px; }
p { margin: 0; color: var(--color-text-secondary); }
</style>
