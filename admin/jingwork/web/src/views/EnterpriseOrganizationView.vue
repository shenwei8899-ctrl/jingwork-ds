<script setup>
import { ref, computed, onMounted } from 'vue'
import { Folder, Plus, Search, RefreshCw } from '@lucide/vue'
import { departmentApi } from '@/apis/department_api'
import { useUserStore } from '@/stores/user'
import UserManagementComponent from '@/components/UserManagementComponent.vue'
import DepartmentManagementComponent from '@/components/DepartmentManagementComponent.vue'
const store = useUserStore()
const departments = ref([])
const selected = ref(null)
const query = ref('')
const error = ref('')
const loading = ref(false)
const members = ref()
const manager = ref()
const visible = computed(() => departments.value.filter((d) => d.name.includes(query.value.trim())))
const name = computed(
  () => departments.value.find((d) => d.id === selected.value)?.name || '全部成员'
)
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    departments.value = await departmentApi.getDepartments()
  } catch (e) {
    error.value = e.message || '部门加载失败'
  } finally {
    loading.value = false
  }
}
function choose(id) {
  selected.value = id
  members.value?.setDepartment(id)
}
onMounted(refresh)
</script>
<template>
  <section class="organization">
    <h1>组织架构</h1>
    <a-alert v-if="error" type="error" show-icon :message="error" />
    <div v-if="store.isAdmin" class="organization-card">
      <aside class="departments">
        <div class="department-heading">
          <strong>部门</strong
          ><a-button
            v-if="store.isSuperAdmin"
            type="text"
            size="small"
            @click="manager.showAddDepartmentModal()"
            ><Plus :size="14" />添加</a-button
          ><a-button
            type="text"
            size="small"
            aria-label="刷新部门"
            :loading="loading"
            @click="refresh"
            ><RefreshCw :size="14"
          /></a-button>
        </div>
        <a-input v-model:value="query" placeholder="搜索部门名称" allow-clear
          ><template #prefix><Search :size="14" /></template
        ></a-input>
        <nav aria-label="部门列表">
          <button
            class="department-row"
            :class="{ active: selected === null }"
            @click="choose(null)"
          >
            <Folder :size="18" /><span>全部成员</span>
          </button>
          <div v-for="department in visible" :key="department.id" class="department-entry">
            <button
              class="department-row"
              :class="{ active: selected === department.id }"
              @click="choose(department.id)"
            >
              <Folder :size="18" /><span>{{ department.name }}</span
              ><small>{{ department.user_count ?? 0 }}</small>
            </button>
            <a-dropdown v-if="store.isSuperAdmin" :trigger="['click']"
              ><a-button type="text" size="small" :aria-label="`管理${department.name}`"
                >···</a-button
              ><template #overlay
                ><a-menu
                  ><a-menu-item @click="manager.showEditDepartmentModal(department)"
                    >编辑部门</a-menu-item
                  ><a-menu-item
                    :disabled="department.id === 1"
                    danger
                    @click="manager.confirmDeleteDepartment(department)"
                    >删除部门</a-menu-item
                  ></a-menu
                ></template
              ></a-dropdown
            >
          </div>
          <a-empty v-if="!visible.length && !loading" description="暂无匹配部门" />
        </nav>
      </aside>
      <main class="member-panel">
        <div class="member-heading">
          <strong>{{ name }}</strong
          ><span>成员数：{{ members?.total ?? 0 }}</span>
        </div>
        <UserManagementComponent ref="members" />
      </main>
      <DepartmentManagementComponent
        v-if="store.isSuperAdmin"
        ref="manager"
        class="department-dialogs"
        @departments-updated="departments = $event"
      />
    </div>
    <a-result v-else status="403" title="仅管理员可管理组织" />
  </section>
</template>
<style scoped lang="less">
.organization h1 {
  font-size: 18px;
  margin: 4px 0 20px;
}
.organization-card {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  background: var(--gray-0);
  border: 1px solid var(--gray-150);
  border-radius: 12px;
  min-height: calc(100dvh - 160px);
  overflow: hidden;
}
.departments {
  border-right: 1px solid var(--gray-150);
  padding: 22px 16px;
}
.department-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 20px;
  strong {
    margin-right: auto;
  }
}
nav {
  margin-top: 20px;
}
.department-entry {
  display: flex;
  align-items: center;
}
.department-row {
  border: 0;
  background: transparent;
  color: var(--color-text);
  width: 100%;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  svg {
    color: var(--main-color);
    flex-shrink: 0;
  }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  small {
    color: var(--color-text-secondary);
  }
  &.active,
  &:hover {
    background: var(--gray-50);
  }
}
.member-panel {
  min-width: 0;
  padding: 24px;
}
.member-heading {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
  strong {
    font-size: 15px;
  }
  span {
    font-size: 13px;
    color: var(--color-text-secondary);
  }
}
.member-panel :deep(.section-title),
.member-panel :deep(.section-description) {
  display: none;
}
.member-panel :deep(.filter-actions .filter-select:first-child) { display: none; }
.member-panel :deep(.header-section) {
  justify-content: flex-end;
  margin-bottom: 16px;
}
.member-panel :deep(.settings-table .ant-table-tbody > tr:nth-child(odd) > td) {
  background: var(--gray-25, var(--gray-50));
}
.department-dialogs {
  display: none;
}
@media (max-width: 900px) {
  .organization-card {
    grid-template-columns: 190px minmax(0, 1fr);
  }
  .member-panel {
    padding: 16px;
  }
}
@media (max-width: 640px) {
  .organization-card {
    display: block;
  }
  .departments {
    border-right: 0;
    border-bottom: 1px solid var(--gray-150);
  }
  nav {
    max-height: 180px;
    overflow: auto;
  }
}
</style>
