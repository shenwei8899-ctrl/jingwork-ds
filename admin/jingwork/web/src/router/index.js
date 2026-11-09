import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { sanitizeRedirect } from '@/utils/oidcAutoStart'

const AppLayout = () => import('@/layouts/AppLayout.vue')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/download',
      name: 'Download',
      component: () => import('@/views/DownloadView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/guide/:slug(.*)*',
      name: 'Guide',
      component: () => import('@/views/GuideView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/enterprise',
      name: 'EnterpriseConsole',
      component: () => import('@/views/EnterpriseConsoleView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true }
    },
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/HomeView.vue'),
      meta: { keepAlive: true, requiresAuth: false }
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../views/LoginView.vue'),
      meta: { requiresAuth: false }
    },
    {
      path: '/forbidden',
      name: 'Forbidden',
      component: () => import('@/views/ForbiddenView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/auth/oidc/callback', // oidc登录回调页面
      name: 'OIDCCallback',
      component: () => import('@/views/OIDCCallbackView.vue'),
      meta: { public: true }
    },
    {
      path: '/auth/cli/authorize',
      name: 'CLIAuthAuthorize',
      component: () => import('@/views/CLIAuthAuthorizeView.vue'),
      meta: { requiresAuth: true }
    },
    {
      path: '/agent',
      name: 'AgentMain',
      component: () => import('@/views/EnterpriseConsoleView.vue'),
      children: [
        {
          path: '',
          name: 'AgentComp',
          component: () => import('../views/AgentView.vue'),
          meta: { keepAlive: true, requiresAuth: true }
        },
        {
          path: ':thread_id',
          name: 'AgentCompWithThreadId',
          component: () => import('../views/AgentView.vue'),
          meta: { keepAlive: true, requiresAuth: true }
        }
      ]
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'WorkspaceComp',
          component: () => import('../views/WorkspaceView.vue'),
          meta: { keepAlive: true, requiresAuth: true }
        }
      ]
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'DashboardComp',
          component: () => import('../views/DashboardView.vue'),
          meta: { keepAlive: false, requiresAuth: true, requiresSuperAdmin: true }
        }
      ]
    },
    {
      path: '/agent-manage',
      name: 'agent-manage',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'AgentManageComp',
          component: () => import('../views/AgentManageView.vue'),
          meta: { keepAlive: false, requiresAuth: true }
        }
      ]
    },
    {
      path: '/extensions',
      name: 'extensions',
      component: () => import('@/views/EnterpriseConsoleView.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        {
          path: 'knowledgebase/:kbId',
          name: 'ExtensionKnowledgeBaseDetail',
          component: () => import('../views/DataBaseInfoView.vue')
        },
        {
          path: 'knowledgebase/:kbId/evaluation/:datasetId',
          name: 'ExtensionEvaluationBenchmarkDetail',
          component: () => import('../views/EvaluationBenchmarkDetailView.vue')
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../views/EmptyView.vue'),
      meta: { requiresAuth: false }
    }
  ]
})

// 全局前置守卫
router.beforeEach(async (to) => {
  // 检查路由是否需要认证
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth === true)
  const requiresAdmin = to.matched.some((record) => record.meta.requiresAdmin)
  const requiresSuperAdmin = to.matched.some((record) => record.meta.requiresSuperAdmin)

  const userStore = useUserStore()

  // 如果有 token 但用户信息未加载，先获取用户信息
  if (userStore.token && !userStore.userId) {
    try {
      await userStore.getCurrentUser()
    } catch (error) {
      // 如果获取用户信息失败（如 token 过期），清除 token
      console.error('获取用户信息失败:', error)
      userStore.logout()
    }
  }

  const isLoggedIn = userStore.isLoggedIn
  const isAdmin = userStore.isAdmin
  const isSuperAdmin = userStore.isSuperAdmin

  // 如果路由需要认证但用户未登录
  if (requiresAuth && !isLoggedIn) {
    // 保存尝试访问的路径，登录后跳转
    sessionStorage.setItem('redirect', to.fullPath)
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // 保留被拒绝的目标，明确告知权限要求，不静默返回对话页。
  if ((requiresAdmin && !isAdmin) || (requiresSuperAdmin && !isSuperAdmin)) {
    return {
      path: '/forbidden',
      query: { redirect: to.fullPath, role: requiresSuperAdmin ? 'superadmin' : 'admin' }
    }
  }

  // 如果用户已登录但访问登录页，按 redirect 参数跳转
  if (['/login', '/register'].includes(to.path) && isLoggedIn) {
    return sanitizeRedirect(to.query.redirect)
  }

  // 其他情况正常导航
  return true
})

export default router
