import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf8')
const start = source.indexOf('router.beforeEach(') + 'router.beforeEach('.length
const end = source.indexOf('\n})\n\nexport default router', start) + 2
const callback = source.slice(start, end)

test('恢复身份遇到权限不足和身份服务故障时保留会话，明确失效时才清理', async () => {
  for (const [status, expectedPath, clears] of [[403, '/forbidden', false], [503, '/login', false], [401, '/login', true]]) {
    let cleared = false
    const store = {
      token: 'iam_cookie', userId: null,
      get isLoggedIn() { return !cleared },
      getCurrentUser: async () => { throw Object.assign(new Error('rejected'), { status }) },
      logout: () => { cleared = true }
    }
    const guard = runInNewContext(`(${callback})`, {
      useUserStore: () => store,
      sessionStorage: { setItem() {} },
      console: { error() {} },
      sanitizeRedirect: value => value || '/'
    })
    const result = await guard({ name: 'EnterpriseConsole', path: '/enterprise', fullPath: '/enterprise',
      matched: [{ meta: { requiresAuth: true } }], query: {} })
    assert.equal(result.path, expectedPath)
    assert.equal(cleared, clears)
    if (status === 403) assert.equal(result.query.iam_denied, '1')
  }
})
