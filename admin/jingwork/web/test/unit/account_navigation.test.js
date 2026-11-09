import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { createServer } from 'vite'

test('网页导航保留登录目标、公开注册、显示权限拒绝并让管理员进入不同页面', async () => {
  const values = new Map()
  globalThis.localStorage = globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const pinia = createPinia()
  setActivePinia(pinia)
  const server = await createServer({
    plugins: [{
      name: 'test-memory-navigation',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('/src/router/index.js')) return
        return code
          .replace('createRouter, createWebHistory', 'createRouter, createMemoryHistory')
          .replace('createWebHistory(import.meta.env.BASE_URL)', 'createMemoryHistory()')
          .replace(/\(\) => import\([^\n]+\)/g, '() => Promise.resolve({ render: () => null })')
      }
    }],
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  })
  try {
    const { useUserStore } = await server.ssrLoadModule('/src/stores/user.js')
    const user = useUserStore()
    const { default: router } = await server.ssrLoadModule('/src/router/index.js')
    await router.push('/enterprise?page=models')
    assert.equal(router.currentRoute.value.path, '/login')
    assert.equal(router.currentRoute.value.query.redirect, '/enterprise?page=models')
    await router.push('/register')
    assert.equal(router.currentRoute.value.name, 'register')
    user.token = 'test-token'
    user.userId = 7
    user.userRole = 'user'
    await router.push('/enterprise?page=models')
    assert.equal(router.currentRoute.value.path, '/forbidden')
    assert.equal(router.currentRoute.value.query.role, 'admin')
    assert.equal(router.currentRoute.value.query.redirect, '/enterprise?page=models')
    user.userRole = 'admin'
    await router.push('/enterprise?page=models')
    assert.equal(router.currentRoute.value.query.page, 'models')
    await router.push('/enterprise?page=organization')
    assert.equal(router.currentRoute.value.query.page, 'organization')
    await router.push('/dashboard')
    assert.equal(router.currentRoute.value.path, '/forbidden')
    assert.equal(router.currentRoute.value.query.role, 'superadmin')
  } finally {
    disposePinia(pinia)
    await server.close()
    delete globalThis.localStorage
    delete globalThis.sessionStorage
  }
})
