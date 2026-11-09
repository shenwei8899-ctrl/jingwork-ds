<script setup>
import { ref, computed, onMounted } from 'vue'
import { octopExpertApi } from '@/apis/octop_expert_api'
import OctopExpertCatalog from '@/components/model-management/OctopExpertCatalog.vue'
const tab = ref('mine')
const data = ref({ experts: [], teams: [], connected: false })
const loading = ref(false)
const error = ref('')
const query = ref('')
let generation = 0
const items = computed(() =>
  (tab.value === 'mine' ? data.value.experts : data.value.teams).filter((item) =>
    (item.name || '').includes(query.value)
  )
)
async function load() {
  const ticket = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await octopExpertApi.personal()
    if (ticket === generation) data.value = result
  } catch (e) {
    if (ticket === generation) {
      data.value = { experts: [], teams: [], connected: false }
      error.value = e.message || '专家加载失败'
    }
  } finally {
    if (ticket === generation) loading.value = false
  }
}
onMounted(load)
</script>
<template>
  <section class="expert-management">
    <h1>专家管理</h1>
    <p>查看当前账号的桌面专家、团队及公共专家模板</p>
    <div class="expert-card">
      <a-tabs v-model:activeKey="tab"
        ><a-tab-pane key="mine" tab="我的专家" /><a-tab-pane
          key="teams"
          tab="我的团队" /><a-tab-pane key="bundled" tab="内置专家" /><a-tab-pane
          key="market"
          tab="专家市场"
      /></a-tabs>
      <OctopExpertCatalog v-if="tab === 'bundled' || tab === 'market'" :key="tab" :source="tab" />
      <template v-else
        ><a-alert v-if="error" :message="error" type="error" show-icon />
        <div class="toolbar">
          <span>共 {{ items.length }} 个{{ tab === 'mine' ? '专家' : '团队' }}</span
          ><a-input v-model:value="query" placeholder="搜索名称" allow-clear /><a-button
            :loading="loading"
            @click="load"
            >刷新</a-button
          >
        </div>
        <a-spin :spinning="loading"
          ><div class="cards">
            <article v-for="item in items" :key="item.id || item.agent_id">
              <h3>{{ item.name }}</h3>
              <p>{{ item.description || '桌面端当前账号的配置' }}</p>
              <small v-if="item.member_ids">{{ item.member_ids.length }} 位团队成员</small>
            </article>
          </div>
          <a-empty
            v-if="!loading && !items.length"
            :description="
              data.available === false
                ? data.message
                : data.connected
                ? '当前账号暂无内容'
                : '当前账号尚未关联桌面端，请使用统一账号登录桌面端'
            " /></a-spin
      ></template>
    </div>
  </section>
</template>
<style scoped>
h1 {
  font-size: 18px;
  margin: 4px 0 10px;
}
p {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.expert-card {
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  padding: 24px;
  margin-top: 20px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
}
.toolbar span {
  margin-right: auto;
  font-size: 13px;
}
.toolbar .ant-input-affix-wrapper {
  width: 260px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.cards article {
  border: 1px solid var(--gray-150);
  border-radius: 10px;
  padding: 20px;
}
.cards h3 {
  font-size: 15px;
  margin: 0 0 16px;
}
</style>
