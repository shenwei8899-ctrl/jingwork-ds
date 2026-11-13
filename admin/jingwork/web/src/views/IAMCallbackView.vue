<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { sanitizeRedirect } from '@/utils/oidcAutoStart'

const error = ref('')
const route = useRoute()
const router = useRouter()
onMounted(async () => {
  try {
    await useUserStore().completeIAMLogin()
    await router.replace(sanitizeRedirect(route.query.redirect))
  } catch {
    error.value = '企业登录未完成，请重新登录。'
  }
})
</script>

<template>
  <a-result v-if="error" status="error" title="企业登录失败" :sub-title="error">
    <template #extra><a-button @click="router.replace('/login')">重新登录</a-button></template>
  </a-result>
  <a-spin v-else tip="正在验证企业身份…" />
</template>
