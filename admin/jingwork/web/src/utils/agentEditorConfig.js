const resourceSegments = {
  tools: 'builtinTools',
  knowledges: 'knowledge',
  mcps: 'mcp',
  skills: 'skills',
  subagents: 'subagents'
}

export function groupAgentConfigItems(items) {
  const groups = {
    model: [],
    tools: [],
    knowledge: [],
    skills: [],
    mcp: [],
    builtinTools: [],
    subagents: [],
    other: []
  }
  for (const [key, item] of Object.entries(items)) {
    const resource = resourceSegments[item?.kind]
    const segment = resource || (['llm', 'prompt'].includes(item?.kind) ? 'model' : 'other')
    groups[segment].push(key)
    if (resource) groups.tools.push(key)
  }
  return groups
}

export function createAgentConfigDraft(items, saved = {}) {
  // 配置来自 JSON 契约；序列化同时解除 Vue 响应式代理，避免 DataCloneError。
  const draft = JSON.parse(JSON.stringify(saved))
  for (const [key, item] of Object.entries(items)) {
    if (draft[key] === undefined || (draft[key] === null && !item.supports_all)) {
      if (item.default !== undefined) draft[key] = JSON.parse(JSON.stringify(item.default))
    }
    if (
      draft[key] !== undefined &&
      draft[key] !== null &&
      draft[key] !== '' &&
      ['number', 'int', 'float'].includes(item.type)
    ) {
      const numeric = Number(draft[key])
      if (!Number.isNaN(numeric)) draft[key] = item.type === 'int' ? Math.trunc(numeric) : numeric
    }
  }
  return draft
}
