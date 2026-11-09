import {
  Blocks,
  Bot,
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  Gauge,
  LayoutGrid,
  Network,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound
} from '@lucide/vue'

export const enterpriseNavigation = [
  { key: 'overview', label: '组织概览', icon: LayoutGrid },
  {
    key: 'intelligence',
    label: '企业智能体',
    icon: Bot,
    beta: true,
    children: [
      { key: 'quickstart', label: '快速开始' },
      { key: 'agents', label: 'Agents' },
      { key: 'automation', label: '自动化任务' }
    ]
  },
  {
    key: 'resources',
    label: 'AI 资源管理',
    icon: Blocks,
    children: [
      { key: 'models', label: '模型管理' },
      { key: 'tools', label: '工具管理' },
      { key: 'knowledge', label: '企业知识库' },
      { key: 'skills', label: 'Skill 管理' },
      { key: 'mcp', label: 'MCP' },
      { key: 'experts', label: '专家管理' }
    ]
  },
  {
    key: 'clients',
    label: '客户端配置',
    icon: SlidersHorizontal,
    children: [
      { key: 'customization', label: '客户端定制' },
      { key: 'channels', label: '助理渠道设置' },
      { key: 'collaboration', label: '分享与协作' },
      { key: 'devices', label: '客户端节点' }
    ]
  },
  {
    key: 'security',
    label: '安全中心',
    icon: ShieldCheck,
    children: [
      { key: 'securityManagement', label: '综合管理' },
      { key: 'clientSecurity', label: '客户端安全' }
    ]
  },
  {
    key: 'usage',
    label: '订阅与用量',
    icon: Gauge,
    children: [
      { key: 'subscriptions', label: '订阅管理' },
      { key: 'quotas', label: '额度管理' },
      { key: 'memberUsage', label: '成员用量' },
      { key: 'orgUsage', label: '组织用量' },
      { key: 'appUsage', label: '应用用量' },
      { key: 'usageDetails', label: '用量明细' }
    ]
  },
  {
    key: 'statistics',
    label: '数据统计',
    icon: ChartNoAxesCombined,
    children: [
      { key: 'productivity', label: '研效看板' },
      { key: 'statisticsDetails', label: '明细数据' }
    ]
  },
  {
    key: 'integrations',
    label: '开放与集成',
    icon: Network,
    children: [
      { key: 'developerPlatform', label: '开放平台' },
      { key: 'apis', label: 'API 管理' }
    ]
  },
  {
    key: 'logs',
    label: '日志管理',
    icon: ClipboardList,
    children: [
      { key: 'auditLogs', label: '操作日志' },
      { key: 'conversationLogs', label: '对话日志' },
      { key: 'systemLogs', label: '系统日志' }
    ]
  },
  {
    key: 'organizationGroup',
    label: '组织与成员',
    icon: UsersRound,
    children: [
      { key: 'organization', label: '组织架构' },
      { key: 'dataSources', label: '数据源管理' },
      { key: 'identitySources', label: '认证源管理' },
      { key: 'visibility', label: '可见范围设置' }
    ]
  },
  {
    key: 'settings',
    label: '企业设置',
    icon: Building2,
    children: [
      { key: 'company', label: '企业信息' },
      { key: 'proxy', label: '系统代理设置' },
      { key: 'network', label: '网络设置' },
      { key: 'metering', label: '计量设置' }
    ]
  },
  {
    key: 'applications',
    label: '开放平台',
    icon: Settings,
    children: [
      { key: 'thirdPartyApps', label: '第三方应用' },
      { key: 'internalApps', label: '自建应用' }
    ]
  }
]
