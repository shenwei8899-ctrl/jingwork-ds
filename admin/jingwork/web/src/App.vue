<script setup>
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { useAgentStore } from '@/stores/agent'
import { useUserStore } from '@/stores/user'
import { useThemeStore } from '@/stores/theme'
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { iamApi } from '@/apis/iam_api'

const agentStore = useAgentStore()
const userStore = useUserStore()
const themeStore = useThemeStore()

const router = useRouter()
const sessionError = ref('')
let checkingSession = false
let sessionTimer

async function checkSession() {
  if (checkingSession || document.hidden || userStore.token !== 'iam_cookie') return
  checkingSession = true
  try {
    await iamApi.session()
    sessionError.value = ''
  } catch (error) {
    if (error.status === 401) {
      userStore.logout()
      await router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } })
    } else {
      sessionError.value = error.status === 403
        ? '当前账号没有访问权限，请联系管理员。'
        : '企业身份服务暂不可用，请稍后重试。'
    }
  } finally {
    checkingSession = false
  }
}

onMounted(async () => {
  window.addEventListener('focus', checkSession)
  document.addEventListener('visibilitychange', checkSession)
  sessionTimer = window.setInterval(checkSession, 30000)
  if (userStore.isLoggedIn) {
    await agentStore.initialize()
  }
})
onUnmounted(() => {
  window.clearInterval(sessionTimer)
  window.removeEventListener('focus', checkSession)
  document.removeEventListener('visibilitychange', checkSession)
})
</script>
<template>
  <a-config-provider :theme="themeStore.currentTheme" :locale="zhCN">
    <a-alert v-if="sessionError" type="warning" :message="sessionError" show-icon />
    <router-view />
  </a-config-provider>
</template>
