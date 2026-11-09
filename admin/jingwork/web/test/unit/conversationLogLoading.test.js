import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

test('切换会话后旧消息不会泄露到新会话，请求失败结束加载', async () => {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    plugins: [
      {
        name: 'conversation-log-fixture',
        enforce: 'pre',
        load(id) {
          if (id.endsWith('/src/apis/conversation_log_api.js'))
            return 'export const conversationLogApi = globalThis.__conversationLogApi'
          if (id.endsWith('/src/stores/user.js'))
            return 'export const useUserStore = () => ({ isAdmin: true })'
        }
      }
    ]
  })
  try {
    let resolveOld
    const old = new Promise((resolve) => {
      resolveOld = resolve
    })
    globalThis.__conversationLogApi = {
      messages: (body) =>
        body.uid === 'alice'
          ? old
          : Promise.resolve({ items: [{ id: 'bob', content: 'Bob reply' }], total: 1 }),
      sessions: async () => ({ items: [], total: 0 })
    }
    const { default: View } = await server.ssrLoadModule(
      '/src/views/EnterpriseConversationLogView.vue'
    )
    let component
    await renderToString(
      createSSRApp({
        setup() {
          component = View.setup({}, { expose() {} })
          return () => h('div')
        }
      })
    )
    const pending = component.openSession({
      uid: 'alice',
      device_id: 'd',
      agent_id: 'a',
      thread_id: 't'
    })
    await component.openSession({ uid: 'bob', device_id: 'd', agent_id: 'b', thread_id: 't' })
    resolveOld({ items: [{ content: 'Alice private reply' }], total: 1 })
    await pending
    assert.deepEqual(component.messages.value, [{ id: 'bob', content: 'Bob reply' }])
    assert.equal(component.detailLoading.value, false)
    await component.load()
    assert.deepEqual(component.messages.value, [])
    assert.equal(component.selected.value, null)
    globalThis.__conversationLogApi.sessions = async () => {
      throw new Error('server unavailable')
    }
    await component.load()
    assert.equal(component.error.value, 'server unavailable')
    assert.equal(component.loading.value, false)
  } finally {
    await server.close()
    delete globalThis.__conversationLogApi
  }
})
