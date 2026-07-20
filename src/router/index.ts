import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import { useAuth } from "@/composables/useAuth";

/** 各视图路由 */
const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/quick-actions",
  },
  {
    path: "/quick-actions",
    name: "quickActions",
    component: () => import("../components/views/QuickActionsView.vue"),
  },
  {
    path: "/logs",
    name: "logs",
    component: () => import("../components/views/LogsView.vue"),
  },
  {
    path: "/messages",
    name: "messages",
    component: () => import("../components/views/MessagesView.vue"),
  },
  {
    path: "/status",
    name: "status",
    component: () => import("../components/views/StatusView.vue"),
  },
  {
    path: "/software",
    name: "software",
    component: () => import("../components/views/SoftwareView.vue"),
  },
  {
    path: "/remote",
    name: "remote",
    component: () => import("../components/views/RemoteView.vue"),
  },
  {
    path: "/dance",
    name: "dance",
    component: () => import("../components/views/DanceView.vue"),
  },
  {
    path: "/map",
    name: "map",
    component: () => import("../components/views/MapView.vue"),
  },
  {
    path: "/gallery",
    name: "gallery",
    component: () => import("../components/views/GalleryView.vue"),
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("../components/views/SettingsView.vue"),
  },
  // ─── OAuth2 授权回调（无导航守卫） ───
  {
    path: "/auth/callback",
    name: "authCallback",
    component: () => import("../components/views/AuthCallbackView.vue"),
  },
  // ─── 云端功能（需登录） ───
  {
    path: "/cloud/devices",
    name: "cloudDevices",
    component: () => import("../components/views/CloudDevicesView.vue"),
    meta: { requiresAuth: true },
  },
  {
    path: "/cloud/apps",
    name: "cloudApps",
    component: () => import("../components/views/CloudAppsView.vue"),
    meta: { requiresAuth: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** 导航守卫：检查需要认证的路由 */
router.beforeEach((to) => {
  if (to.meta.requiresAuth) {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated.value) {
      // 未登录时重定向到首页（首页会提示登录）
      return { name: "quickActions" };
    }
  }
});

export default router;
