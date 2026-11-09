<script setup>
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { Building2, Pencil, Plus } from '@lucide/vue'
import { companyApi } from '@/apis/company_api'
import { useUserStore } from '@/stores/user'
const store = useUserStore()
const company = ref(null)
const loading = ref(false)
const error = ref('')
const editing = ref(false)
const contactOpen = ref(false)
const contactIndex = ref(-1)
const form = reactive({ name: '', industry: '', size: '', domain: '', email_suffix: '' })
const contact = reactive({ name: '', phone: '', email: '' })
const columns = [
  { title: '姓名', dataIndex: 'name', key: 'name' },
  { title: '手机号', dataIndex: 'phone', key: 'phone' },
  { title: '邮箱', dataIndex: 'email', key: 'email' },
  { title: '操作', key: 'action', width: 150 }
]
async function load() {
  loading.value = true
  error.value = ''
  try {
    company.value = await companyApi.get()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
function edit() {
  Object.keys(form).forEach((k) => (form[k] = company.value[k] || ''))
  editing.value = true
}
async function persist(values) {
  loading.value = true
  try {
    const current = Object.fromEntries(
      Object.entries(company.value).filter(([key]) => key !== 'id')
    )
    company.value = await companyApi.save({ ...current, ...values })
    message.success('保存成功')
    return true
  } catch (e) {
    message.error(e.message || '保存失败')
    return false
  } finally {
    loading.value = false
  }
}
async function save() {
  if (await persist({ ...form })) editing.value = false
}
function editContact(index = -1) {
  contactIndex.value = index
  Object.assign(
    contact,
    index < 0 ? { name: '', phone: '', email: '' } : company.value.contacts[index]
  )
  contactOpen.value = true
}
async function saveContact() {
  const contacts = company.value.contacts.map((item) => ({ ...item }))
  if (contactIndex.value < 0) contacts.push({ ...contact })
  else contacts[contactIndex.value] = { ...contact }
  if (await persist({ contacts })) contactOpen.value = false
}
async function removeContact(index) {
  await persist({ contacts: company.value.contacts.filter((_, i) => i !== index) })
}
onMounted(() => {
  if (store.isAdmin) void load()
})
</script>
<template>
  <section class="company">
    <h1>企业信息</h1>
    <a-alert v-if="error" type="error" :message="error" show-icon /><a-result
      v-if="!store.isAdmin"
      status="403"
      title="仅管理员可查看企业资料"
    /><a-spin v-else :spinning="loading"
      ><template v-if="company">
        <div class="profile-card">
          <div class="profile-heading">
            <div class="company-avatar"><Building2 :size="30" /></div>
            <strong>{{ company.name }}</strong
            ><a-button v-if="store.isSuperAdmin" @click="edit"
              ><Pencil :size="14" />编辑信息</a-button
            >
          </div>
          <dl>
            <dt>企业 ID</dt>
            <dd>{{ company.id || '首次保存后生成' }}</dd>
            <dt>行业类型</dt>
            <dd>{{ company.industry || '暂未设置' }}</dd>
            <dt>企业规模</dt>
            <dd>{{ company.size || '暂未设置' }}</dd>
            <dt>企业域名</dt>
            <dd>{{ company.domain || '暂未设置' }}</dd>
            <dt>邮箱后缀</dt>
            <dd>{{ company.email_suffix || '暂未设置' }}</dd>
          </dl>
        </div>
        <div class="contact-card">
          <div class="contact-heading">
            <h2>企业联系人</h2>
            <a-button
              v-if="store.isSuperAdmin"
              :disabled="company.contacts.length >= 30"
              @click="editContact()"
              ><Plus :size="14" />添加联系人</a-button
            >
          </div>
          <p>维护企业联系人资料，最多添加 30 位。当前仅保存联系资料，不自动发送短信或邮件。</p>
          <a-table
            :columns="columns"
            :data-source="company.contacts"
            :pagination="false"
            :row-key="(_, index) => index"
            ><template #bodyCell="{ column, text, index }"
              ><a-space v-if="column.key === 'action' && store.isSuperAdmin"
                ><a-button type="link" size="small" @click="editContact(index)">编辑</a-button
                ><a-popconfirm title="确认删除该联系人？" @confirm="removeContact(index)"
                  ><a-button type="link" danger size="small">删除</a-button></a-popconfirm
                ></a-space
              ><span v-else>{{ text || '—' }}</span></template
            ></a-table
          >
        </div>
      </template></a-spin
    >
    <a-modal v-model:open="editing" title="编辑企业信息" :confirm-loading="loading" @ok="save"
      ><a-form layout="vertical"
        ><a-form-item label="企业名称" required
          ><a-input v-model:value="form.name" :maxlength="100" /></a-form-item
        ><a-form-item label="行业类型"
          ><a-select
            v-model:value="form.industry"
            :options="
              ['互联网与软件', '教育', '医疗健康', '金融', '制造业', '商业服务', '其他'].map(
                (value) => ({ value, label: value })
              )
            " /></a-form-item
        ><a-form-item label="企业规模"
          ><a-select
            v-model:value="form.size"
            :options="
              ['1–20 人', '21–100 人', '101–500 人', '501–1000 人', '1000 人以上'].map((value) => ({
                value,
                label: value
              }))
            " /></a-form-item
        ><a-form-item label="企业域名"
          ><a-input v-model:value="form.domain" placeholder="example.com" /></a-form-item
        ><a-form-item label="邮箱后缀"
          ><a-input v-model:value="form.email_suffix" placeholder="example.com"
        /></a-form-item>
        <p class="help">域名与邮箱后缀为企业资料，保存不会修改登录认证配置。</p></a-form
      ></a-modal
    >
    <a-modal
      v-model:open="contactOpen"
      :title="contactIndex < 0 ? '添加联系人' : '编辑联系人'"
      :confirm-loading="loading"
      @ok="saveContact"
      ><a-form layout="vertical"
        ><a-form-item label="姓名" required
          ><a-input v-model:value="contact.name" :maxlength="100" /></a-form-item
        ><a-form-item label="手机号"
          ><a-input v-model:value="contact.phone" :maxlength="32" /></a-form-item
        ><a-form-item label="邮箱"
          ><a-input v-model:value="contact.email" :maxlength="254" /></a-form-item></a-form
    ></a-modal>
  </section>
</template>
<style scoped>
h1 {
  font-size: 18px;
  margin: 4px 0 20px;
}
.profile-card,
.contact-card {
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  border-radius: 10px;
  padding: 28px;
  margin-bottom: 20px;
}
.profile-heading {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 32px;
}
.company-avatar {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: var(--gray-50);
  color: var(--main-color);
}
.profile-heading strong {
  font-size: 18px;
  flex: 1;
}
.ant-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
dl {
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: 22px;
  margin: 0;
  font-size: 14px;
}
dt {
  color: var(--color-text-secondary);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.contact-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  font-size: 16px;
  margin: 0;
}
.contact-card p,
.help {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.7;
  margin: 16px 0 24px;
}
@media (max-width: 640px) {
  .profile-card,
  .contact-card {
    padding: 16px;
  }
  dl {
    grid-template-columns: 100px 1fr;
  }
  .profile-heading {
    flex-wrap: wrap;
  }
}
</style>
