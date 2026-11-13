import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { parse } from 'vue/compiler-sfc'
import { computed, nextTick, ref, watch } from 'vue'

const source = readFileSync(new URL('../../src/views/IAMDirectoryView.vue', import.meta.url), 'utf8')

function setupDirectory() {
  const { descriptor } = parse(source)
  const script = descriptor.scriptSetup.content.replace(/^import .* from .*$/gm, '')
  const requests = []
  let dispose
  const state = runInNewContext(`${script}\n;({ resource, rows, error, load, loading })`, {
    ref, computed, watch, AbortController,
    onBeforeUnmount(callback) { dispose = callback },
    iamApi: {
      directory(resource, options) {
        return new Promise((resolve, reject) => requests.push({ resource, options, resolve, reject }))
      }
    }
  })
  return { state, requests, dispose: () => dispose() }
}

test('switching directory ignores a superseded response and aborts it', async () => {
  const view = setupDirectory()
  try {
    view.state.resource.value = 'orgs'
    await nextTick()
    assert.equal(view.requests[0].options.signal.aborted, true)
    assert.equal(view.requests[1].resource, 'orgs')
    view.requests[0].resolve({ items: [{ user_name: 'old' }], meta: { total: 1 } })
    await setImmediate()
    assert.equal(view.state.rows.value.length, 0)
    view.requests[1].resolve({ items: [{ org_id: 12, org_name: '测试组织' }], meta: { total: 1 } })
    await setImmediate()
    assert.equal(view.state.rows.value[0].org_id, 12)
  } finally {
    view.dispose()
  }
})

test('directory failures expose retry feedback and unmount aborts a pending retry', async () => {
  const view = setupDirectory()
  try {
    view.requests[0].reject(new Error('private-upstream-detail'))
    await setImmediate()
    assert.equal(view.state.error.value, '企业目录加载失败，请重试。')
    view.state.load()
    assert.equal(view.state.error.value, '')
    view.dispose()
    assert.equal(view.requests[1].options.signal.aborted, true)
  } finally {
    view.dispose()
  }
})
