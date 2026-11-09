<script setup>
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { networkApi } from '@/apis/network_api'
import { useUserStore } from '@/stores/user'
const store = useUserStore()
const ips = ref('')
const currentIp = ref('')
const loading = ref(false)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await networkApi.get()
    ips.value = result.ranges.join(',')
    currentIp.value = result.current_ip || '未知'
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
async function save() {
  loading.value = true
  try {
    const result = await networkApi.save(ips.value)
    ips.value = result.ranges.join(',')
    message.success('网络设置已保存')
  } catch (e) {
    message.error(e.message || '保存失败')
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  if (store.isAdmin) void load()
})
</script>
<template>
  <section>
    <h1>网络设置</h1>
    <a-alert v-if="error" type="error" :message="error" show-icon /><a-result
      v-if="!store.isAdmin"
      status="403"
      title="仅管理员可查看网络设置"
    />
    <div v-else class="network-card">
      <h2>IP 白名单</h2>
      <p>配置允许访问桌面端业务接口的 IP 网段。后台管理入口保留访问能力，便于调整白名单。</p>
      <a-form layout="vertical"
        ><a-form-item label="可访问 IP"
          ><a-textarea
            v-model:value="ips"
            placeholder="请输入允许访问的 IP 网段"
            :rows="5"
            :disabled="!store.isSuperAdmin"
            :maxlength="16000" /></a-form-item
      ></a-form>
      <div class="ip-info">
        后台连接 IP：<a-typography-text :copyable="{ text: currentIp }">{{
          currentIp
        }}</a-typography-text>
      </div>
      <p>请录入允许访问的 IP，规则如下：</p>
      <ul>
        <li>多个 IP 用英文逗号或换行隔开，支持 IPv4、IPv6 和 CIDR 网段。</li>
        <li>不填写代表允许所有 IP 访问。</li>
        <li>仅设置 127.0.0.1 代表禁止桌面端统一账号业务接口访问。</li>
        <li>例如 10.10.10.0/24 允许该网段访问；单个 IP 会自动转为对应网段。</li>
        <li>按桌面服务实际连接来源判断。当前显示的是后台连接地址，经过代理时可能是代理地址。</li>
      </ul>
      <a-button v-if="store.isSuperAdmin" type="primary" :loading="loading" @click="save"
        >保存</a-button
      ><a-button class="refresh" :loading="loading" @click="load">刷新</a-button>
    </div>
  </section>
</template>
<style scoped>
h1 {
  font-size: 18px;
  margin: 4px 0 20px;
}
.network-card {
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  border-radius: 10px;
  padding: 28px;
}
h2 {
  font-size: 16px;
  margin: 0 0 14px;
}
p,
ul,
.ip-info {
  font-size: 13px;
  line-height: 1.9;
  color: var(--color-text-secondary);
}
.ant-form {
  max-width: 900px;
  margin-top: 24px;
}
.ip-info {
  margin: 12px 0 24px;
}
ul {
  padding-left: 20px;
  margin: 0 0 24px;
}
.refresh {
  margin-left: 12px;
}
</style>
