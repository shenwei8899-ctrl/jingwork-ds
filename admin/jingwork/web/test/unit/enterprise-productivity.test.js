import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'vue/compiler-sfc'
import { computed, ref } from 'vue'
import { enterpriseProductivityTrendOption } from '../../src/utils/enterpriseProductivityChart.js'

const panel = readFileSync(
  new URL('../../src/components/dashboard/EnterpriseProductivityPanel.vue', import.meta.url),
  'utf8'
)
function setup(handler) {
  const script = parse(panel).descriptor.scriptSetup.content.replace(
    /^import[\s\S]*?from[^\n]+\n/gm,
    ''
  )
  let dispose
  const state = runInNewContext(
    `${script}\n;({ load, data, error, loading, cumulative, periodMetrics, count, tokens })`,
    {
      computed,
      ref,
      nextTick: async () => {},
      watch() {},
      onMounted() {},
      onBeforeUnmount(callback) {
        dispose = callback
      },
      useRouter: () => ({ push() {} }),
      useThemeStore: () => ({ isDark: false }),
      dashboardApi: { getEnterpriseProductivity: handler }
    }
  )
  return { state, dispose: () => dispose() }
}

const payload = {
  summary: {
    sessions: 94,
    questions: 264,
    messages: 1348,
    members: 136,
    active_users_30d: 23,
    tokens: 82454
  },
  period: { sessions: 90, questions: 260, active_users: 20, tokens: 82454 },
  daily: []
}

test('enterprise cards use synchronized conversations, IAM members and recorded usage', async () => {
  const { state } = setup(async () => payload)
  await state.load()
  assert.equal(state.cumulative.value[0][1], '94')
  assert.equal(state.cumulative.value[3][1], '136')
  assert.equal(state.cumulative.value[5][1], '82,454')
  assert.equal(state.periodMetrics.value[0][1], '90')
  assert.equal(state.tokens(null), '未采集')
  assert.equal(state.tokens(0), '0')
})

test('refresh failure keeps the previous dated data and exposes an error', async () => {
  let fails = false
  const { state } = setup(async () => {
    if (fails) throw new Error('查询失败')
    return payload
  })
  await state.load()
  fails = true
  await state.load()
  assert.equal(state.data.value.summary.members, 136)
  assert.equal(state.error.value, '查询失败')
  assert.equal(state.loading.value, false)
})

test('unmounted enterprise panel ignores late requests', async () => {
  let resolve
  const pending = new Promise((done) => {
    resolve = done
  })
  const view = setup(() => pending)
  const request = view.state.load()
  view.dispose()
  resolve(payload)
  await request
  assert.equal(view.state.data.value, null)
})

test('trend keeps unknown token intervals as gaps and known zero usage as zero', () => {
  const rows = [
    { date: '2026-11-16', tokens: null, questions: 0 },
    { date: '2026-11-17', tokens: 0, questions: 3 }
  ]
  const colors = { main: '#337788', text: '#555555', border: '#eeeeee' }
  const token = enterpriseProductivityTrendOption(rows, 'tokens', colors)
  assert.deepEqual(token.series[0].data, [null, 0])
  assert.equal(token.series[0].connectNulls, false)
  assert.deepEqual(
    enterpriseProductivityTrendOption(rows, 'questions', colors).series[0].data,
    [0, 3]
  )
  assert.deepEqual(token.xAxis.data, ['2026-11-16', '2026-11-17'])
  const sparse = enterpriseProductivityTrendOption(
    Array.from({ length: 30 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      tokens: index === 29 ? 82454 : null
    })),
    'tokens',
    colors
  )
  assert.equal(sparse.series[0].showSymbol, true)
  assert.equal(sparse.series[0].showAllSymbol, true)
  assert.equal(sparse.series[0].symbolSize, 6)
})

test('enterprise route defaults to enterprise statistics and keeps Web views available', () => {
  const source = readFileSync(new URL('../../src/views/DashboardView.vue', import.meta.url), 'utf8')
  const script = parse(source).descriptor.scriptSetup.content.replace(
    /^import[\s\S]*?from[^\n]+\n/gm,
    ''
  )
  function dashboard(query) {
    return runInNewContext(`${script}\n;({ activeTab, dashboardTabs })`, {
      computed,
      ref,
      inject: () => ({}),
      onMounted() {},
      onUnmounted() {},
      watch() {},
      nextTick() {},
      useRoute: () => ({ query }),
      useRouter: () => ({}),
      useTaskerStore: () => ({}),
      useThemeStore: () => ({}),
      useUserStore: () => ({}),
      storeToRefs: () => ({ activeCount: ref(0) })
    })
  }
  const enterprise = dashboard({ page: 'productivity' })
  assert.equal(enterprise.activeTab.value, 'enterprise')
  assert.equal(enterprise.dashboardTabs[1].label, 'Web 运行概览')
  assert.equal(dashboard({}).activeTab.value, 'overview')
  assert.equal(dashboard({ page: 'productivity', tab: 'threads' }).activeTab.value, 'threads')
})

test('Web token chart preserves small counts and exact tooltip values', () => {
  const source = readFileSync(
    new URL('../../src/components/dashboard/CallStatsComponent.vue', import.meta.url),
    'utf8'
  )
  const script = parse(source).descriptor.scriptSetup.content.replace(
    /^import[\s\S]*?from[^\n]+\n/gm,
    ''
  )
  const state = runInNewContext(`${script}\n;({ formatTokenValue, formatValueForDisplay })`, {
    ref,
    computed,
    onMounted() {},
    onUnmounted() {},
    watch() {},
    nextTick() {},
    defineProps: () => ({ loading: false }),
    defineExpose() {},
    useThemeStore: () => ({ isDark: false })
  })
  assert.equal(state.formatTokenValue(12), '12')
  assert.equal(state.formatValueForDisplay(82454), '82,454')
  assert.equal(state.formatTokenValue(null), '—')
})
