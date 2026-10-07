import { until } from '@vueuse/core'
import { createRouter, createWebHistory } from 'vue-router'
import { useServerConfig } from '@/composables/queries'
import { session } from '@/lib/session'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('@/pages/LoginPage.vue'), meta: { public: true } },
    { path: '/signup', name: 'signup', component: () => import('@/pages/SignupPage.vue'), meta: { public: true } },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('@/pages/ForgotPasswordPage.vue'), meta: { public: true } },
    // Uses the invite meta: a reset link must open whatever the session state.
    { path: '/reset-password', name: 'reset-password', component: () => import('@/pages/ResetPasswordPage.vue'), meta: { invite: true } },
    { path: '/', name: 'overview', component: () => import('@/pages/OverviewPage.vue') },
    // Device authorization approval (desktop / CLI login). Authed; guests bounce to login then back.
    { path: '/device', name: 'device', component: () => import('@/pages/DeviceApprovalPage.vue') },
    {
      path: '/settings',
      component: () => import('@/pages/SettingsLayout.vue'),
      children: [
        { path: '', redirect: { name: 'settings-account' } },
        { path: 'account', name: 'settings-account', component: () => import('@/pages/AccountSettingsPage.vue') },
        { path: 'workspace', name: 'settings-workspace', component: () => import('@/pages/WorkspaceSettingsPage.vue') },
      ],
    },
    {
      path: '/accept-invite/:invitationId',
      name: 'accept-invite',
      component: () => import('@/pages/AcceptInvitePage.vue'),
      props: true,
      meta: { invite: true },
    },
    {
      path: '/projects/:projectId',
      name: 'project',
      component: () => import('@/pages/ProjectPage.vue'),
      props: true,
    },
    {
      path: '/projects/:projectId/runs/:runId',
      name: 'run',
      component: () => import('@/pages/RunPage.vue'),
      props: true,
    },
    {
      path: '/projects/:projectId/compare',
      name: 'compare',
      component: () => import('@/pages/ComparePage.vue'),
      props: true,
    },
    {
      path: '/projects/:projectId/tests',
      name: 'tests',
      component: () => import('@/pages/TestsPage.vue'),
      props: true,
    },
    {
      path: '/projects/:projectId/components',
      name: 'components',
      component: () => import('@/pages/ComponentsPage.vue'),
      props: true,
    },
    {
      path: '/projects/:projectId/settings',
      name: 'project-settings',
      component: () => import('@/pages/ProjectSettingsPage.vue'),
      props: true,
    },
    {
      path: '/projects/:projectId/test',
      name: 'test',
      component: () => import('@/pages/TestHistoryPage.vue'),
      props: true,
    },
    { path: '/admin', name: 'admin', component: () => import('@/pages/AdminPage.vue'), meta: { admin: true } },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// Wait for the session to resolve, then gate: guests to /login, authed users
// away from the public auth pages.
router.beforeEach(async (to) => {
  await session.ensure()
  const authed = !!session.user.value
  // Invite acceptance handles both guest and authed states itself.
  if (to.meta.invite)
    return
  if (!authed && !to.meta.public) {
    // Preserve deep-links (e.g. /device?user_code=…) as ?redirect; the root needs none
    // since overview is the default post-login landing.
    return to.fullPath === '/' ? { name: 'login' } : { name: 'login', query: { redirect: to.fullPath } }
  }
  if (authed && to.meta.public)
    return { name: 'overview' }
  // Platform-admin page: cloud deployment + global admin role, matching the nav gate. Others bounce.
  if (to.meta.admin) {
    // isLoading settles on success or error; isReady never flips on a failed config fetch.
    const { state: config, isLoading } = useServerConfig()
    await until(isLoading).toBe(false)
    if (!config.value?.adminEnabled || session.user.value?.role !== 'admin')
      return { name: 'overview' }
  }
})
