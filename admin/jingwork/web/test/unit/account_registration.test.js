import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createRenderer, h, ssrContextKey, nextTick } from 'vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createServer } from 'vite'
import { message } from 'ant-design-vue'

test('注册拒绝不一致密码，成功后回到登录并保留账号和目标，错误留在注册页', async (t) => {
  globalThis.localStorage = globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const pinia = createPinia()
  setActivePinia(pinia)
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  let app
  try {
    const { authApi } = await server.ssrLoadModule('/src/apis/auth_api.js')
    const { healthApi } = await server.ssrLoadModule('/src/apis/system_api.js')
    const { useUserStore } = await server.ssrLoadModule('/src/stores/user.js')
    t.mock.method(useUserStore(), 'checkFirstRun', async () => false)
    t.mock.method(healthApi, 'checkHealth', async () => ({ status: 'ok' }))
    t.mock.method(authApi, 'getOIDCConfig', async () => ({ enabled: false }))
    t.mock.method(message, 'success', () => {})
    const register = t.mock.method(authApi, 'register', async ({ uid }) => ({ uid }))
    const { default: Login } = await server.ssrLoadModule('/src/views/LoginView.vue')
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/register', component: {} }, { path: '/login', component: {} }
    ] })
    await router.push('/register?redirect=/agent')
    const renderer = createRenderer({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
      parentNode: () => null, nextSibling: () => null
    })
    app = renderer.createApp({ ...Login, render: () => h('div') })
    app.provide(ssrContextKey, { modules: new Set() })
    app.use(pinia)
    app.use(router)
    app.mount({})
    const state = app._instance.setupState
    state.adminForm.uid = 'new_member'
    state.adminForm.password = 'Testpass123'
    state.adminForm.confirmPassword = 'different'
    await state.handleRegister()
    assert.equal(register.mock.callCount(), 0)
    assert.equal(state.errorMessage, '两次输入的密码不一致')
    state.adminForm.confirmPassword = 'Testpass123'
    await state.handleRegister()
    assert.equal(router.currentRoute.value.path, '/login')
    assert.equal(router.currentRoute.value.query.uid, 'new_member')
    assert.equal(router.currentRoute.value.query.redirect, '/agent')
    assert.equal(state.loginForm.loginId, 'new_member')
    await nextTick()
    assert.equal(state.adminForm.password, '')
    await router.push('/register')
    await nextTick()
    state.adminForm.password = state.adminForm.confirmPassword = 'Testpass123'
    t.mock.method(authApi, 'register', async () => { throw new Error('该账号 ID 已被使用') })
    await state.handleRegister()
    assert.equal(router.currentRoute.value.path, '/register')
    assert.equal(state.errorMessage, '该账号 ID 已被使用')
    assert.equal(state.loading, false)
  } finally {
    app?.unmount()
    disposePinia(pinia)
    await server.close()
    delete globalThis.localStorage
    delete globalThis.sessionStorage
  }
})
