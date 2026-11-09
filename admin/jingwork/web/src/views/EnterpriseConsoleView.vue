<script setup>
import EnterpriseSystemLogView from '@/views/EnterpriseSystemLogView.vue'
import EnterpriseToolManageView from '@/views/EnterpriseToolManageView.vue'
import { computed, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCirclePlus
} from '@lucide/vue'
import EnterpriseStatisticsDetailView from '@/views/EnterpriseStatisticsDetailView.vue'
import EnterpriseComingSoonView from '@/views/EnterpriseComingSoonView.vue'
import EnterpriseOverviewView from '@/views/EnterpriseOverviewView.vue'
import EnterpriseCompanyView from '@/views/EnterpriseCompanyView.vue'
import EnterpriseNetworkView from '@/views/EnterpriseNetworkView.vue'
import DashboardView from '@/views/DashboardView.vue'
import EnterpriseExpertManageView from '@/views/EnterpriseExpertManageView.vue'
import EnterpriseOrganizationView from '@/views/EnterpriseOrganizationView.vue'
import EnterpriseAgentManageView from '@/views/EnterpriseAgentManageView.vue'
import EnterpriseConversationLogView from '@/views/EnterpriseConversationLogView.vue'
import EnterpriseAuditLogView from '@/views/EnterpriseAuditLogView.vue'
import EnterpriseSkillManageView from '@/views/EnterpriseSkillManageView.vue'
import EnterpriseKnowledgeManageView from '@/views/EnterpriseKnowledgeManageView.vue'
import EnterpriseMcpManageView from '@/views/EnterpriseMcpManageView.vue'
import EnterpriseModelManageView from '@/views/EnterpriseModelManageView.vue'
import EnterpriseModelCreditsView from '@/views/EnterpriseModelCreditsView.vue'
import ScheduledAgentsView from '@/views/ScheduledAgentsView.vue'
import AgentQuickstartEditor from '@/components/model-management/AgentQuickstartEditor.vue'
import UserInfoComponent from '@/components/UserInfoComponent.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import { enterpriseNavigation } from '@/layouts/enterpriseNavigation'

import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const route = useRoute()
const router = useRouter()
const isKnowledgeDetailPage = computed(() =>
  ['ExtensionKnowledgeBaseDetail', 'ExtensionEvaluationBenchmarkDetail'].includes(route.name)
)
const requestedPage = computed(() =>
  isKnowledgeDetailPage.value || (route.path === '/extensions' && route.query.tab === 'knowledge')
    ? 'knowledge'
    : route.query.page
)
const collapsed = ref(false)
const showSettingsModal = ref(false)
const settingsInitialTab = ref('account')
provide('settingsModal', {
  openSettingsModal(tab) {
    settingsInitialTab.value = tab || (userStore.isAdmin ? 'base' : 'account')
    showSettingsModal.value = true
  }
})
const expanded = ref(
  new Set([
    'intelligence',
    ...enterpriseNavigation
      .filter((item) => item.children?.some((child) => child.key === requestedPage.value))
      .map((item) => item.key)
  ])
)
const pages = enterpriseNavigation.flatMap((item) => item.children ?? [item])
const availablePages = new Set([
  'overview', 'network', 'company', 'statisticsDetails', 'productivity', 'experts',
  'organization', 'agents', 'automation', 'models', 'tools', 'subscriptions', 'quotas',
  'memberUsage', 'orgUsage', 'appUsage', 'usageDetails', 'mcp', 'knowledge',
  'systemLogs', 'conversationLogs', 'auditLogs', 'skills', 'quickstart'
])
const sortedNavigation = computed(() => {
  const items = enterpriseNavigation.map((item) => ({
    ...item,
    ...(item.children ? {
      children: [...item.children].sort((a, b) =>
        Number(availablePages.has(b.key)) - Number(availablePages.has(a.key))
      )
    } : {})
  }))
  const hasAvailablePage = (item) => item.children
    ? item.children.some((child) => availablePages.has(child.key))
    : availablePages.has(item.key)
  return items.sort((a, b) => Number(hasAvailablePage(b)) - Number(hasAvailablePage(a)))
})
const isChatPage = computed(() => route.path === '/agent' || route.path.startsWith('/agent/'))
const selected = computed(() =>
  isChatPage.value
    ? 'chat'
    : pages.some((item) => item.key === requestedPage.value)
      ? requestedPage.value
      : 'overview'
)
const pendingPage = computed(() => pages.find((item) => item.key === selected.value && !availablePages.has(item.key)))
function toggle(key) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
function select(key) {
  router.push(key === 'overview' ? '/extensions' : { path: '/enterprise', query: { page: key } })
}
</script>

<template>
  <div class="enterprise-console" :class="{ collapsed }">
    <header class="enterprise-header">
      <router-link to="/extensions" class="enterprise-brand" title="竞网蓝鲸首页">
        <img src="/enterprise-logo.png" alt="竞网蓝鲸" />
        <span v-if="!collapsed"><strong>竞网蓝鲸</strong><small>JING WORK</small></span>
      </router-link>
      <span class="enterprise-title">企业 Agent 平台</span>
    </header>
    <aside class="enterprise-sidebar">
      <nav aria-label="企业管理导航">
        <router-link
          to="/agent"
          class="enterprise-menu-item"
          :class="{ selected: isChatPage }"
          title="新建对话"
        >
          <MessageCirclePlus :size="18" />
          <span v-if="!collapsed" class="menu-label">新建对话</span>
        </router-link>
        <div v-for="item in userStore.isAdmin ? sortedNavigation : []" :key="item.key">
          <button
            class="enterprise-menu-item"
            :class="{ selected: selected === item.key }"
            :title="item.label"
            :aria-expanded="item.children ? expanded.has(item.key) : undefined"
            :aria-current="selected === item.key ? 'page' : undefined"
            @click="item.children ? toggle(item.key) : select(item.key)"
          >
            <component :is="item.icon" :size="18" />
            <span v-if="!collapsed" class="menu-label">{{ item.label }}</span>
            <span v-if="!item.children && !availablePages.has(item.key) && !collapsed" class="coming-soon-tag">建设中</span>
            <span v-if="item.beta && !collapsed" class="beta">Beta</span>
            <ChevronDown
              v-if="item.children && !collapsed"
              class="menu-chevron"
              :class="{ expanded: expanded.has(item.key) }"
              :size="18"
            />
          </button>
          <div
            v-if="item.children && expanded.has(item.key) && !collapsed"
            class="enterprise-submenu"
          >
            <button
              v-for="child in item.children"
              :key="child.key"
              :class="{ selected: selected === child.key }"
              :aria-current="selected === child.key ? 'page' : undefined"
              @click="select(child.key)"
            >
              {{ child.label }}
              <span v-if="!availablePages.has(child.key)" class="coming-soon-tag">建设中</span>
            </button>
          </div>
        </div>
        <div v-if="!userStore.isAdmin && !collapsed" class="member-model-help">
          <strong>模型使用</strong>
          <p>普通成员使用企业授权的模型。添加供应商、API Key 或启用模型，请联系管理员。</p>
        </div>
      </nav>
      <footer class="enterprise-sidebar-footer">
        <UserInfoComponent class="enterprise-account" :show-role="!collapsed" />
        <button :aria-label="collapsed ? '展开导航' : '收起导航'" @click="collapsed = !collapsed">
          <PanelLeftOpen v-if="collapsed" :size="18" /><PanelLeftClose v-else :size="18" />
        </button>
      </footer>
    </aside>
    <main
      class="enterprise-content"
      :class="{ 'enterprise-chat-content': isChatPage }"
      aria-label="管理内容"
    >
      <router-view v-if="isChatPage" />
      <router-view v-else-if="isKnowledgeDetailPage" :key="route.path" />
      <EnterpriseComingSoonView v-if="pendingPage" :title="pendingPage.label" />
      <EnterpriseOverviewView v-if="selected === 'overview'" />
      <EnterpriseNetworkView v-if="selected === 'network'" />
      <EnterpriseCompanyView v-if="selected === 'company'" />
      <EnterpriseStatisticsDetailView v-if="selected === 'statisticsDetails'" />
      <template v-if="selected === 'productivity'">
        <DashboardView v-if="userStore.isSuperAdmin" />
        <a-result v-else status="403" title="仅超级管理员可查看数据看板" />
      </template>
      <EnterpriseExpertManageView v-if="selected === 'experts'" />
      <EnterpriseOrganizationView v-if="selected === 'organization'" />
      <EnterpriseAgentManageView v-if="selected === 'agents'" />
      <ScheduledAgentsView v-if="selected === 'automation'" />
      <EnterpriseModelManageView v-if="selected === 'models'" />
      <EnterpriseToolManageView v-if="selected === 'tools'" />
      <EnterpriseModelCreditsView
        v-if="
          [
            'subscriptions',
            'quotas',
            'memberUsage',
            'orgUsage',
            'appUsage',
            'usageDetails'
          ].includes(selected)
        "
        :page="selected"
        :key="selected"
      />
      <EnterpriseMcpManageView v-if="selected === 'mcp'" />
      <EnterpriseKnowledgeManageView v-if="selected === 'knowledge' && !isKnowledgeDetailPage" />
      <EnterpriseConversationLogView v-if="selected === 'conversationLogs'" />
      <EnterpriseAuditLogView v-else-if="selected === 'auditLogs'" />
      <EnterpriseSystemLogView v-else-if="selected === 'systemLogs'" />
      <EnterpriseSkillManageView v-if="selected === 'skills'" />
      <AgentQuickstartEditor v-if="selected === 'quickstart'" :key="route.query.agent || 'new'" />
    </main>
    <SettingsModal
      v-model:visible="showSettingsModal"
      :initial-tab="settingsInitialTab"
      @close="showSettingsModal = false"
    />
  </div>
</template>

<style scoped>
.member-model-help {
  margin: 16px 12px;
  padding-top: 16px;
  border-top: 1px solid var(--gray-150);
  font-size: 13px;
  color: var(--color-text-secondary);
}
.member-model-help p { margin-top: 8px; line-height: 1.7; }

.enterprise-console {
  --sidebar-width: 240px;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
  grid-template-rows: 56px minmax(0, 1fr);
  height: 100dvh;
  color: var(--color-text);
  background: var(--gray-10);
}
.enterprise-console.collapsed {
  --sidebar-width: 72px;
}
.enterprise-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--gray-150);
  background: var(--gray-0);
  padding: 0 24px;
}
.enterprise-brand {
  display: flex;
  align-items: center;
  gap: 16px;
  color: inherit;
  text-decoration: none;
}
.enterprise-brand img {
  width: 44px;
  height: 44px;
  object-fit: contain;
}
.enterprise-brand strong {
  font-size: 14px;
  letter-spacing: 2px;
}
.enterprise-brand small {
  display: block;
  font-size: 9px;
  letter-spacing: 2px;
  margin-top: 3px;
}
.enterprise-title {
  padding-left: 24px;
  border-left: 1px solid var(--gray-150);
  font-size: 14px;
  font-weight: 600;
}
.enterprise-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--gray-0);
  border-right: 1px solid var(--gray-150);
}
.enterprise-sidebar nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 10px;
}
.enterprise-sidebar button {
  font: inherit;
  cursor: pointer;
  color: inherit;
  background: transparent;
  border: 0;
}
.enterprise-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
  width: 100%;
  padding: 7px 12px;
  text-align: left;
  border-radius: 6px;
}
.enterprise-menu-item:where(a) {
  color: inherit;
  text-decoration: none;
}
.enterprise-menu-item:where(a):hover,
.enterprise-menu-item:where(a).selected {
  background: var(--gray-100);
}
.enterprise-content.enterprise-chat-content {
  padding: 0;
  overflow: hidden;
}
.enterprise-chat-content :deep(.agent-view) {
  height: 100%;
}
.coming-soon-tag {
  display: inline-block;
  margin-left: 8px;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 400;
  color: var(--color-text-secondary);
  background: var(--gray-50);
  vertical-align: middle;
}
.menu-label {
  white-space: nowrap;
  font-size: 14px;
}
.beta {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--gray-50);
  color: var(--color-text-secondary);
}
.menu-chevron {
  margin-left: auto;
}
.menu-chevron.expanded {
  transform: rotate(180deg);
}
.enterprise-submenu button {
  display: block;
  width: 100%;
  min-height: 34px;
  padding: 7px 12px 7px 38px;
  text-align: left;
  border-radius: 6px;
  font-size: 14px;
}
.enterprise-sidebar button:hover,
.enterprise-sidebar button.selected {
  background: var(--gray-100);
}
.enterprise-sidebar button:focus-visible {
  outline: 2px solid var(--main-color);
  outline-offset: -2px;
}
.enterprise-sidebar-footer {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 16px;
  border-top: 1px solid var(--gray-150);
}
.enterprise-account {
  flex: 1;
  min-width: 0;
  padding: 8px;
  border-radius: 8px;
  cursor: pointer;
}
.enterprise-account:hover {
  background: var(--gray-100);
}
.enterprise-sidebar-footer button {
  display: flex;
  padding: 6px;
  border-radius: 4px;
}
.enterprise-content {
  padding: 20px;
  overflow: auto;
  min-width: 0;
}
.collapsed .enterprise-menu-item {
  justify-content: center;
  padding: 12px;
}
.collapsed .enterprise-sidebar-footer {
  flex-direction: column;
  padding: 12px;
}
@media (max-width: 768px) {
  .enterprise-console {
    --sidebar-width: 240px;
  }
  .enterprise-title {
    font-size: 14px;
    padding-left: 16px;
  }
  .enterprise-header {
    gap: 16px;
    padding: 0 16px;
  }
}
@media (max-width: 480px) {
  .enterprise-console {
    --sidebar-width: min(280px, 100vw);
  }
  .enterprise-title {
    display: none;
  }
  .enterprise-content {
    display: none;
  }
}
</style>
