import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia, disposePinia } from 'pinia'
import { createServer } from 'vite'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RouterView } from 'vue-router'

const detailPath = '/extensions/knowledgebase/kb_route_fixture'
const evaluationPath = `${detailPath}/evaluation/dataset_route_fixture`

test('知识库深链接和命名导航在企业布局中显示详情并保留登录与管理员要求', async (t) => {
  const previousLocalStorage = globalThis.localStorage
  const previousSessionStorage = globalThis.sessionStorage
  const values = new Map()
  globalThis.localStorage = globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const pinia = createPinia()
  setActivePinia(pinia)
  const server = await createServer({
    plugins: [{
      name: 'knowledge-memory-navigation',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/src/router/index.js')) {
          return code
            .replace('createRouter, createWebHistory', 'createRouter, createMemoryHistory')
            .replace('createWebHistory(import.meta.env.BASE_URL)', 'createMemoryHistory()')
        }
        if (id.includes('/src/') && id.endsWith('.vue') && !id.endsWith('/EnterpriseConsoleView.vue')) {
          const view = id.split('/').at(-1).replace('.vue', '')
          return `<template><div data-test-view="${view}"></div></template>`
        }
      }
    }],
    server: { middlewareMode: true, hmr: false },
    appType: 'custom'
  })
  try {
    const { useUserStore } = await server.ssrLoadModule('/src/stores/user.js')
    const user = useUserStore()
    const { default: router } = await server.ssrLoadModule('/src/router/index.js')
    const renderRoute = () => renderToString(
      createSSRApp({ render: () => h(RouterView) })
        .use(pinia)
        .use(router)
        .component('a-result', { render: () => null })
    )

    await t.test('详情和评估地址解析到已有页面并保留参数与查询', async () => {
      const detail = router.resolve(`${detailPath}?section=evaluation`)
      assert.equal(detail.name, 'ExtensionKnowledgeBaseDetail')
      assert.equal(detail.params.kbId, 'kb_route_fixture')
      assert.equal(detail.query.section, 'evaluation')
      assert.equal(detail.meta.requiresAuth, true)
      assert.equal(detail.meta.requiresAdmin, true)
      const evaluation = router.resolve({
        name: 'ExtensionEvaluationBenchmarkDetail',
        params: { kbId: 'kb_route_fixture', datasetId: 'dataset_route_fixture' },
        query: { view: 'results', run: 'run_route_fixture' }
      })
      assert.equal(evaluation.path, evaluationPath)
      assert.equal(evaluation.params.datasetId, 'dataset_route_fixture')
      assert.equal(evaluation.query.run, 'run_route_fixture')
      assert.equal(evaluation.meta.requiresAuth, true)
      assert.equal(evaluation.meta.requiresAdmin, true)
      assert.equal(router.resolve('/extensions/unknown-page').name, 'NotFound')
    })

    await t.test('未登录和普通成员访问两个详情地址时保留完整拒绝目标', async () => {
      for (const path of [`${detailPath}?section=evaluation`, `${evaluationPath}?view=results`]) {
        user.token = ''
        user.userId = null
        user.userRole = ''
        await router.push(path)
        assert.equal(router.currentRoute.value.path, '/login')
        assert.equal(router.currentRoute.value.query.redirect, path)
        assert.equal(values.get('redirect'), path)
        user.token = 'test-token'
        user.userId = 7
        user.userRole = 'user'
        await router.push(path)
        assert.equal(router.currentRoute.value.path, '/forbidden')
        assert.equal(router.currentRoute.value.query.redirect, path)
        assert.equal(router.currentRoute.value.query.role, 'admin')
      }
    })

    await t.test('管理员直达详情和评估时显示子页与知识导航且不叠加列表或概览', async () => {
      user.token = 'test-token'
      user.userId = 7
      user.userRole = 'admin'
      for (const [path, view] of [
        [detailPath, 'DataBaseInfoView'],
        [evaluationPath, 'EvaluationBenchmarkDetailView']
      ]) {
        await router.push(path)
        assert.equal(router.currentRoute.value.path, path)
        const html = await renderRoute()
        assert.ok(html.includes(`data-test-view="${view}"`), html)
        assert.match(html, /<button[^>]*class="selected"[^>]*aria-current="page"[^>]*>企业知识库\s*</)
        assert.ok(!html.includes('data-test-view="EnterpriseKnowledgeManageView"'))
        assert.ok(!html.includes('data-test-view="EnterpriseOverviewView"'))
      }
      await router.push({
        name: 'ExtensionKnowledgeBaseDetail',
        params: { kbId: 'kb_route_fixture' },
        query: { section: 'evaluation' }
      })
      assert.equal(router.currentRoute.value.path, detailPath)
      assert.equal(router.currentRoute.value.query.section, 'evaluation')
    })

    await t.test('详情返回的旧知识列表地址与企业导航地址均显示知识列表', async () => {
      user.token = 'test-token'
      user.userId = 7
      user.userRole = 'admin'
      for (const path of ['/extensions?tab=knowledge', '/enterprise?page=knowledge']) {
        await router.push(path)
        const html = await renderRoute()
        assert.ok(html.includes('data-test-view="EnterpriseKnowledgeManageView"'), html)
        assert.ok(!html.includes('data-test-view="DataBaseInfoView"'))
        assert.ok(!html.includes('data-test-view="EvaluationBenchmarkDetailView"'))
        assert.ok(!html.includes('data-test-view="EnterpriseOverviewView"'))
      }
      await router.push('/agent')
      const chat = await renderRoute()
      assert.ok(chat.includes('data-test-view="AgentView"'))
      await router.push('/extensions')
      const overview = await renderRoute()
      assert.ok(overview.includes('data-test-view="EnterpriseOverviewView"'))
    })
  } finally {
    disposePinia(pinia)
    await server.close()
    globalThis.localStorage = previousLocalStorage
    globalThis.sessionStorage = previousSessionStorage
  }
})
