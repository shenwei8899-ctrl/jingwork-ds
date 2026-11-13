import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parse } from 'vue/compiler-sfc'
import { ref } from 'vue'

const source = readFileSync(new URL('../../src/views/LoginView.vue', import.meta.url), 'utf8')

async function mountLogin(config, query = {}) {
  const { descriptor } = parse(source)
  const script = descriptor.scriptSetup.content.replace(/^import .*\n/gm, '')
  let mounted
  const destinations = []
  const state = runInNewContext(`${script}\n;({ error, loading, startLogin })`, {
    ref, URL,
    useRoute: () => ({ query }),
    onMounted: callback => { mounted = callback },
    iamApi: { config: async () => {
      if (config instanceof Error) throw config
      return config
    } },
    sanitizeRedirect: value => typeof value === 'string' && /^\/(?![\\/])/.test(value) ? value : '/',
    window: { location: { origin: 'https://app.example', replace: url => destinations.push(url) } }
  })
  await mounted()
  return { state, destinations }
}

test('登录与旧注册入口只发起企业统一登录并保留应用内目标', async () => {
  assert.doesNotMatch(source, /<a-input|authApi|handleRegister|loginForm/)
  const { destinations } = await mountLogin({ enabled: true, login_url: 'https://app.example/work/api/auth/iam/login' },
    { redirect: '/auth/cli/authorize?user_code=ABCD-EFGH', local: '1' })
  assert.equal(destinations.length, 1)
  const url = new URL(destinations[0])
  assert.equal(url.pathname, '/work/api/auth/iam/login')
  assert.equal(url.searchParams.get('redirect'), '/auth/cli/authorize?user_code=ABCD-EFGH')
})

test('登录失败停留可重试页面并拒绝外部配置入口', async () => {
  for (const config of [{ enabled: false }, new Error('unavailable'),
    { enabled: true, login_url: 'https://foreign.example/login' }]) {
    const { state, destinations } = await mountLogin(config)
    assert.equal(destinations.length, 0)
    assert.ok(state.error.value)
    assert.equal(state.loading.value, false)
  }
  const { state, destinations } = await mountLogin({ enabled: true, login_url: 'https://app.example/work/api/auth/iam/login' },
    { iam_error: '1' })
  assert.equal(destinations.length, 0)
  assert.ok(state.error.value)
  state.startLogin()
  assert.equal(destinations.length, 1)
})
