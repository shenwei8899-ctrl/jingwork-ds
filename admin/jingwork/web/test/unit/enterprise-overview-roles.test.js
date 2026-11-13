import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'vue/compiler-sfc'
import { computed, ref } from 'vue'

const source = readFileSync(new URL('../../src/views/EnterpriseOverviewView.vue', import.meta.url), 'utf8')

function setupOverview(isSuperAdmin) {
  const { descriptor } = parse(source)
  const script = descriptor.scriptSetup.content.replace(/^import[\s\S]*?from[^\n]+\n/gm, '')
  let statisticsCalls = 0
  const state = runInNewContext(`${script}\n;({ load, error, company, data })`, {
    computed, ref, onMounted() {}, useRouter: () => ({ push() {} }),
    useUserStore: () => ({ token: 'iam_cookie', isSuperAdmin }),
    iamApi: { tenant: async () => ({ tenant_name_abb: '测试企业' }) },
    companyApi: { get() { throw new Error('Expected IAM tenant profile') } },
    dashboardApi: { getAllStats: async () => { statisticsCalls++; return { basic: { total_users: 4 } } } },
    Users: {}, ShieldCheck: {}, Monitor: {}, ArrowUpRight: {}, RefreshCw: {},
    Bot: {}, LibraryBig: {}, Sparkles: {}, ScrollText: {}
  })
  return { state, statisticsCalls: () => statisticsCalls }
}

test('tenant administrator overview reads IAM profile without requesting global statistics', async () => {
  const view = setupOverview(false)
  await view.state.load()
  assert.equal(view.state.company.value.name, '测试企业')
  assert.equal(view.state.error.value, '')
  assert.equal(view.state.data.value, null)
  assert.equal(view.statisticsCalls(), 0)
})

test('platform administrator overview keeps the global statistics entry point', async () => {
  const view = setupOverview(true)
  await view.state.load()
  assert.equal(view.state.data.value.basic.total_users, 4)
  assert.equal(view.statisticsCalls(), 1)
})
