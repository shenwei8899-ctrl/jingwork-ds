import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'vue/compiler-sfc'
import { computed, ref } from 'vue'
import dayjs from 'dayjs'

const source = readFileSync(
  new URL('../../src/views/EnterpriseStatisticsDetailView.vue', import.meta.url),
  'utf8'
)
function setup(handler) {
  const script = parse(source).descriptor.scriptSetup.content.replace(
    /^import[\s\S]*?from[^\n]+\n/gm,
    ''
  )
  const calls = []
  let blob
  const anchor = { click() {} }
  const state = runInNewContext(
    `${script}\n;({ load, showDaily, closeDaily, dailyRows, dailyMember, dailyError, dates, rows, exportData, columns, number })`,
    {
      computed,
      ref,
      dayjs,
      onMounted() {},
      onBeforeUnmount() {},
      useUserStore: () => ({ isSuperAdmin: true }),
      Download: {},
      RefreshCw: {},
      Blob,
      URL: {
        createObjectURL(value) {
          blob = value
          return 'blob:test'
        },
        revokeObjectURL() {}
      },
      document: { createElement: () => anchor },
      dashboardApi: {
        statisticsDetails: async (params) => {
          calls.push(params)
          if (handler) return handler(params)
          return {
            items:
              params.mode === 'daily'
                ? [{ date: '2026-11-01', questions: 2, sessions: 1, tokens: null }]
                : [
                    {
                      uid: 'one',
                      username: '=1+1',
                      total_questions: 8,
                      questions: 2,
                      total_tokens: null
                    }
                  ]
          }
        }
      }
    }
  )
  return { state, calls, csv: () => blob.text() }
}

test('member statistics keeps cumulative fields and unknown tokens', async () => {
  const { state } = setup()
  await state.load()
  assert.equal(state.rows.value[0].total_questions, 8)
  assert.equal(state.number(null), '未采集')
  assert.equal(state.number(0), '0')
  assert.ok(state.columns.value.some((column) => column.dataIndex === 'total_questions'))
  assert.ok(state.columns.value.some((column) => column.dataIndex === 'total_tokens'))
})

test('daily detail uses selected account and dates then closes', async () => {
  const { state, calls } = setup()
  state.dates.value = [dayjs('2026-11-01'), dayjs('2026-11-03')]
  await state.showDaily({ uid: 'one', username: '员工' })
  assert.equal(calls[0].mode, 'daily')
  assert.equal(calls[0].uid, 'one')
  assert.equal(calls[0].start, '2026-11-01')
  assert.equal(calls[0].end, '2026-11-03')
  assert.equal(state.dailyRows.value[0].questions, 2)
  state.closeDaily()
  assert.equal(state.dailyMember.value, null)
})

test('CSV exports cumulative metrics and protects formula-like names', async () => {
  const { state, csv } = setup()
  await state.load()
  state.exportData(false)
  const result = await csv()
  assert.match(result, /累计对话次数/)
  assert.match(result, /"'=1\+1"/)
  assert.match(result, /未采集/)
  assert.doesNotMatch(result.split('\r\n')[0], /明细/)
})

test('CSV protects formula prefixes following whitespace and control characters', async () => {
  const { state, csv } = setup()
  await state.load()
  for (const name of ['\t=1+1', '\r@SUM(1)', '\n+1+1', '  =1+1', '-1']) {
    state.rows.value[0].username = name
    state.exportData(false)
    assert.ok((await csv()).includes(`"'${name}"`), JSON.stringify(name))
  }
})

test('late daily data cannot replace a different member', async () => {
  let resolveFirst
  const first = new Promise((resolve) => {
    resolveFirst = resolve
  })
  const { state } = setup((params) =>
    params.uid === 'one' ? first : { items: [{ questions: 7 }] }
  )
  const pending = state.showDaily({ uid: 'one', username: '甲' })
  await state.showDaily({ uid: 'two', username: '乙' })
  resolveFirst({ items: [{ questions: 1 }] })
  await pending
  assert.equal(state.dailyMember.value.uid, 'two')
  assert.equal(state.dailyRows.value[0].questions, 7)
})

test('daily request failure keeps an explicit error and clears old results', async () => {
  const { state } = setup(async () => {
    throw new Error('每日用量读取失败')
  })
  await state.showDaily({ uid: 'one', username: '甲' })
  assert.equal(state.dailyRows.value.length, 0)
  assert.equal(state.dailyError.value, '每日用量读取失败')
})
