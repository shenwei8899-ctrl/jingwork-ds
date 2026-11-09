import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computed, ref, proxyRefs } from 'vue'
import { groupAgentConfigItems } from '../../src/utils/agentEditorConfig.js'
import { compileScript, parse } from 'vue/compiler-sfc'
import * as configUtils from '../../src/utils/agentConfigUtils.js'

const source = readFileSync(
  new URL('../../src/components/AgentRuntimeConfigForm.vue', import.meta.url),
  'utf8'
)
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'resource-visibility-test' }).content
const executable = compiled
  .replace(/^import(?:\s*\{[\s\S]*?\}|\s+[A-Za-z]\w*)\s+from\s+'[^']+'\n/gm, '')
  .replace('export default', 'return')
  .replace(
    /const __returned__ = \{[\s\S]*?\}\nObject\.defineProperty/,
    'const __returned__ = { filteredConfigurableItems, isCurrentSegmentEmpty }\nObject.defineProperty'
  )

/** 使用真实组件 setup 验证筛选结果，保留响应式资源与配置。 */
function createForm(selection, localEditor = false) {
  const item = { name: '知识库', kind: 'knowledges', type: 'list', supports_all: true, options: [] }
  const state = {
    selectedAgent: ref({ id: 'test-agent', can_manage: true }),
    selectedAgentId: ref('test-agent'),
    agentConfig: ref({ knowledges: selection }),
    configurableItems: ref({ knowledges: item })
  }
  const deps = {
    ...configUtils,
    ref,
    computed,
    useAgentStore: () => (localEditor ? {} : proxyRefs(state)),
    groupAgentConfigItems,
    useRouter: () => ({}),
    getOptionValue: configUtils.getAgentConfigOptionValue
  }
  const component = new Function(...Object.keys(deps), executable)(...Object.values(deps))
  const editor = localEditor
    ? {
        agent: state.selectedAgent.value,
        config: state.agentConfig.value,
        items: state.configurableItems.value
      }
    : null
  const form = component.setup(
    { segment: localEditor ? 'knowledge' : 'tools', showSegmented: false, editor },
    { expose() {} }
  )
  return { state, form }
}

for (const selection of ['all', []]) {
  test(`空资源分组隐藏且保留配置 ${JSON.stringify(selection)}，候选项新增后显示`, () => {
    const { state, form } = createForm(selection)
    assert.deepEqual(form.filteredConfigurableItems.value, {})
    assert.equal(form.isCurrentSegmentEmpty.value, true)
    assert.deepEqual(state.agentConfig.value.knowledges, selection)
    state.configurableItems.value.knowledges.options.push({ value: 'kb-a', label: '知识库 A' })
    assert.ok(form.filteredConfigurableItems.value.knowledges)
    assert.equal(form.isCurrentSegmentEmpty.value, false)
    assert.deepEqual(state.agentConfig.value.knowledges, selection)
  })
}

test('没有候选项时仍保留历史固定选择的提示与清空入口', () => {
  const { state, form } = createForm(['hidden-kb'])
  assert.ok(form.filteredConfigurableItems.value.knowledges)
  assert.deepEqual(state.agentConfig.value.knowledges, ['hidden-kb'])
})

test('整页 editor 在资源为空时保留配置入口，不读取聊天 store', () => {
  const { state, form } = createForm(['hidden-kb'], true)
  assert.ok(form.filteredConfigurableItems.value.knowledges)
  state.agentConfig.value.knowledges = []
  assert.ok(form.filteredConfigurableItems.value.knowledges)
  state.configurableItems.value.knowledges.options.push({ value: 'new-kb', label: '新知识库' })
  assert.ok(form.filteredConfigurableItems.value.knowledges)
})
