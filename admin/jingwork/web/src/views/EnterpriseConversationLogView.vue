<script setup>
import { computed, onMounted, onBeforeUnmount, ref, reactive } from 'vue'
import { RefreshCw, Search, MessageSquare, UserRound, Bot, CheckCheck } from '@lucide/vue'
import { departmentApi } from '@/apis/department_api'
import PageHeader from '@/components/shared/PageHeader.vue'
import { useUserStore } from '@/stores/user'
import { conversationLogApi } from '@/apis/conversation_log_api'

const userStore = useUserStore()
const departments = ref([])
const roleOptions = [
  { value: 'superadmin', label: '超级管理员' },
  { value: 'admin', label: '管理员' },
  { value: 'user', label: '普通用户' }
]
const users = ref([])
const sessions = ref([])
const messages = ref([])
const total = ref(0)
const messageTotal = ref(0)
const page = ref(1)
const loading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const selected = ref(null)
const filters = reactive({
  department_id: undefined,
  role: undefined,
  uid: undefined,
  agent_id: undefined,
  query: ''
})
const agents = computed(() => users.value.find((user) => user.uid === filters.uid)?.agents || [])
let listGeneration = 0
let detailGeneration = 0
let alive = true
let timer
let applied = {}
const time = (value) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—')
const key = (session) =>
  JSON.stringify([session.uid, session.device_id, session.agent_id, session.thread_id])
const excerpt = (session) =>
  (session.question || `${session.agent_name}的对话`).replace(/\s+/g, ' ').slice(0, 100)
async function openSession(session, append = false) {
  const ticket = ++detailGeneration
  selected.value = session
  detailLoading.value = true
  error.value = ''
  if (!append) messages.value = []
  try {
    const result = await conversationLogApi.messages({
      uid: session.uid,
      device_id: session.device_id,
      agent_id: session.agent_id,
      thread_id: session.thread_id,
      offset: append ? messages.value.length : 0,
      limit: 100
    })
    if (ticket !== detailGeneration) return
    messages.value = append ? [...messages.value, ...result.items] : result.items
    messageTotal.value = result.total
  } catch (e) {
    if (ticket === detailGeneration) error.value = e.message || '会话详情加载失败'
  } finally {
    if (ticket === detailGeneration) detailLoading.value = false
  }
}
async function load(nextPage = 1, silent = false) {
  const ticket = ++listGeneration
  if (!silent) loading.value = true
  error.value = ''
  page.value = nextPage
  try {
    const result = await conversationLogApi.sessions({
      ...applied,
      offset: (nextPage - 1) * 30,
      limit: 30
    })
    if (ticket !== listGeneration) return
    sessions.value = result.items
    total.value = result.total
    const match = selected.value && sessions.value.find((item) => key(item) === key(selected.value))
    if (!match) {
      detailGeneration++
      selected.value = null
      messages.value = []
      detailLoading.value = false
      if (sessions.value[0]) await openSession(sessions.value[0])
    } else if (match.message_count !== selected.value.message_count) {
      await openSession(match)
    }
  } catch (e) {
    if (ticket === listGeneration) error.value = e.message || '日志加载失败'
  } finally {
    if (ticket === listGeneration) loading.value = false
  }
}
function search() {
  applied = { ...filters }
  detailGeneration++
  selected.value = null
  messages.value = []
  void load()
}
function reset() {
  Object.assign(filters, {
    department_id: undefined,
    role: undefined,
    uid: undefined,
    agent_id: undefined,
    query: ''
  })
  search()
}
function changeUser() {
  filters.agent_id = undefined
  search()
}
async function refresh() {
  try {
    const [result, teams] = await Promise.all([
      conversationLogApi.catalog(),
      departmentApi.getDepartments()
    ])
    if (!alive) return
    departments.value = teams
    users.value = result.users
    await load(page.value)
  } catch (e) {
    error.value = e.message || '日志加载失败'
  }
}
onMounted(() => {
  if (!userStore.isAdmin) return
  void refresh()
  timer = setInterval(() => {
    if (!document.hidden && !loading.value && !detailLoading.value) void load(page.value, true)
  }, 10000)
})
onBeforeUnmount(() => {
  alive = false
  clearInterval(timer)
  listGeneration++
  detailGeneration++
})
</script>

<template>
  <section class="conversation-view">
    <PageHeader title="对话日志" :show-border="true" />
    <div v-if="userStore.isAdmin" class="conversation-content">
      <div class="intro">
        <span>按用户查看已同步的聊天记录</span
        ><span class="sync-note"><CheckCheck :size="15" />已保存到后台 · 客户端离线可查看</span>
      </div>
      <a-alert v-if="error" type="error" show-icon :message="error" />
      <form class="filters" @submit.prevent="search">
        <label
          >部门<a-select
            v-model:value="filters.department_id"
            aria-label="部门"
            allow-clear
            show-search
            option-filter-prop="label"
            placeholder="全部部门"
            :options="departments.map((team) => ({ value: team.id, label: team.name }))"
            @change="search"
        /></label>
        <label
          >岗位<a-select
            v-model:value="filters.role"
            aria-label="岗位"
            allow-clear
            placeholder="全部岗位"
            :options="roleOptions"
        /></label>
        <a-select
          v-model:value="filters.uid"
          aria-label="用户"
          show-search
          allow-clear
          option-filter-prop="label"
          placeholder="全部用户"
          :options="
            users.map((user) => ({
              value: user.uid,
              label: user.username === user.uid ? user.username : `${user.username} (${user.uid})`
            }))
          "
          @change="changeUser"
        />
        <a-select
          v-model:value="filters.agent_id"
          aria-label="专家"
          show-search
          allow-clear
          option-filter-prop="label"
          placeholder="全部专家"
          :disabled="!filters.uid"
          :options="agents.map((agent) => ({ value: agent.id, label: agent.name }))"
          @change="search"
        />
        <a-input
          v-model:value="filters.query"
          aria-label="搜索对话内容"
          placeholder="搜索对话内容"
          :maxlength="500"
          allow-clear
          ><template #prefix><Search :size="16" /></template
        ></a-input>
        <a-button html-type="submit" type="primary">搜索</a-button>
        <a-button @click="reset">重置</a-button>
        <a-button :loading="loading" @click="refresh"
          ><template #icon><RefreshCw :size="16" /></template>刷新</a-button
        >
      </form>
      <div class="log-workspace">
        <aside class="session-pane">
          <div class="pane-title">
            <strong>会话</strong><span>{{ total }} 个</span>
          </div>
          <a-spin :spinning="loading">
            <div v-if="sessions.length" class="session-list">
              <button
                v-for="session in sessions"
                :key="key(session)"
                class="session"
                :class="{ active: selected && key(selected) === key(session) }"
                @click="openSession(session)"
              >
                <div class="session-person">
                  <span class="avatar"><UserRound :size="16" /></span
                  ><strong>{{ session.username }}</strong
                  ><span>{{ session.message_count }} 条</span>
                </div>
                <div class="session-question">{{ excerpt(session) }}</div>
                <div class="session-meta">
                  <span>{{ session.agent_name }}</span
                  ><time>{{ time(session.timestamp) }}</time>
                </div>
              </button>
            </div>
            <a-empty v-else description="暂无已同步会话" class="empty-list" />
          </a-spin>
          <a-pagination
            v-if="total > 30"
            size="small"
            :current="page"
            :total="total"
            :page-size="30"
            :show-size-changer="false"
            @change="load"
          />
        </aside>
        <main class="chat-pane">
          <template v-if="selected">
            <div class="chat-heading">
              <div>
                <strong>{{ selected.username }}</strong
                ><span>{{ selected.agent_name }}</span>
              </div>
              <div class="chat-subtitle">
                {{ messageTotal }} 条消息<span>最近同步 {{ time(selected.received_at) }}</span>
              </div>
            </div>
            <a-spin :spinning="detailLoading">
              <div class="chat-messages">
                <article
                  v-for="message in messages"
                  :key="message.id"
                  class="chat-message"
                  :class="{ human: message.event_type === 'user_message' }"
                >
                  <div class="message-avatar">
                    <UserRound v-if="message.event_type === 'user_message'" :size="18" /><Bot
                      v-else
                      :size="18"
                    />
                  </div>
                  <div class="message-body">
                    <div class="message-caption">
                      <strong>{{
                        message.event_type === 'user_message'
                          ? selected.username
                          : selected.agent_name
                      }}</strong
                      ><time>{{ time(message.timestamp) }}</time>
                    </div>
                    <div class="message-text">{{ message.content }}</div>
                  </div>
                </article>
                <a-button
                  v-if="messages.length < messageTotal"
                  :loading="detailLoading"
                  @click="openSession(selected, true)"
                  >加载更多消息</a-button
                >
              </div>
            </a-spin>
          </template>
          <div v-else class="empty-chat">
            <MessageSquare :size="40" :stroke-width="1.4" />
            <h3>查看聊天记录</h3>
            <p>选择左侧会话，查看用户消息与 AI 回复</p>
            <small>记录来自桌面记忆树原始素材，已同步内容保存在后台</small>
          </div>
        </main>
      </div>
    </div>
    <a-result v-else status="403" title="仅管理员可查看对话日志" />
  </section>
</template>

<style scoped lang="less">
.conversation-content {
  padding: 22px 28px;
}
.intro {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 20px;
  font-size: 13px;
}
.sync-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 16px 0 22px;
  align-items: center;
  label {
    display: grid;
    gap: 6px;
  }
  .ant-select {
    width: 190px;
  }
  .ant-input-affix-wrapper {
    max-width: 360px;
    flex: 1;
  }
  button {
    display: inline-flex;
    gap: 7px;
    align-items: center;
  }
}
.log-workspace {
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  overflow: hidden;
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  min-height: 440px;
  height: calc(100dvh - 260px);
  background: var(--gray-0);
}
.session-pane {
  overflow: auto;
  border-right: 1px solid var(--gray-150);
  .ant-pagination {
    padding: 14px;
  }
}
.pane-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px;
  border-bottom: 1px solid var(--gray-100);
  span {
    color: var(--color-text-tertiary);
    font-size: 12px;
  }
}
.session-list {
  padding: 10px;
}
.session {
  width: 100%;
  padding: 14px 12px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  background: transparent;
  color: var(--color-text);
  margin-bottom: 6px;
  &:hover {
    background: var(--gray-25);
  }
  &.active {
    background: var(--main-10);
    border-color: var(--main-100);
  }
}
.session-person {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  > span:last-child {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: 12px;
  }
}
.avatar {
  height: 26px;
  width: 26px;
  display: grid;
  place-items: center;
  background: var(--gray-50);
  border-radius: 7px;
}
.session-question {
  font-size: 13px;
  line-height: 1.6;
  margin: 10px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.session-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  justify-content: space-between;
}
.chat-pane {
  min-width: 0;
  overflow: auto;
  background: var(--gray-10);
}
.chat-heading {
  padding: 18px 24px;
  background: var(--gray-0);
  border-bottom: 1px solid var(--gray-100);
  position: sticky;
  top: 0;
  z-index: 1;
  > div:first-child {
    display: flex;
    gap: 12px;
    align-items: center;
    span {
      font-size: 12px;
      color: var(--color-text-secondary);
    }
  }
}
.chat-subtitle {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-top: 7px;
}
.chat-messages {
  padding: 24px;
}
.chat-message {
  display: flex;
  gap: 12px;
  margin-bottom: 26px;
  align-items: flex-start;
}
.message-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  color: var(--main-color);
}
.message-body {
  flex: 1;
  min-width: 0;
}
.message-caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  margin: 4px 0 10px;
  time {
    font-size: 11px;
    color: var(--color-text-tertiary);
  }
}
.message-text {
  font-size: 14px;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-radius: 10px;
  background: var(--gray-0);
  border: 1px solid var(--gray-100);
  padding: 16px 18px;
}
.human .message-text {
  background: var(--main-10);
  border-color: var(--main-50);
}
.empty-chat {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px;
  text-align: center;
  color: var(--color-text-tertiary);
  h3 {
    color: var(--color-text-secondary);
    margin: 18px 0 8px;
  }
  p {
    margin: 0 0 14px;
    font-size: 13px;
  }
  small {
    font-size: 11px;
  }
}
.empty-list {
  margin: 60px 10px;
}
@media (max-width: 900px) {
  .conversation-content {
    padding: 16px;
  }
  .intro {
    flex-wrap: wrap;
  }
  .filters {
    flex-wrap: wrap;
    .ant-select {
      flex: 1;
      min-width: 150px;
    }
    .ant-input-affix-wrapper {
      min-width: 200px;
      max-width: none;
    }
  }
  .log-workspace {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  .chat-messages {
    padding: 16px;
  }
}
@media (max-width: 640px) {
  .log-workspace {
    display: flex;
    flex-direction: column;
    height: auto;
  }
  .session-pane {
    max-height: 260px;
    border-right: 0;
    border-bottom: 1px solid var(--gray-150);
  }
  .chat-pane {
    min-height: 360px;
  }
}
</style>
