<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useAppStore } from "@/stores/app";
import { useDevicesStore } from "@/stores/devices";
import { useRobotStore } from "@/stores/robot";
import type { ViewName } from "@/types";

const appStore = useAppStore();
const devicesStore = useDevicesStore();
const robotStore = useRobotStore();

const emit = defineEmits<{
  "ops-action": [payload: { type: string }];
}>();

const opsMenuOpen = ref(false);

const robotName = computed(() => {
  if (devicesStore.robotInfo?.name) return devicesStore.robotInfo.name;
  if (devicesStore.currentDevice?.name) return devicesStore.currentDevice.name;
  return "未连接";
});

const connectionStatusClass = computed(() => appStore.connectionClass);
const connectionText = computed(() => appStore.connectionText);
const robotStatusBarVisible = computed(() => appStore.connection === "connected" || !!devicesStore.currentDevice);

const wifiStatus = computed(() => {
  if (appStore.connection !== "connected") return "--";
  return robotStore.systemStatus.wifi.signal;
});

const batteryStatus = computed(() => {
  if (appStore.connection !== "connected") return "--%";
  return `${robotStore.systemStatus.battery.level}%`;
});

const bluetoothStatus = computed(() => {
  return devicesStore.currentDevice ? "已连接" : "--";
});

const controlModeLabel = computed(() => {
  switch (appStore.controlMode) {
    case "manual":
      return "手动";
    case "semi":
      return "半自动";
    case "auto":
      return "全自动";
    default:
      return "--";
  }
});

const navItems = [
  { view: "quickActions", label: "⚡ 快速操作" },
  { view: "logs", label: "📋 日志" },
  { view: "messages", label: "📬 消息" },
  { view: "status", label: "📊 状态" },
  { view: "software", label: "📦 软件" },
  { view: "remote", label: "🎮 遥控" },
  { view: "dance", label: "💃 跳舞" },
  { view: "map", label: "🗺️ 地图" },
  { view: "gallery", label: "🖼️ 图库" },
] as const;

const currentView = computed(() => appStore.currentView);

function navigate(view: ViewName) {
  appStore.setView(view);
}

function toggleSidebar() {
  appStore.sidebarCollapsed = !appStore.sidebarCollapsed;
  appStore.saveSettings();
}

function toggleOpsMenu() {
  opsMenuOpen.value = !opsMenuOpen.value;
}

function handleOpsAction(action: string) {
  opsMenuOpen.value = false;
  emit("ops-action", { type: action });
}

const connectionTooltipHTML = computed(() => {
  const conn = appStore.connection;
  const dev = devicesStore.currentDevice;
  const info = devicesStore.robotInfo;
  let html = "";
  if (conn === "disconnected") {
    html = '<span style="color:var(--text-muted);">当前未连接任何设备</span>';
  } else if (conn === "connecting") {
    html =
      '<div class="tip-row"><span class="tip-label">状态</span><span class="tip-value" style="color:var(--warning);">连接中...</span></div>';
    if (dev) {
      html +=
        '<div class="tip-row"><span class="tip-label">设备</span><span class="tip-value">' + dev.name + "</span></div>";
      html +=
        '<div class="tip-row"><span class="tip-label">地址</span><span class="tip-value">' +
        dev.ip +
        ":" +
        (dev.port || 8765) +
        "</span></div>";
    }
  } else if (conn === "connected") {
    html +=
      '<div class="tip-row"><span class="tip-label">状态</span><span class="tip-value" style="color:var(--success);">● 已连接</span></div>';
    if (appStore.mockMode) {
      html += '<hr class="tip-divider">';
      html +=
        '<div class="tip-row"><span class="tip-label">模式</span><span class="tip-value">Mock (模拟)</span></div>';
      html +=
        '<div class="tip-row"><span class="tip-label">设备</span><span class="tip-value">Mock 机器人</span></div>';
      html += '<div class="tip-row"><span class="tip-label">型号</span><span class="tip-value">wo-bot-pro</span></div>';
      html += '<div class="tip-row"><span class="tip-label">版本</span><span class="tip-value">1.0.0</span></div>';
      html += '<hr class="tip-divider">';
      html +=
        '<div class="tip-features"><span class="tip-tag">motion</span><span class="tip-tag">camera</span><span class="tip-tag">audio</span><span class="tip-tag">gps</span><span class="tip-tag">lidar</span></div>';
    } else if (info) {
      html += '<hr class="tip-divider">';
      html +=
        '<div class="tip-row"><span class="tip-label">设备</span><span class="tip-value">' +
        (info.name || "--") +
        "</span></div>";
      html +=
        '<div class="tip-row"><span class="tip-label">ID</span><span class="tip-value monospace">' +
        (info.robot_id || "--") +
        "</span></div>";
      html +=
        '<div class="tip-row"><span class="tip-label">型号</span><span class="tip-value">' +
        (info.model || "--") +
        "</span></div>";
      html +=
        '<div class="tip-row"><span class="tip-label">版本</span><span class="tip-value">v' +
        (info.version || "--") +
        "</span></div>";
      if (dev)
        html +=
          '<div class="tip-row"><span class="tip-label">地址</span><span class="tip-value monospace">' +
          dev.ip +
          ":" +
          (dev.port || 8765) +
          "</span></div>";
      if (info.features && info.features.length > 0) {
        html += '<hr class="tip-divider"><div class="tip-features">';
        info.features.forEach((f: string) => {
          html += '<span class="tip-tag">' + f + "</span>";
        });
        html += "</div>";
      }
    } else if (dev) {
      html += '<hr class="tip-divider">';
      html +=
        '<div class="tip-row"><span class="tip-label">设备</span><span class="tip-value">' + dev.name + "</span></div>";
      html +=
        '<div class="tip-row"><span class="tip-label">地址</span><span class="tip-value monospace">' +
        dev.ip +
        ":" +
        (dev.port || 8765) +
        "</span></div>";
    }
    html += '<hr class="tip-divider">';
    html +=
      '<div class="tip-row"><span class="tip-label">延迟</span><span class="tip-value">' +
      (appStore.mockMode ? "~" + appStore._lastPing + "ms (Mock)" : appStore._lastPing + "ms") +
      "</span></div>";
  } else if (conn === "error") {
    html = '<span style="color:var(--danger);">连接错误</span>';
    if (dev) {
      html += '<hr class="tip-divider">';
      html +=
        '<div class="tip-row"><span class="tip-label">设备</span><span class="tip-value">' + dev.name + "</span></div>";
      html +=
        '<div class="tip-row"><span class="tip-label">地址</span><span class="tip-value monospace">' +
        dev.ip +
        ":" +
        (dev.port || 8765) +
        "</span></div>";
    }
  }
  return html;
});

function closeOpsMenu(e: MouseEvent) {
  const wrapper = document.querySelector(".ops-menu-wrapper");
  if (wrapper && !wrapper.contains(e.target as Node)) {
    opsMenuOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", closeOpsMenu));
onUnmounted(() => document.removeEventListener("click", closeOpsMenu));
</script>

<template>
  <header class="header">
    <div class="header-inner">
      <div class="header-left">
        <button class="menu-btn" @click="toggleSidebar">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M3 6h18v2H3V6m0 5h18v2H3v-2m0 5h18v2H3v-2z" />
          </svg>
        </button>
        <div class="robot-info">
          <span class="robot-name">{{ robotName }}</span>
        </div>
      </div>
      <div class="header-center">
        <div class="connection-status" :class="connectionStatusClass">
          <span class="status-dot"></span>
          <span class="status-text">{{ connectionText }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="conn-tooltip" v-html="connectionTooltipHTML"></div>
        </div>
        <div v-show="robotStatusBarVisible" class="robot-status-bar">
          <div class="status-item" title="网络状态">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                fill="currentColor"
                d="M12 3C7.46 3 3.34 4.78.29 7.67c-.18.18-.29.43-.29.71 0 .28.11.53.29.71l11 11c.39.39 1.02.39 1.41 0l11-11c.18-.18.29-.43.29-.71 0-.28-.11-.53-.29-.71C20.66 4.78 16.54 3 12 3z"
              />
            </svg>
            <span>{{ wifiStatus }}</span>
          </div>
          <div class="status-item" title="电池">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path fill="currentColor" d="M16 20h-8v-2h8v2zm2-4H6v-2h12v2zm0-4H6V6h12v6z" />
            </svg>
            <span>{{ batteryStatus }}</span>
          </div>
          <div class="status-item" title="蓝牙">
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                fill="currentColor"
                d="M14.24 12.01l2.32 2.32c.28-.72.44-1.51.44-2.33 0-.82-.16-1.59-.43-2.31l-2.33 2.32zm5.29-5.3l-1.26 1.26c.63 1.21.98 2.57.98 4.02s-.36 2.82-.98 4.02l1.2 1.2c.97-1.54 1.54-3.36 1.54-5.31-.01-1.89-.55-3.67-1.48-5.19zm-3.82 1L10 2H9v7.59L4.41 5 3 6.41 8.59 12 3 17.59 4.41 19 9 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM11 5.83l1.88 1.88L11 9.59V5.83zm1.88 10.46L11 18.17v-3.76l1.88 1.88z"
              />
            </svg>
            <span>{{ bluetoothStatus }}</span>
          </div>
          <div class="status-item">
            <span class="control-mode">{{ controlModeLabel }}</span>
          </div>
        </div>
      </div>
      <div class="header-right">
        <div class="ops-menu-wrapper">
          <button class="icon-btn" title="操作" @click="toggleOpsMenu">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
              />
            </svg>
          </button>
          <div class="ops-menu-dropdown" :class="{ show: opsMenuOpen }">
            <button class="ops-menu-item" @click="handleOpsAction('reboot')">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="currentColor"
                  d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
                />
              </svg>
              重启机器人
            </button>
            <button class="ops-menu-item" @click="handleOpsAction('shutdown')">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="currentColor"
                  d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0119 12c0 3.87-3.13 7-7 7A6.995 6.995 0 017.58 6.58L6.17 5.17A8.932 8.932 0 003 12a9 9 0 0018 0c0-2.74-1.23-5.18-3.17-6.83z"
                />
              </svg>
              关机
            </button>
            <button class="ops-menu-item" @click="handleOpsAction('forget')">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path
                  fill="currentColor"
                  d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                />
              </svg>
              忘记此设备
            </button>
          </div>
        </div>
        <button class="icon-btn" title="切换主题" @click="appStore.toggleTheme()">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              v-if="appStore.theme === 'dark'"
              fill="currentColor"
              d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z"
            />
            <path
              v-else
              fill="currentColor"
              d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"
            />
          </svg>
        </button>
        <button class="icon-btn" title="设置" @click="navigate('settings')">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="header-nav">
      <button
        v-for="item in navItems"
        :key="item.view"
        :class="{ active: currentView === item.view }"
        @click="navigate(item.view)"
      >
        {{ item.label }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  flex-shrink: 0;
  z-index: 200;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 16px;
}
.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.menu-btn,
.icon-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.menu-btn:hover,
.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.icon-btn.active {
  background: var(--accent);
  color: var(--bg-primary);
}
.robot-info {
  display: flex;
  flex-direction: column;
}
.robot-name {
  font-weight: 600;
}
.header-center {
  display: flex;
  align-items: center;
  gap: 16px;
}
.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  position: relative;
  cursor: pointer;
}
.connection-status::before {
  content: "";
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 8px;
  background: transparent;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}
.connection-status.connected .status-dot {
  background: var(--success);
}
.connection-status.connecting .status-dot {
  animation: pulse 1s infinite;
  background: var(--warning);
}
.connection-status.error .status-dot {
  background: var(--danger);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
.conn-tooltip {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 220px;
  padding: 12px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-primary);
  z-index: 300;
  white-space: nowrap;
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease;
}
.connection-status:not(:hover) .conn-tooltip {
  transition-delay: 0.3s;
}
.conn-tooltip::before {
  content: "";
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid var(--border);
}
.conn-tooltip::after {
  content: "";
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 5px solid var(--bg-card);
}
.connection-status:hover .conn-tooltip,
.conn-tooltip:hover {
  display: block;
}
.robot-status-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.control-mode {
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--bg-primary);
  font-weight: 600;
  font-size: 11px;
}
.ops-menu-wrapper {
  position: relative;
}
.ops-menu-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 180px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  z-index: 200;
  overflow: hidden;
}
.ops-menu-dropdown.show {
  display: block;
}
.ops-menu-item {
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}
.ops-menu-item:hover {
  background: var(--bg-hover);
}
.ops-menu-item.danger {
  color: var(--danger);
}
.header-nav {
  display: flex;
  gap: 2px;
  padding: 4px 20px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.header-nav button {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.header-nav button:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.header-nav button.active {
  background: var(--accent);
  color: #fff;
}

/* ---- 连接提示工具 (tip styles) ---- */
.conn-tooltip :deep(.tip-row) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}
.conn-tooltip :deep(.tip-label) {
  color: var(--text-muted);
  margin-right: 12px;
  font-size: 12px;
}
.conn-tooltip :deep(.tip-value) {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
  font-size: 12px;
}
.conn-tooltip :deep(.tip-divider) {
  margin: 6px 0;
  border: none;
  border-top: 1px solid var(--border-light);
}
.conn-tooltip :deep(.tip-features) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}
.conn-tooltip :deep(.tip-tag) {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: rgba(0, 212, 255, 0.15);
  color: var(--accent);
}
.conn-tooltip :deep(.monospace) {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}
</style>
