import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";

/** 各视图路由。
 *  视图组件目前尚未实现，先以空壳占位，
 *  后续逐视图迁移即可替换为实际 SFC。
 */
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
];

const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
