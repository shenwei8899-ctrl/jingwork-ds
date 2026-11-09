<template>
  <div class="login-view" :class="{ 'has-alert': serverStatus === 'error' }">
    <div v-if="isDesktopLogin" class="desktop-window-drag" aria-hidden="true"></div>
    <!-- 服务状态提示 -->
    <div v-if="serverStatus === 'error'" class="server-status-alert">
      <div class="alert-content">
        <exclamation-circle-icon class="alert-icon" size="20" />
        <div class="alert-text">
          <div class="alert-title">服务端连接失败</div>
          <div class="alert-message">{{ serverError }}</div>
        </div>
        <a-button type="link" size="small" @click="checkServerHealth" :loading="healthChecking">
          重试
        </a-button>
      </div>
    </div>

    <!-- 主要内容区：居中卡片 -->
    <main class="login-main">
      <div class="login-card" :class="{ 'registration-card': isRegister && !isFirstRun }">
        <!-- 右侧表单 -->
        <div class="card-side is-form">
          <div class="form-wrapper">
            <header class="form-header">
              <div class="logo-glass"><img class="login-whale" src="/home/jing-work-icon.png" alt="" /></div>
              <div class="login-brand">竞网蓝鲸</div>
              <!-- 如果是在初始化，显示特定标题 -->
              <h2 v-if="isFirstRun" class="init-title">系统初始化，请创建超级管理员</h2>
              <template v-else-if="isRegister">
                <h1 class="welcome-text">注册</h1>
              </template>
              <template v-else>
                <h1 class="welcome-text">登录</h1>
                <p class="welcome-subtitle">使用账号名称或手机号和密码登录。</p>
              </template>
            </header>

            <div class="login-content" :class="{ 'is-initializing': isFirstRun }">
              <!-- 管理员初始化与普通成员注册 -->
              <div v-if="isFirstRun || isRegister" class="login-form login-form--init">
                <a-form :model="adminForm" @finish="isFirstRun ? handleInitialize() : handleRegister()" layout="vertical">
                  <a-form-item
                    :label="isFirstRun ? 'UID' : '账号'"
                    name="uid"
                    :rules="[
                      { required: true, message: '请输入账号 ID' },
                      {
                        pattern: /^[a-zA-Z0-9_]+$/,
                        message: '账号 ID 只能包含字母、数字和下划线'
                      },
                      {
                        min: 3,
                        max: 20,
                        message: '账号 ID 长度必须在 3–20 个字符之间'
                      }
                    ]"
                  >
                    <a-input
                      v-model:value="adminForm.uid"
                      autocomplete="username"
                      placeholder="3–20 位字母、数字或下划线"
                      :maxlength="20"
                    />
                  </a-form-item>

                  <a-form-item
                    v-if="isFirstRun"
                    label="手机号（可选）"
                    name="phone_number"
                    :rules="[
                      {
                        validator: async (rule, value) => {
                          if (!value || value.trim() === '') {
                            return // 空值允许
                          }
                          const phoneRegex = /^1[3-9]\d{9}$/
                          if (!phoneRegex.test(value)) {
                            throw new Error('请输入正确的手机号格式')
                          }
                        }
                      }
                    ]"
                  >
                    <a-input
                      v-model:value="adminForm.phone_number"
                      placeholder="可用于登录，可不填写"
                      :max-length="11"
                    />
                  </a-form-item>

                  <a-form-item
                    label="密码"
                    name="password"
                    :rules="[
                      { required: true, message: '请输入密码' },
                      {
                        min: MIN_PASSWORD_LENGTH,
                        message: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`
                      }
                    ]"
                  >
                    <a-input-password
                      v-model:value="adminForm.password"
                      autocomplete="new-password"
                      :placeholder="`至少 ${MIN_PASSWORD_LENGTH} 位`"
                      prefix-icon="lock"
                      :minlength="MIN_PASSWORD_LENGTH"
                      :maxlength="isRegister ? 64 : undefined"
                    />
                  </a-form-item>

                  <a-form-item
                    label="确认密码"
                    name="confirmPassword"
                    :validate-first="true"
                    :rules="[
                      { required: true, message: '请确认密码' },
                      { validator: validateConfirmPassword }
                    ]"
                  >
                    <a-input-password
                      v-model:value="adminForm.confirmPassword"
                      autocomplete="new-password"
                      placeholder="再次输入密码"
                      prefix-icon="lock"
                    />
                  </a-form-item>

                  <a-form-item v-if="showAgreementConsent" class="agreement-form-item">
                    <div class="agreement-row">
                      <a-checkbox v-model:checked="agreementAccepted">
                        {{ isRegister ? '同意' : '登录即代表同意' }}
                        <a
                          class="agreement-link"
                          :href="userAgreementUrl"
                          target="_blank"
                          rel="noopener noreferrer"
                          @click.stop
                          >《用户协议》</a
                        >
                        <a
                          class="agreement-link"
                          :href="privacyPolicyUrl"
                          target="_blank"
                          rel="noopener noreferrer"
                          @click.stop
                          >《隐私协议》</a
                        >
                      </a-checkbox>
                    </div>
                  </a-form-item>

                  <a-form-item>
                    <a-button type="primary" html-type="submit" :loading="loading" block
                      >{{ isFirstRun ? '创建管理员账户' : '注册' }}</a-button
                    >
                  </a-form-item>
                </a-form>
                <p v-if="isRegister" class="account-help">
                  已有账号？<router-link :to="{ path: '/login', query: loginQuery }">登录</router-link>
                </p>
              </div>

              <!-- 登录表单 -->
              <div v-else class="login-form">
                <a-form :model="loginForm" @finish="handleLogin" layout="vertical">
                  <a-form-item
                    label="登录账号"
                    name="loginId"
                    :rules="[{ required: true, message: '请输入UID或手机号' }]"
                  >
                    <a-input v-model:value="loginForm.loginId" placeholder="账号名称或手机号" autocomplete="username" aria-label="账号名称或手机号">
                      <template #prefix>
                        <user-icon size="18" />
                      </template>
                    </a-input>
                  </a-form-item>

                  <a-form-item
                    label="密码"
                    name="password"
                    :rules="[{ required: true, message: '请输入密码' }]"
                  >
                    <a-input-password v-model:value="loginForm.password" placeholder="密码" autocomplete="current-password" aria-label="密码">
                      <template #prefix>
                        <lock-icon size="18" />
                      </template>
                    </a-input-password>
                  </a-form-item>

                  <a-form-item class="slider-form-item">
                    <LoginSlideVerification :key="verificationRevision" @verified="slideVerified = true" />
                  </a-form-item>



                  <a-form-item>
                    <a-button
                      type="primary"
                      html-type="submit"
                      :loading="loading"
                      :disabled="isLocked || !loginForm.loginId.trim() || !loginForm.password || !slideVerified"
                      block
                      size="large"
                    >
                      <span v-if="isLocked">账户已锁定 {{ formatTime(lockRemainingTime) }}</span>
                      <span v-else>登录</span>
                    </a-button>
                  </a-form-item>
                </a-form>

                <div class="login-options">
                  <a-checkbox v-model:checked="rememberLogin">记住登录状态</a-checkbox>
                  <button type="button" class="forgot-password" @click="showPasswordHelp = true">忘记密码？</button>
                </div>
                <p class="account-help">
                  还没有账号？<router-link :to="{ path: '/register', query: loginQuery }">注册账号</router-link>
                </p>

                <!-- OIDC 登录选项  -->
                <div v-if="oidcChecking || oidcEnabled" class="third-party-login">
                  <div class="divider">
                    <span>或使用以下方式登录</span>
                  </div>
                  <div class="login-icons">
                    <!-- 检查中显示骨架屏 -->
                    <div v-if="oidcChecking" class="login-skeleton">
                      <a-skeleton-button block size="large" :active="true" />
                    </div>
                    <!-- 检查完成后显示按钮 -->
                    <a-button
                      v-else
                      type="default"
                      size="large"
                      block
                      :loading="oidcLoading"
                      @click="handleOIDCLogin"
                    >
                      <template #icon>
                        <key-icon size="18" />
                      </template>
                      {{ oidcButtonText }}
                    </a-button>
                  </div>
                </div>
              </div>

              <!-- 错误提示 -->
              <div v-if="errorMessage" class="error-message">
                {{ errorMessage }}
              </div>
            </div>
          </div>
        </div>
        <div v-if="!isRegister && !isFirstRun && showAgreementConsent" class="login-consent">
          <a-checkbox v-model:checked="agreementAccepted">
            登录即代表同意
            <a :href="userAgreementUrl" target="_blank" rel="noopener noreferrer" @click.stop>《用户协议》</a>
            <a :href="privacyPolicyUrl" target="_blank" rel="noopener noreferrer" @click.stop>《隐私协议》</a>
          </a-checkbox>
        </div>
      </div>
    </main>
    <a-modal v-model:open="showPasswordHelp" title="找回密码" :footer="null">
      <p>请联系管理员重置密码，然后使用新密码登录。</p>
      <a-button block @click="showPasswordHelp = false">返回登录</a-button>
    </a-modal>


  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useInfoStore } from '@/stores/info'
import { useAgentStore } from '@/stores/agent'
import { message } from 'ant-design-vue'
import { healthApi } from '@/apis/system_api'
import { authApi } from '@/apis/auth_api'
import {
  User as UserIcon,
  Lock as LockIcon,
  Key as KeyIcon,
  AlertCircle as ExclamationCircleIcon
} from '@lucide/vue'
import { tryAutoStartOIDC, sanitizeRedirect } from '@/utils/oidcAutoStart'
import { MIN_PASSWORD_LENGTH } from '@/utils/passwordValidation'
import LoginSlideVerification from '@/components/LoginSlideVerification.vue'

const isDesktopLogin = typeof navigator !== 'undefined' && navigator.userAgent.includes('JingworkDesktop/1')
const router = useRouter()
const route = useRoute()
const isRegister = computed(() => route.path === '/register')
const loginQuery = computed(() => route.query.redirect ? { redirect: route.query.redirect } : {})
const userStore = useUserStore()
const infoStore = useInfoStore()
const agentStore = useAgentStore()

// 品牌展示数据

const userAgreementUrl = computed(() => {
  return infoStore.footer?.user_agreement_url?.trim() || ''
})
const privacyPolicyUrl = computed(() => {
  return infoStore.footer?.privacy_policy_url?.trim() || ''
})
const showAgreementConsent = computed(() => {
  return Boolean(userAgreementUrl.value && privacyPolicyUrl.value)
})

// 状态
const isFirstRun = ref(false)
const loading = ref(false)
const errorMessage = ref('')
const agreementAccepted = ref(false)
const rememberLogin = ref(localStorage.getItem('jingwork_remember_login') !== 'false')
const showPasswordHelp = ref(false)
const slideVerified = ref(false)
const verificationRevision = ref(0)
const serverStatus = ref('loading')
const serverError = ref('')
const healthChecking = ref(false)

// OIDC 相关状态
const oidcEnabled = ref(false)
const oidcLoading = ref(false)
const oidcChecking = ref(true)
const oidcButtonText = ref('OIDC 登录')

// 登录锁定相关状态
const isLocked = ref(false)
const lockRemainingTime = ref(0)
const lockCountdown = ref(null)

// 登录表单
const loginForm = reactive({
  loginId: typeof route.query.uid === 'string' ? route.query.uid : '', // 支持uid或phone_number登录
  password: ''
})

// 管理员初始化表单
const adminForm = reactive({
  uid: '', // 改为直接输入uid
  password: '',
  confirmPassword: '',
  phone_number: '' // 手机号字段（可选）
})


watch(isRegister, () => {
  errorMessage.value = ''
  agreementAccepted.value = false
  adminForm.password = ''
  adminForm.confirmPassword = ''
  loginForm.password = ''
  slideVerified.value = false
  verificationRevision.value++
})

const handleRegister = async () => {
  if (!ensureAgreementAccepted()) return
  if (adminForm.password !== adminForm.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致'
    return
  }
  if (!/[a-zA-Z]/.test(adminForm.password) || !/[0-9]/.test(adminForm.password)) {
    errorMessage.value = '密码需包含字母和数字'
    return
  }
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await authApi.register({ uid: adminForm.uid.trim(), password: adminForm.password })
    loginForm.loginId = result.uid
    message.success('注册成功，请登录。模型访问由管理员授权。')
    await router.replace({ path: '/login', query: { ...loginQuery.value, uid: result.uid } })
  } catch (error) {
    errorMessage.value = error.message || '注册失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

// 清理倒计时器
const clearLockCountdown = () => {
  if (lockCountdown.value) {
    clearInterval(lockCountdown.value)
    lockCountdown.value = null
  }
}

// 启动锁定倒计时
const startLockCountdown = (remainingSeconds) => {
  clearLockCountdown()
  isLocked.value = true
  lockRemainingTime.value = remainingSeconds

  lockCountdown.value = setInterval(() => {
    lockRemainingTime.value--
    if (lockRemainingTime.value <= 0) {
      clearLockCountdown()
      isLocked.value = false
      errorMessage.value = ''
    }
  }, 1000)
}

// 格式化时间显示
const formatTime = (seconds) => {
  if (seconds < 60) {
    return `${seconds}秒`
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}分${remainingSeconds}秒`
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}小时${minutes}分钟`
  } else {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    return `${days}天${hours}小时`
  }
}

// 密码确认验证
const validateConfirmPassword = async (rule, value) => {
  if (value === '') {
    throw new Error('请确认密码')
  }
  if (value !== adminForm.password) {
    throw new Error('两次输入的密码不一致')
  }
}

const ensureAgreementAccepted = () => {
  if (!showAgreementConsent.value || agreementAccepted.value) {
    return true
  }

  const warningMessage = '请先阅读并同意《用户协议》《隐私协议》'
  message.warning(warningMessage)
  return false
}

// 处理登录
const handleLogin = async () => {
  if (!slideVerified.value) {
    message.warning('请先完成滑块验证')
    return
  }
  // 如果当前被锁定，不允许登录
  if (isLocked.value) {
    message.warning(`账户被锁定，请等待 ${formatTime(lockRemainingTime.value)}`)
    return
  }

  if (!ensureAgreementAccepted()) {
    return
  }

  try {
    loading.value = true
    errorMessage.value = ''
    clearLockCountdown()

    await userStore.login({
      loginId: loginForm.loginId,
      password: loginForm.password
    }, { remember: rememberLogin.value })
    localStorage.setItem('jingwork_remember_login', String(rememberLogin.value))

    message.success('登录成功')

    // 获取重定向路径
    const redirectPath = sanitizeRedirect(route.query.redirect || sessionStorage.getItem('redirect'))
    sessionStorage.removeItem('redirect') // 清除重定向信息

    // 根据用户角色决定重定向目标
    if (redirectPath === '/') {
      // 统一跳转到聊天页面（管理员与普通用户共享同一聊天界面）
      try {
        await agentStore.initialize()
        router.push('/agent')
      } catch (error) {
        console.error('获取智能体信息失败:', error)
        router.push('/agent')
      }
    } else {
      // 跳转到其他预设的路径
      router.push(redirectPath)
    }
  } catch (error) {
    slideVerified.value = false
    verificationRevision.value++
    console.error('登录失败:', error)

    // 检查是否是锁定错误（HTTP 423）
    if (error.status === 423) {
      // 尝试从响应头中获取剩余时间
      let remainingTime = 0
      if (error.headers && error.headers.get) {
        const lockRemainingHeader = error.headers.get('X-Lock-Remaining')
        if (lockRemainingHeader) {
          remainingTime = parseInt(lockRemainingHeader)
        }
      }

      // 如果没有从头中获取到，尝试从错误消息中解析
      if (remainingTime === 0) {
        const lockTimeMatch = error.message.match(/(\d+)\s*秒/)
        if (lockTimeMatch) {
          remainingTime = parseInt(lockTimeMatch[1])
        }
      }

      if (remainingTime > 0) {
        startLockCountdown(remainingTime)
        errorMessage.value = `由于多次登录失败，账户已被锁定 ${formatTime(remainingTime)}`
      } else {
        errorMessage.value = error.message || '账户被锁定，请稍后再试'
      }
    } else {
      errorMessage.value = error.message || '登录失败，请检查用户名和密码'
    }
  } finally {
    loading.value = false
  }
}

// 处理 OIDC 登录
const handleOIDCLogin = async () => {
  if (!ensureAgreementAccepted()) {
    return
  }

  try {
    oidcLoading.value = true
    errorMessage.value = ''

    // 获取 OIDC 登录 URL
    const response = await authApi.getOIDCLoginUrl()
    if (response.login_url) {
      // 保存当前路径，以便登录后返回
      const redirectPath =
        sessionStorage.getItem('redirect') || router.currentRoute.value.query.redirect || '/'
      sessionStorage.setItem('oidc_redirect', redirectPath)

      // 跳转到 OIDC Provider
      window.location.href = response.login_url
    } else {
      errorMessage.value = '获取 OIDC 登录地址失败'
    }
  } catch (error) {
    console.error('OIDC 登录失败:', error)
    errorMessage.value = error.message || 'OIDC 登录失败，请重试'
  } finally {
    oidcLoading.value = false
  }
}

// 检查 OIDC 配置
const checkOIDCConfig = async () => {
  oidcChecking.value = true
  try {
    const config = await authApi.getOIDCConfig()
    oidcEnabled.value = config.enabled
    if (config.provider_name) {
      oidcButtonText.value = config.provider_name
    }
    return config
  } catch (error) {
    console.error('检查 OIDC 配置失败:', error)
    oidcEnabled.value = false
    return null
  } finally {
    oidcChecking.value = false
  }
}

// 处理初始化管理员
const handleInitialize = async () => {
  if (!ensureAgreementAccepted()) {
    return
  }

  try {
    loading.value = true
    errorMessage.value = ''

    if (adminForm.password !== adminForm.confirmPassword) {
      errorMessage.value = '两次输入的密码不一致'
      return
    }

    await userStore.initialize({
      uid: adminForm.uid,
      password: adminForm.password,
      phone_number: adminForm.phone_number || null // 空字符串转为null
    })

    message.success('管理员账户创建成功')
    router.push('/')
  } catch (error) {
    console.error('初始化失败:', error)
    errorMessage.value = error.message || '初始化失败，请重试'
  } finally {
    loading.value = false
  }
}

// 检查是否是首次运行
const checkFirstRunStatus = async () => {
  try {
    loading.value = true
    const isFirst = await userStore.checkFirstRun()
    isFirstRun.value = isFirst
  } catch (error) {
    console.error('检查首次运行状态失败:', error)
    errorMessage.value = '系统出错，请稍后重试'
  } finally {
    loading.value = false
  }
}

// 检查服务器健康状态
const checkServerHealth = async () => {
  try {
    healthChecking.value = true
    const response = await healthApi.checkHealth()
    if (response.status === 'ok') {
      serverStatus.value = 'ok'
    } else {
      serverStatus.value = 'error'
      serverError.value = response.message || '服务端状态异常'
    }
  } catch (error) {
    console.error('检查服务器健康状态失败:', error)
    serverStatus.value = 'error'
    serverError.value = '无法连接到服务，请检查网络连接或稍后重试。'
  } finally {
    healthChecking.value = false
  }
}

// 组件挂载时
onMounted(async () => {
  // 如果已登录，按 redirect 参数跳转（不固定跳首页）
  if (userStore.isLoggedIn) {
    router.push(sanitizeRedirect(route.query.redirect))
    return
  }

  // 显示 OIDC 认证失败的错误信息（由后端重定向携带）
  if (route.query.oidc_error) {
    errorMessage.value = String(route.query.oidc_error)
  }

  // 首先检查服务器健康状态
  await checkServerHealth()

  // 检查是否是首次运行
  await checkFirstRunStatus()

  // 如果处于首次运行状态，不需要 OIDC 自动登录
  if (isFirstRun.value) {
    return
  }

  // 检查 OIDC 配置完成后，尝试自动触发 OIDC 登录（跨系统跳转场景）
  const config = await checkOIDCConfig()
  if (!isRegister.value && config && config.enabled) {
    const autoStarted = await tryAutoStartOIDC(async () => await authApi.getOIDCLoginUrl(), config)
    // 如果已发起 OIDC 跳转，页面会被重定向，不需要继续
    if (autoStarted) return
  }
})

// 组件卸载时清理定时器
onUnmounted(() => {
  clearLockCountdown()
})
</script>

<style lang="less" scoped>
.login-view {
  --glass-text: #182c48;
  --glass-muted: #66758d;
  --glass-line: rgba(255, 255, 255, .88);
  --glass-fill: rgba(255, 255, 255, .56);
  --field-fill: rgba(255, 255, 255, .8);
  min-height: 100dvh;
  box-sizing: border-box;
  position: relative;
  isolation: isolate;
  overflow-x: clip;
  color: var(--glass-text);
  background: radial-gradient(ellipse at 22% 24%, #c5dfff 0, transparent 48%),
    radial-gradient(ellipse at 83% 72%, #c9d7fa 0, transparent 42%),
    radial-gradient(ellipse at 72% 14%, #e4dafa 0, transparent 38%), #edf3fb;
  &::before, &::after {
    content: '';
    position: fixed;
    z-index: -1;
    width: 560px;
    height: 560px;
    border-radius: 50%;
    pointer-events: none;
    background: linear-gradient(140deg, rgba(255, 255, 255, .7), rgba(170, 207, 255, .2));
    box-shadow: inset 0 1px 2px rgba(255, 255, 255, .9);
    filter: blur(2px);
  }
  &::before { left: calc(50% - 650px); top: calc(50% - 460px); }
  &::after {
    width: 380px;
    height: 380px;
    left: calc(50% + 150px);
    top: calc(50% + 60px);
    background: linear-gradient(145deg, rgba(236, 224, 255, .6), rgba(158, 199, 246, .3));
    filter: blur(3px);
  }
}
.desktop-window-drag {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  height: 44px;
  z-index: 10;
  -webkit-app-region: drag;
  app-region: drag;
}
.login-main {
  min-height: 100dvh;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
}
.login-card {
  box-sizing: border-box;
  position: relative;
  width: 420px;
  max-width: 100%;
  padding: 38px 36px 32px;
  background: linear-gradient(145deg, rgba(255, 255, 255, .3), transparent 65%), var(--glass-fill);
  border: 1px solid var(--glass-line);
  border-radius: 32px;
  backdrop-filter: blur(32px) saturate(150%);
  box-shadow: 0 24px 70px rgba(64, 90, 135, .14), inset 0 1px 0 rgba(255, 255, 255, .9);
}
.registration-card { padding: 24px 32px; }
.registration-card .form-header {
  display: grid;
  grid-template-columns: 48px 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  text-align: left;
}
.registration-card .logo-glass { width: 48px; height: 48px; border-radius: 16px; margin: 0; }
.registration-card .login-whale { width: 36px; height: 36px; }
.registration-card .login-brand { font-size: 22px; margin: 0; }
.registration-card .welcome-text { grid-column: 1 / -1; margin: 0; text-align: center; }
.registration-card .login-form :deep(.ant-form-item) { margin-bottom: 12px; }
.registration-card :deep(.ant-form-item-label) { padding-bottom: 4px; }
.registration-card :deep(.ant-form-item-label > label) { height: 22px; font-size: 13px; color: var(--glass-muted); }
.registration-card .login-form :deep(.ant-btn-primary) { height: 44px; }
.form-header { text-align: center; margin-bottom: 24px; }
.logo-glass {
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(255, 255, 255, .8), rgba(255, 255, 255, .2));
  border: 1px solid var(--glass-line);
  border-radius: 23px;
  box-shadow: 0 8px 24px rgba(67, 125, 200, .1), inset 0 1px 0 #fff;
}
.login-whale { width: 45px; height: 45px; object-fit: contain; }
.login-brand { font-size: 27px; font-weight: 600; letter-spacing: -.8px; margin-bottom: 18px; }
.welcome-text, .init-title { font-size: 18px; font-weight: 500; color: var(--glass-text); margin: 0 0 6px; }
.welcome-subtitle { color: var(--glass-muted); font-size: 13px; line-height: 1.7; margin: 0; }
.login-form :deep(.ant-form-item) { margin-bottom: 18px; }
.login-form:not(.login-form--init) :deep(.ant-form-item-label) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.login-form :deep(.ant-input-affix-wrapper), .login-form--init :deep(.ant-form-item-control-input-content > .ant-input) {
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid rgba(127, 153, 185, .24);
  background: var(--field-fill);
  color: var(--glass-text);
}
.login-form :deep(.ant-input-affix-wrapper .ant-input) { background: transparent; font-size: 14px; color: var(--glass-text); }
.login-form :deep(.ant-input::placeholder) { color: #8694a9; }
.login-form :deep(.ant-input-prefix) { color: #bcc8d7; margin-right: 8px; }
.login-form :deep(.ant-input-affix-wrapper-focused) { border-color: #428ce9; box-shadow: 0 0 0 3px rgba(60, 137, 234, .12); }
.login-form :deep(.ant-btn-primary) {
  height: 50px;
  border-radius: 26px;
  font-size: 15px;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(180deg, #449af6, #2476df);
  border: 1px solid rgba(35, 113, 214, .5);
}
.login-form :deep(.ant-btn-primary:disabled) {
  color: #8b9cb4;
  background: linear-gradient(180deg, rgba(236, 243, 252, .8), rgba(221, 232, 247, .6));
  border-color: rgba(133, 161, 200, .2);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .6);
}
.login-options { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 4px 0 26px; }
.login-options :deep(.ant-checkbox-wrapper) { color: var(--glass-muted); font-size: 13px; }
.login-options :deep(.ant-checkbox-checked .ant-checkbox-inner) { background: #ed5c79; border-color: #ed5c79; border-radius: 5px; }
.forgot-password { border: 0; background: transparent; padding: 0; color: var(--glass-muted); cursor: pointer; font: inherit; font-size: 13px; }
.account-help { text-align: center; font-size: 13px; color: var(--glass-muted); margin: 0; }
.account-help a, .agreement-link { color: #2877db; margin-left: 6px; }
.login-consent {
  position: absolute;
  top: calc(100% + 14px);
  left: 0;
  width: 100%;
  text-align: center;
}
.login-consent :deep(.ant-checkbox-wrapper) { color: var(--glass-muted); font-size: 11px; }
.login-consent a { color: #2877db; }
.agreement-row { font-size: 11px; line-height: 1.6; }
.agreement-row :deep(.ant-checkbox-wrapper) { color: var(--glass-muted); font-size: 11px; }
.error-message { margin-top: 16px; color: var(--error-color, #c33a4b); font-size: 13px; overflow-wrap: anywhere; }
.third-party-login { margin-top: 22px; }
.third-party-login .divider { display: flex; align-items: center; gap: 10px; color: var(--glass-muted); font-size: 12px; margin-bottom: 14px; }
.third-party-login .divider::before, .third-party-login .divider::after { content: ''; flex: 1; height: 1px; background: rgba(127, 153, 185, .2); }
.server-status-alert { position: relative; padding: 12px 24px; background: var(--gray-0); }
.alert-content { display: flex; align-items: center; justify-content: center; gap: 12px; }
.alert-message { font-size: 12px; }
@media (max-width: 480px) {
  .login-main { padding: 24px 16px; }
  .login-card { padding: 28px 24px; border-radius: 26px; }
  .login-consent { position: static; }
}
@media (pointer: coarse) {
  .login-form :deep(input) { font-size: 16px; }
}
:global(html.dark .login-view), :global([data-theme='dark'] .login-view) {
  --glass-text: #eaf2ff;
  --glass-muted: #a3b5ce;
  --glass-line: rgba(192, 213, 248, .2);
  --glass-fill: rgba(28, 45, 70, .6);
  --field-fill: rgba(18, 33, 55, .45);
  --login-slide-bg: rgba(18, 33, 55, .4);
  --login-slide-thumb-bg: #314969;
  background: radial-gradient(ellipse at 20% 22%, #233f65 0, transparent 48%), radial-gradient(ellipse at 82% 75%, #2c355a 0, transparent 45%), #101d30;
}
:global(html.dark .login-view::before), :global(html.dark .login-view::after),
:global([data-theme='dark'] .login-view::before), :global([data-theme='dark'] .login-view::after) { opacity: .13; }
</style>
