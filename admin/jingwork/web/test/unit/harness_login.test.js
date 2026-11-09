import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from 'vue/compiler-sfc'
import { computed, ref } from 'vue'

const source = readFileSync(new URL('../../src/views/CLIAuthAuthorizeView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'harness-login' }).content
  .replace(/^import .* from .*$/gm, '')
  .replace('export default', 'return')

async function mountAuthorization(session, approvalError, userAgent = 'Electron JingworkDesktop/1') {
  let mounted
  const approvals = []
  const component = new Function('computed', 'onMounted', 'ref', 'useRoute', 'authApi', 'navigator', script)(
    computed,
    (callback) => { mounted = callback },
    ref,
    () => ({ query: { user_code: 'abcd-1234' } }),
    {
      getCLIAuthSession: async () => session,
      approveCLIAuthSession: async (code) => {
        approvals.push(code)
        if (approvalError) throw approvalError
      }
    },
    { userAgent }
  )
  const state = component.setup({}, { expose() {} })
  await mounted()
  return { state, approvals }
}

test('桌面登录自动完成待授权请求', async () => {
  const { state, approvals } = await mountAuthorization({ key_name: 'DeepSeek Harness', status: 'pending' })
  assert.deepEqual(approvals, ['ABCD-1234'])
  assert.equal(state.approved.value, true)
  assert.equal(state.errorMessage.value, '')
})

test('命令行登录保留手动确认', async () => {
  const { state, approvals } = await mountAuthorization({ key_name: 'Yuxi CLI', status: 'pending' })
  assert.deepEqual(approvals, [])
  assert.equal(state.approved.value, false)
})

test('失效桌面请求显示错误且不授权', async () => {
  const { state, approvals } = await mountAuthorization({ key_name: 'DeepSeek Harness', status: 'expired' })
  assert.deepEqual(approvals, [])
  assert.match(state.errorMessage.value, /已失效/)
  assert.equal(state.approved.value, false)
})

test('自动授权失败显示错误且不报告成功', async () => {
  const { state } = await mountAuthorization(
    { key_name: 'DeepSeek Harness', status: 'pending' }, new Error('请求失败')
  )
  assert.equal(state.errorMessage.value, '请求失败')
  assert.equal(state.approved.value, false)
})

test('已授权桌面请求无需重复授权', async () => {
  const { state, approvals } = await mountAuthorization({ key_name: 'DeepSeek Harness', status: 'approved' })
  assert.deepEqual(approvals, [])
  assert.equal(state.approved.value, true)
})

test('普通浏览器中的同名请求保留手动授权', async () => {
  const { state, approvals } = await mountAuthorization(
    { key_name: 'DeepSeek Harness', status: 'pending' }, undefined, 'Mozilla/5.0'
  )
  assert.deepEqual(approvals, [])
  assert.equal(state.approved.value, false)
})
