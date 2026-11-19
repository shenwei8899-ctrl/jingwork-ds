import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { parse } from 'vue/compiler-sfc'
import { computed, reactive, ref } from 'vue'

const source = readFileSync(
  new URL('../../src/views/EnterpriseConversationLogView.vue', import.meta.url),
  'utf8'
)
function setup(api, environment = {}) {
  const script = parse(source).descriptor.scriptSetup.content.replace(
    /^import[\s\S]*?from[^\n]+\n/gm,
    ''
  )
  return runInNewContext(
    `${script}\n;({openSession,load,loadFiles,files,filesError,messages,selected,fileSize,downloadFile})`,
    {
      computed,
      reactive,
      ref,
      onMounted() {},
      onBeforeUnmount() {},
      useUserStore: () => ({ isAdmin: true }),
      conversationLogApi: api,
      departmentApi: {},
      clearInterval() {},
      ...environment
    }
  )
}
const session = {
  uid: 'member',
  device_id: 'device',
  agent_id: 'expert',
  thread_id: 'one',
  message_count: 1
}

test('late files from a previously selected conversation cannot replace the current files', async () => {
  let finish
  const first = new Promise((resolve) => {
    finish = resolve
  })
  const state = setup({
    messages: async () => ({ items: [{ content: 'hello' }], total: 1 }),
    files: async (fields) => (fields.thread_id === 'one' ? first : { items: [{ id: 'two-file' }] })
  })
  const opening = state.openSession(session)
  await state.openSession({ ...session, thread_id: 'two' })
  finish({ items: [{ id: 'one-file' }] })
  await opening
  assert.equal(state.files.value[0].id, 'two-file')
  assert.equal(state.selected.value.thread_id, 'two')
})

test('periodic refresh discovers new files without requiring another message', async () => {
  let items = []
  let reads = 0
  const state = setup({
    messages: async () => {
      reads++
      return { items: [{ content: 'hello' }], total: 1 }
    },
    files: async () => ({ items }),
    sessions: async () => ({ items: [session], total: 1 })
  })
  await state.openSession(session)
  items = [{ id: 'late-upload', filename: '报告.pdf' }]
  await state.load(1, true)
  assert.equal(reads, 1)
  assert.equal(state.files.value[0].filename, '报告.pdf')
})

test('file failures retain readable messages and expose a retryable error', async () => {
  let fails = true
  const state = setup({
    messages: async () => ({ items: [{ content: 'hello' }], total: 1 }),
    files: async () => {
      if (fails) throw new Error('文件读取失败')
      return { items: [{ id: 'ready' }] }
    }
  })
  await state.openSession(session)
  assert.equal(state.messages.value[0].content, 'hello')
  assert.equal(state.filesError.value, '文件读取失败')
  fails = false
  await state.loadFiles(session)
  assert.equal(state.filesError.value, '')
  assert.equal(state.files.value[0].id, 'ready')
  assert.equal(state.fileSize(0), '0 B')
  assert.equal(state.fileSize(1024), '1.0 KB')
  assert.equal(state.fileSize(1024 ** 2), '1.0 MB')
})

test('download converts the authenticated response to file bytes before saving', async () => {
  const apiSource = readFileSync(
    new URL('../../src/apis/conversation_log_api.js', import.meta.url),
    'utf8'
  )
    .replace(/^import[^\n]+\n/gm, '')
    .replace('export const', 'const')
  const response = new Response(new TextEncoder().encode('generated file'))
  const api = runInNewContext(apiSource + '\n;conversationLogApi', { apiGet: async () => response })
  const blob = await api.downloadFile('file-one')
  assert.ok(blob instanceof Blob)
  assert.equal(await blob.text(), 'generated file')
  let clicked = false
  let revoked = false
  const link = {
    click() {
      clicked = true
    }
  }
  const state = setup(
    { downloadFile: async () => blob },
    {
      URL: {
        createObjectURL(value) {
          assert.ok(value instanceof Blob)
          return 'blob:test'
        },
        revokeObjectURL(url) {
          assert.equal(url, 'blob:test')
          revoked = true
        }
      },
      document: {
        createElement() {
          return link
        }
      }
    }
  )
  state.selected.value = session
  await state.downloadFile({ id: 'file-one', filename: '报告.txt' })
  assert.equal(clicked, true)
  assert.equal(revoked, true)
  assert.equal(link.download, '报告.txt')
  assert.equal(state.filesError.value, '')
})
