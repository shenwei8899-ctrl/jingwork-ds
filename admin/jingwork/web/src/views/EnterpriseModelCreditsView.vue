<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { modelCreditApi } from '@/apis/model_credit_api'
import { useUserStore } from '@/stores/user'

const props = defineProps({ page: { type: String, default: 'quotas' } })
const pageTitles = { subscriptions: '订阅管理', quotas: '额度管理', memberUsage: '成员用量', orgUsage: '组织用量', appUsage: '应用用量', usageDetails: '用量明细' }
const pageDescriptions = {
  subscriptions: '查看当前额度周期和中转站接入配置。',
  quotas: '统一分配模型和月额度，配置模型计费价格。',
  memberUsage: '查看每位成员本月的额度、消耗和剩余积分。',
  orgUsage: '查看组织本月累计消耗和企业总额度。',
  appUsage: '查看按应用归属统计的模型消耗。',
  usageDetails: '查看最近 100 条调用的模型、Token 和积分结算明细。'
}
const user = useUserStore()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const data = ref({ policies: {}, balances: [], calls: [], models: [], members: [] })
const scope = ref('global')
const form = reactive({ enabled: false, default_model: '', allowed_models: [], monthly_credits: 10000, enterprise_monthly_credits: null, max_output_tokens: 4096 })
const prices = reactive({})
const relay = reactive({ connected: false, base_url: 'https://router.keenlight.ai', admin_key: '', usd_to_cny: null })
const remoteUsers = ref([])
const remoteKeys = ref([])
const bind = reactive({ uid: '', relay_user_id: null, relay_key_id: null })
const relayModelIds = ref('')
const selectedPrice = ref('')
const reviewCall = ref(null)
const reviewUsage = reactive({ input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0 })
const price = reactive({ input: 0, output: 0, cache_read: 0, cache_write: 0 })
const scopeOptions = computed(() => [
  { value: 'global', label: '全员默认' },
  ...[...new Set(data.value.members.map(member => member.department_id).filter(Boolean))].map(id => ({ value: `department:${id}`, label: `部门 ${id}` })),
  ...data.value.members.map(member => ({ value: `user:${member.uid}`, label: member.username }))
])
const modelOptions = computed(() => data.value.models.map(model => ({ value: model.spec, label: model.name })))
const enterpriseBalance = computed(() => data.value.balances.find(row => row.scope === 'enterprise') || { spent: '0', reserved: '0' })
const memberNames = computed(() => Object.fromEntries(data.value.members.map(member => [member.uid, member.username])))
const memberUsage = computed(() => data.value.members.map(member => {
  const policy = { monthly_credits: 10000, ...(data.value.policies.global || {}),
    ...(data.value.policies[`department:${member.department_id}`] || {}),
    ...(data.value.policies[`user:${member.uid}`] || {}) }
  const balance = data.value.balances.find(row => row.scope === `user:${member.uid}`) || { spent: '0', reserved: '0' }
  return { uid: member.uid, username: member.username, model: policy.default_model || '未分配',
    limit: policy.monthly_credits === null ? '不限' : policy.monthly_credits,
    spent: balance.spent, reserved: balance.reserved,
    remaining: policy.monthly_credits === null ? '不限' : Math.max(0, Number(policy.monthly_credits) - Number(balance.spent) - Number(balance.reserved)) }
}))
const pendingCalls = computed(() => data.value.calls.filter(call => call.status === 'pending_review'))
function hydrate() {
  const global = data.value.policies.global || {}
  const policy = { ...global, ...(data.value.policies[scope.value] || {}) }
  Object.assign(form, { enabled: false, default_model: '', allowed_models: [], monthly_credits: 10000, enterprise_monthly_credits: null, max_output_tokens: 4096 }, policy)
  Object.keys(prices).forEach(key => delete prices[key])
  Object.assign(prices, global.prices || {})
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const [result, connection] = await Promise.all([modelCreditApi.admin(), modelCreditApi.relay()])
    data.value = result
    Object.assign(relay, connection)
    hydrate()
  } catch (failure) { error.value = failure.message || '加载配置失败' }
  finally { loading.value = false }
}
async function save() {
  saving.value = true
  error.value = ''
  try {
    const payload = { default_model: form.default_model, allowed_models: form.allowed_models, monthly_credits: form.monthly_credits, max_output_tokens: form.max_output_tokens }
    if (scope.value === 'global') Object.assign(payload, { enabled: form.enabled, enterprise_monthly_credits: form.enterprise_monthly_credits, prices: { ...prices } })
    await modelCreditApi.policy(scope.value, payload)
    await load()
    message.success('模型和额度配置已保存')
  } catch (failure) { error.value = failure.message || '保存失败' }
  finally { saving.value = false }
}
async function connect() {
  saving.value = true
  error.value = ''
  try {
    Object.assign(relay, await modelCreditApi.connect({ base_url: relay.base_url, admin_key: relay.admin_key, usd_to_cny: relay.usd_to_cny }))
    relay.admin_key = ''
    remoteUsers.value = (await modelCreditApi.relayUsers()).items
    message.success('中转站已连接')
  } catch (failure) { error.value = failure.message || '中转站连接失败' }
  finally { saving.value = false }
}
async function remoteMembers() {
  try { remoteUsers.value = (await modelCreditApi.relayUsers()).items }
  catch (failure) { error.value = failure.message }
}
async function keyOptions() {
  bind.relay_key_id = null
  remoteKeys.value = []
  try { remoteKeys.value = (await modelCreditApi.relayKeys(bind.relay_user_id)).items.filter(key => key.status === 'active') }
  catch (failure) { error.value = failure.message }
}
async function bindMember() {
  saving.value = true
  try {
    await modelCreditApi.bind(bind.uid, { relay_user_id: bind.relay_user_id, relay_key_id: bind.relay_key_id })
    message.success('成员绑定已保存')
  } catch (failure) { error.value = failure.message }
  finally { saving.value = false }
}
async function registerRelayModels() {
  saving.value = true
  try {
    const models = relayModelIds.value.split(/[，,\n]/).map(value => value.trim()).filter(Boolean)
    await modelCreditApi.relayModels({ uid: bind.uid, models })
    await load()
    message.success('模型权限已验证，可在默认模型和价格中配置')
  } catch (failure) { error.value = failure.message }
  finally { saving.value = false }
}
function openReview(call) {
  reviewCall.value = call
  Object.assign(reviewUsage, { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0 })
}
async function settleReview() {
  saving.value = true
  try {
    await modelCreditApi.settle(reviewCall.value.id, {
      input_tokens: reviewUsage.input_tokens, output_tokens: reviewUsage.output_tokens,
      input_token_details: { cache_read: reviewUsage.cache_read, cache_creation: reviewUsage.cache_creation }
    })
    reviewCall.value = null
    await load()
    message.success('调用已按核对后的真实用量结算')
  } catch (failure) { error.value = failure.message }
  finally { saving.value = false }
}
function savePrice() {
  if (!selectedPrice.value) return
  prices[selectedPrice.value] = { ...price }
  message.success('价格已加入配置，请点击保存配置生效')
}
watch(scope, hydrate)
watch(selectedPrice, spec => Object.assign(price, { input: 0, output: 0, cache_read: 0, cache_write: 0 }, prices[spec] || {}))
onMounted(() => { if (user.isAdmin) void load() })
</script>

<template>
  <a-result v-if="!user.isAdmin" status="403" title="仅管理员可配置模型和成员额度" />
  <div v-else class="credits-page">
    <header><div><h1>{{ pageTitles[props.page] }}</h1><p>{{ pageDescriptions[props.page] }}</p></div><a-button :loading="loading" @click="load">刷新</a-button></header>
    <a-alert v-if="error" type="error" :message="error" show-icon />
    <a-spin :spinning="loading">
      <section v-if="props.page === 'quotas'"><h2>模型分配与月额度</h2><p>100 积分 = 1 元额度；月额度按北京时间自然月重置。</p>
        <a-form layout="vertical">
          <div class="grid">
            <a-form-item label="配置范围"><a-select v-model:value="scope" :options="scopeOptions" /></a-form-item>
            <a-form-item label="默认模型"><a-select v-model:value="form.default_model" :options="modelOptions" show-search /></a-form-item>
            <a-form-item label="允许使用的模型"><a-select v-model:value="form.allowed_models" mode="multiple" :options="modelOptions" /></a-form-item>
            <a-form-item label="成员每月额度（积分）"><a-input-number v-model:value="form.monthly_credits" :min="0" /></a-form-item>
            <a-form-item label="单次最大输出 Token"><a-input-number v-model:value="form.max_output_tokens" :min="1" :max="32768" /></a-form-item>
            <a-form-item v-if="scope === 'global'" label="企业每月总额度（空白表示不限）"><a-input-number v-model:value="form.enterprise_monthly_credits" :min="0" /></a-form-item>
          </div>
          <a-form-item v-if="scope === 'global'" label="启用统一模型与额度控制"><a-switch v-model:checked="form.enabled" /></a-form-item>
          <p>成员配置优先于部门，再沿用全员默认。启用前请配置有效模型凭据和价格。</p>
          <a-button type="primary" :loading="saving" @click="save">保存配置</a-button>
        </a-form>
      </section>
      <section v-if="props.page === 'quotas' && scope === 'global'"><h2>模型价格</h2><p>填写实际人民币价格（每百万 Token），包含中转站倍率。历史调用保留当时价格。</p>
        <a-select v-model:value="selectedPrice" :options="modelOptions" placeholder="选择模型" />
        <div class="grid prices"><a-form-item v-for="(label, field) in { input: '未缓存输入', output: '输出', cache_read: '缓存读取', cache_write: '缓存写入' }" :key="field" :label="label"><a-input-number v-model:value="price[field]" :min="0" :precision="6" /></a-form-item></div>
        <a-button :disabled="!selectedPrice" @click="savePrice">加入价格配置</a-button>
        <p>已配置价格的模型：{{ Object.keys(prices).join('、') || '暂无' }}</p>
      </section>
      <section v-if="props.page === 'subscriptions'"><h2>当前额度周期</h2>
        <a-descriptions bordered :column="1"><a-descriptions-item label="周期">北京时间自然月</a-descriptions-item><a-descriptions-item label="全员默认月额度">{{ data.policies.global?.monthly_credits ?? 10000 }} 积分</a-descriptions-item><a-descriptions-item label="统一模型控制">{{ data.policies.global?.enabled ? '已启用' : '未启用' }}</a-descriptions-item><a-descriptions-item label="付费订阅">暂未接入付费订阅与续费</a-descriptions-item></a-descriptions>
        <p>当前按成员月额度管理使用权限。</p><router-link to="/enterprise?page=quotas">配置成员额度</router-link>
      </section>
      <section v-if="props.page === 'subscriptions'"><h2>KeenLight 中转站</h2><p>{{ relay.connected ? '已连接；管理员 Key 保存在后台，不下发给桌面。' : '使用中转站管理员 API Key 连接成员和用量接口。' }}</p>
        <a-form layout="vertical"><div class="grid">
          <a-form-item label="中转站地址"><a-input v-model:value="relay.base_url" /></a-form-item>
          <a-form-item label="管理员 API Key"><a-input-password v-model:value="relay.admin_key" autocomplete="new-password" /></a-form-item>
          <a-form-item label="美元换算人民币汇率"><a-input-number v-model:value="relay.usd_to_cny" :min="0.000001" :precision="6" /></a-form-item>
        </div><a-button :loading="saving" @click="connect">验证并连接</a-button></a-form>
        <template v-if="relay.connected"><h3>成员绑定</h3><a-button @click="remoteMembers">读取中转站成员</a-button>
          <div class="grid">
            <a-form-item label="Jing Work 成员"><a-select v-model:value="bind.uid" :options="data.members.map(member => ({value: member.uid, label: member.username}))" /></a-form-item>
            <a-form-item label="中转站成员"><a-select v-model:value="bind.relay_user_id" :options="remoteUsers.map(member => ({ value: member.id, label: member.username || member.email }))" @change="keyOptions" /></a-form-item>
            <a-form-item label="成员专属 API Key"><a-select v-model:value="bind.relay_key_id" :options="remoteKeys.map(key => ({value: key.id, label: key.name}))" /></a-form-item>
          </div><a-button :disabled="!bind.uid || !bind.relay_user_id || !bind.relay_key_id" :loading="saving" @click="bindMember">确认绑定</a-button>
          <a-form-item label="启用的 OpenAI 兼容模型 ID（逗号分隔，按当前 Jing Work 成员权限验证）"><a-input v-model:value="relayModelIds" placeholder="填写中转站实际模型 ID" /></a-form-item>
          <a-button :disabled="!bind.uid || !relayModelIds.trim()" :loading="saving" @click="registerRelayModels">验证并加入模型目录</a-button>
        </template>
      </section>
      <section v-if="props.page === 'orgUsage'"><h2>本月组织用量 · {{ data.period }}</h2>
        <a-descriptions bordered :column="1"><a-descriptions-item label="已消耗积分">{{ enterpriseBalance.spent }}</a-descriptions-item><a-descriptions-item label="预占 / 待核对积分">{{ enterpriseBalance.reserved }}</a-descriptions-item><a-descriptions-item label="企业月额度">{{ data.policies.global?.enterprise_monthly_credits ?? '不限' }}</a-descriptions-item><a-descriptions-item label="成员数量">{{ data.members.length }}</a-descriptions-item></a-descriptions>
        <p>组织消耗以完整月余额为准。待核对调用保留预占，不当成零消耗。</p>
        <router-link to="/enterprise?page=memberUsage">查看成员用量</router-link>
      </section>
      <section v-if="props.page === 'memberUsage'"><h2>本月成员用量 · {{ data.period }}</h2>
        <a-table :data-source="memberUsage" row-key="uid" :scroll="{ x: 900 }" :columns="[{ title: '成员', dataIndex: 'username' }, { title: '分配模型', dataIndex: 'model' }, { title: '月额度', dataIndex: 'limit' }, { title: '已消耗', dataIndex: 'spent' }, { title: '预占 / 待核对', dataIndex: 'reserved' }, { title: '剩余额度', dataIndex: 'remaining' }]" />
      </section>
      <section v-if="props.page === 'appUsage'"><a-empty description="当前调用账本尚未记录应用标识，暂无法按应用统计用量。" /><p>成员和组织的实际消耗已计入各自的月余额。</p><router-link to="/enterprise?page=usageDetails">查看调用明细</router-link></section>
      <section v-if="props.page === 'usageDetails'"><h2>最近 100 条调用明细</h2><p>当前列表有 {{ pendingCalls.length }} 条待核对调用。</p><p>失败或取消时没有收到完整上游用量的调用保留为待核对，避免把未知费用当成零。</p>
        <a-table :data-source="data.calls" row-key="id" :scroll="{ x: 900 }" :columns="[{ title: '成员', key: 'member' }, { title: '模型', dataIndex: 'model_spec' }, { title: '账期', dataIndex: 'period' }, { title: '输入 Token', key: 'inputTokens' }, { title: '输出 Token', key: 'outputTokens' }, { title: '时间', dataIndex: 'created_at' }, { title: '积分', dataIndex: 'credits' }, { title: '状态', key: 'status' }, { title: '操作', key: 'action' }]"><template #bodyCell="{ column, record }"><template v-if="column.key === 'member'">{{ memberNames[record.uid] || record.uid }}</template><template v-else-if="column.key === 'inputTokens'">{{ record.usage?.input_tokens ?? '待核对' }}</template><template v-else-if="column.key === 'outputTokens'">{{ record.usage?.output_tokens ?? '待核对' }}</template><template v-else-if="column.key === 'status'">{{ { settled: '已结算', reserved: '调用中', pending_review: '待核对' }[record.status] }}</template><template v-else-if="column.key === 'action' && record.status === 'pending_review'"><a-button @click="openReview(record)">核对用量</a-button></template></template></a-table>
      </section>
    </a-spin>
    <a-modal :open="!!reviewCall" title="按上游真实 Token 用量核对" :confirm-loading="saving" ok-text="确认结算" @ok="settleReview" @cancel="reviewCall = null">
      <p>请依据供应商账单填写；输入总数包含缓存读写。此操作会释放预占并登记实际积分消耗。</p>
      <a-form layout="vertical"><a-form-item v-for="(label, field) in { input_tokens: '输入总 Token', output_tokens: '输出 Token', cache_read: '缓存读取 Token', cache_creation: '缓存写入 Token' }" :key="field" :label="label"><a-input-number v-model:value="reviewUsage[field]" :min="0" :precision="0" /></a-form-item></a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.credits-page { max-width: 1200px; margin: 0 auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h1 { font-size: 24px; }
h2 { font-size: 18px; margin-top: 0; }
p { color: var(--gray-600); }
section { margin-top: 20px; padding: 20px; border: 1px solid var(--gray-150); background: var(--gray-0); border-radius: 8px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
.grid :deep(.ant-input-number) { width: 100%; }
section :deep(.ant-select) { width: 100%; }
.prices { margin-top: 16px; }
@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
</style>
