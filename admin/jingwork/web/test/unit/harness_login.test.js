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
  const component = new Function('computed', 'onMounted', 'ref', 'useRoute', 'authApi', 'navigator', 'appPath', script)(
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
    { userAgent },
    value => value
  )
  const state = component.setup({}, { expose() {} })
  await mounted()
  return { state, approvals }
}

test('桌面登录需用户确认后授权', async () => {
  const { state, approvals } = await mountAuthorization({ key_name: 'DeepSeek Harness', status: 'pending' })
  assert.deepEqual(approvals, [])
  assert.equal(state.approved.value, false)
  await state.approveSession()
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

test('用户确认授权失败显示错误且不报告成功', async () => {
  const { state } = await mountAuthorization(
    { key_name: 'DeepSeek Harness', status: 'pending' }, new Error('请求失败')
  )
  await state.approveSession()
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


test('旧设备名称与新设备名称均显示 JingWork，并使用可读状态和时间', async () => {
  for (const key_name of ['DeepSeek Harness', 'JingWork']) {
    const { state } = await mountAuthorization({ key_name, status: 'pending', expires_at: '2026-11-11T12:47:12.345826Z' })
    assert.equal(state.applicationName.value, 'JingWork')
    assert.equal(state.statusLabel.value, '等待确认')
    assert.equal(state.canApprove.value, true)
    assert.match(state.expiryLabel.value, /2026.*11.*11/)
    assert.doesNotMatch(state.expiryLabel.value, /T|Z|345826/)
  }
  const { state } = await mountAuthorization({ key_name: 'Yuxi CLI', status: 'pending' })
  assert.equal(state.applicationName.value, 'Yuxi CLI')
  assert.equal(state.expiryLabel.value, '—')
})

test('已消费的设备授权显示成功且无法再次授权', async () => {
  const { state, approvals } = await mountAuthorization({ key_name: 'JingWork', status: 'consumed' })
  assert.equal(state.approved.value, true)
  assert.equal(state.canApprove.value, false)
  assert.equal(state.errorMessage.value, '')
  assert.deepEqual(approvals, [])
})
