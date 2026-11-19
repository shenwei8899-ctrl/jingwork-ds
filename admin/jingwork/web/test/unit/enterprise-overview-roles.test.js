import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'vue/compiler-sfc'
import { computed, ref } from 'vue'

const source = readFileSync(
  new URL('../../src/views/EnterpriseOverviewView.vue', import.meta.url),
  'utf8'
)

function setupOverview({
  isSuperAdmin = false,
  iamEnabled = true,
  directoryError = false,
  usageError = false
} = {}) {
  const { descriptor } = parse(source)
  const script = descriptor.scriptSetup.content.replace(/^import[\s\S]*?from[^\n]+\n/gm, '')
  const calls = []
  const state = runInNewContext(
    `${script}\n;({ load, error, company, data, members, knowledge, suites, go })`,
    {
      computed,
      ref,
      onMounted() {},
      useRouter: () => ({ push: (route) => calls.push(route) }),
      useUserStore: () => ({ isSuperAdmin }),
      iamApi: {
        config: async () => ({ enabled: iamEnabled }),
        tenant: async () => ({ tenant_name_abb: '测试企业' }),
        directory: async (resource, params) => {
          calls.push({ resource, ...params })
          if (directoryError) throw new Error('IAM unavailable')
          return { items: [{}], meta: { total: 1320 } }
        }
      },
      companyApi: { get: async () => ({ name: '本地企业' }) },
      conversationLogApi: {
        overview: async () => {
          if (usageError) throw new Error('Usage unavailable')
          return {
            total_users: 4,
            total_conversations: 93,
            total_messages: 500,
            synced_users: 3,
            active_users_30d: 2
          }
        }
      },
      dashboardApi: {
        getAllStats() {
          throw new Error('Web conversation statistics requested')
        },
        getKnowledgeStats: async () => {
          calls.push('knowledge')
          return { total_files: 7 }
        }
      },
      Users: {},
      ShieldCheck: {},
      Monitor: {},
      ArrowUpRight: {},
      RefreshCw: {},
      Bot: {},
      LibraryBig: {},
      Sparkles: {},
      ScrollText: {}
    }
  )
  return { state, calls }
}

test('tenant administrator sees archived usage and IAM directory total', async () => {
  const { state, calls } = setupOverview()
  await state.load()
  assert.equal(state.company.value.name, '测试企业')
  assert.equal(state.error.value, '')
  assert.equal(state.members.value.total, 1320)
  assert.equal(state.members.value.source, 'IAM 账号目录')
  assert.equal(state.data.value.total_conversations, 93)
  assert.equal(calls[0].resource, 'users')
  assert.equal(calls[0].size, 1)
  assert.equal(calls.includes('knowledge'), false)
})

test('platform administrator reads archived usage with knowledge resources', async () => {
  const { state, calls } = setupOverview({ isSuperAdmin: true })
  await state.load()
  assert.equal(state.data.value.total_conversations, 93)
  assert.equal(state.knowledge.value.total_files, 7)
  assert.equal(calls.includes('knowledge'), true)
})

test('IAM directory failure leaves member count unavailable and preserves usage', async () => {
  const { state } = setupOverview({ directoryError: true })
  await state.load()
  assert.equal(state.members.value, null)
  assert.match(state.error.value, /成员目录加载失败/)
  assert.equal(state.data.value.total_conversations, 93)
})

test('usage failure preserves the authoritative member count and company', async () => {
  const { state } = setupOverview({ usageError: true })
  await state.load()
  assert.equal(state.members.value.total, 1320)
  assert.equal(state.company.value.name, '测试企业')
  assert.equal(state.data.value, null)
  assert.match(state.error.value, /对话统计加载失败/)
})

test('local identity mode counts effective local accounts', async () => {
  const { state } = setupOverview({ iamEnabled: false })
  await state.load()
  assert.equal(state.company.value.name, '本地企业')
  assert.equal(state.members.value.total, 4)
  assert.equal(state.members.value.source, '本地有效账号')
})

test('usage management opens the conversation log supplying its statistics', async () => {
  const { state, calls } = setupOverview()
  await state.load()
  const suite = state.suites.value.find((item) => item.name === '安全与效能')
  assert.equal(suite.count, 93)
  state.go(suite.page)
  assert.equal(calls.at(-1).query.page, 'conversationLogs')
  assert.match(source, /go\('conversationLogs'\)">查看对话日志/)
})
