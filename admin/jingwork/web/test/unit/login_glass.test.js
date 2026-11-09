import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createRenderer, h, ssrContextKey } from 'vue'
import { createServer } from 'vite'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
}

test('登录状态按用户选择保存在浏览器会话或持久存储，退出时同时清除', async (t) => {
  const originalLocal = globalThis.localStorage
  const originalSession = globalThis.sessionStorage
  globalThis.localStorage = memoryStorage()
  globalThis.sessionStorage = memoryStorage()
  const pinia = createPinia()
  setActivePinia(pinia)
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { authApi } = await server.ssrLoadModule('/src/apis/auth_api.js')
    const { useUserStore } = await server.ssrLoadModule('/src/stores/user.js')
    t.mock.method(authApi, 'login', async () => ({ access_token: 'test-session', user_id: 1, uid: 'member' }))
    const store = useUserStore()
    await store.login({}, { remember: false })
    assert.equal(localStorage.getItem('user_token'), null)
    assert.equal(sessionStorage.getItem('user_token'), 'test-session')
    assert.equal(store.isLoggedIn, true)
    await store.login({})
    assert.equal(localStorage.getItem('user_token'), 'test-session')
    assert.equal(sessionStorage.getItem('user_token'), null)
    sessionStorage.setItem('user_token', 'old-session')
    store.logout()
    assert.equal(localStorage.getItem('user_token'), null)
    assert.equal(sessionStorage.getItem('user_token'), null)
    assert.equal(store.isLoggedIn, false)
  } finally {
    disposePinia(pinia)
    await server.close()
    if (originalLocal === undefined) delete globalThis.localStorage
    else globalThis.localStorage = originalLocal
    if (originalSession === undefined) delete globalThis.sessionStorage
    else globalThis.sessionStorage = originalSession
  }
})

test('滑块未到终点时复位，拖动到终点或使用键盘完成后只通知一次', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  let app
  try {
    const { default: Slider } = await server.ssrLoadModule('/src/components/LoginSlideVerification.vue')
    const renderer = createRenderer({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {},
      parentNode: () => null, nextSibling: () => null
    })
    let verified = 0
    app = renderer.createApp({ ...Slider, render: () => h('div') }, { onVerified: () => verified++ })
    app.provide(ssrContextKey, { modules: new Set() })
    app.mount({})
    const state = app._instance.setupState
    state.track = { getBoundingClientRect: () => ({ width: 340 }) }
    const press = { button: 0, clientX: 20, pointerId: 1, currentTarget: { setPointerCapture() {} }, preventDefault() {} }
    state.start(press)
    state.finish({ clientX: 100 })
    assert.equal(state.progress, 0)
    assert.equal(verified, 0)
    state.start(press)
    state.finish({ clientX: 320 })
    assert.equal(state.progress, 100)
    assert.equal(verified, 1)
    state.handleKey({ key: 'End', preventDefault() {} })
    assert.equal(verified, 1)
  } finally {
    app?.unmount()
    await server.close()
  }
})
