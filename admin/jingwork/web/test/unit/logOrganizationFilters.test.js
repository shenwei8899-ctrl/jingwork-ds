import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

for (const [view, api, method] of [
  ['EnterpriseAuditLogView', 'operation_log_api', 'list'],
  ['EnterpriseConversationLogView', 'conversation_log_api', 'sessions']
]) {
  test(`${view} 组合筛选、分页和重置`, async () => {
    const calls = []
    globalThis.__logFilterApi = {
      [method]: async (params) => {
        calls.push(params)
        return { items: [], total: 0, next_cursor: 42 }
      }
    }
    const server = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'custom',
      plugins: [
        {
          name: 'log-filter-fixture',
          enforce: 'pre',
          load(id) {
            if (id.endsWith(`/src/apis/${api}.js`))
              return `export const ${api === 'operation_log_api' ? 'operationLogApi' : 'conversationLogApi'} = globalThis.__logFilterApi`
            if (id.endsWith('/src/stores/user.js'))
              return 'export const useUserStore = () => ({ isAdmin: true })'
          }
        }
      ]
    })
    try {
      const { default: View } = await server.ssrLoadModule(`/src/views/${view}.vue`)
      let component
      await renderToString(
        createSSRApp({
          setup() {
            component = View.setup({}, { expose() {} })
            return () => h('div')
          }
        })
      )
      Object.assign(component.filters, { department_id: 7, role: 'admin' })
      component.search()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(calls.at(-1).department_id, 7)
      assert.equal(calls.at(-1).role, 'admin')
      component.filters.department_id = 8
      await component.load(method === 'list' ? true : 2)
      assert.equal(calls.at(-1).department_id, 7)
      assert.equal(calls.at(-1).role, 'admin')
      assert.equal(
        calls.at(-1)[method === 'list' ? 'before_id' : 'offset'],
        method === 'list' ? 42 : 30
      )
      component.reset()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(calls.at(-1).department_id, undefined)
      assert.equal(calls.at(-1).role, undefined)
      assert.equal(component.filters.department_id, undefined)
      assert.equal(component.filters.role, undefined)
    } finally {
      await server.close()
      delete globalThis.__logFilterApi
    }
  })
}
