<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import { useAppStore } from "@/stores/app";
import { useDevicesStore } from "@/stores/devices";
import { useDiscovery } from "@/composables/useDiscovery";
import { useAuth } from "@/composables/useAuth";
import { useWebSocket, connectionMode, getStoredBinding } from "@/composables/useWebSocket";
import type { Device } from "@/types";
import type { CloudDevice } from "@/services/account";

const appStore = useAppStore();
const devicesStore = useDevicesStore();
const { isAuthenticated } = useAuth();
const { startScan } = useDiscovery();
const { connectViaSignal } = useWebSocket();

const rescanning = ref(false);
const connectingCloud = ref(false);

async function handleRescan() {
  rescanning.value = true;
  await startScan();
  rescanning.value = false;
}

const emit = defineEmits<{
  selectDevice: [device: Device];
  addDevice: [];
}>();

function isSameDevice(a: Device, b: Device): boolean {
  return a.id === b.id || (a.ip === b.ip && a.port === b.port);
}

/** 当前设备标识符集合（id + ip:port），用于模板中 O(1) 匹配且保证响应式 */
const currentDeviceKeys = computed(() => {
  const cd = devicesStore.currentDevice;
  if (!cd) return { id: "", key: "" };
  return { id: cd.id, key: `${cd.ip}:${cd.port}` };
});

function isCurrentDevice(device: Device): boolean {
  const keys = currentDeviceKeys.value;
  return device.id === keys.id || `${device.ip}:${device.port}` === keys.key;
}

function handleDeviceClick(device: Device) {
  const cd = devicesStore.currentDevice;
  // 核心修复：已点击的设备如果和 currentDevice 匹配（ip:port 相同），
  // 则把 currentDevice 指向该设备（解决 id 不一致导致 active 不显示的问题）
  if (cd && isSameDevice(cd, device) && cd.id !== device.id) {
    console.log("[Sidebar] currentDevice ID 不匹配，自动同步:", cd.id, "->", device.id);
    devicesStore.setCurrentDevice(device);
  }

  console.log("[Sidebar] 点击设备:", {
    name: device.name,
    ip: device.ip,
    port: device.port,
    hasCurrentDevice: !!cd,
    isSame: cd ? isSameDevice(cd, device) : "N/A",
    connection: appStore.connection,
  });

  if (!cd) {
    console.log("[Sidebar] 无当前设备, 发起连接");
    emit("selectDevice", device);
  } else if (!isSameDevice(cd, device)) {
    console.log("[Sidebar] 不同设备, 发起切换");
    emit("selectDevice", device);
  } else if (appStore.connection === "connected") {
    console.log("[Sidebar] 同一设备已连接, 显示 Toast");
    appStore.showToast("已连接该设备", "info");
  } else if (appStore.connection === "connecting") {
    console.log("[Sidebar] 同一设备连接中, 显示 Toast");
    appStore.showToast("正在连接中...", "info");
  } else {
    console.log("[Sidebar] 同一设备, 连接状态:", appStore.connection, "-> 重新连接");
    emit("selectDevice", device);
  }
}

function handleAddDevice() {
  emit("addDevice");
}

/** 云端设备（已去重） */
const cloudDevices = computed(() => devicesStore.cloudDevicesFiltered);

/** 刷新云端设备列表 */
async function handleRefreshCloud() {
  await devicesStore.loadCloudDevices();
}

/** 点击云端设备：按 robotId 匹配本地/发现设备，必要时自动扫描 */
async function handleCloudDeviceClick(device: { robotId: string; robotName: string | null }) {
  if (connectingCloud.value) return;
  connectingCloud.value = true;
  const targetName = device.robotName || device.robotId.slice(0, 8);

  try {
    // 1. 先在本地已保存设备中查找（robotId 或 id 匹配）
    const localMatch = devicesStore.devices.find(
      (d) => d.robotId === device.robotId || d.id === device.robotId,
    );
    if (localMatch) {
      // 验证本地可达性：mDNS 发现列表中有此设备才算本地在线
      const isLocallyReachable = devicesStore.discovered.some(
        (d) => d.robotId === device.robotId || `${d.ip}:${d.port}` === `${localMatch.ip}:${localMatch.port}`,
      );
      if (isLocallyReachable) {
        handleDeviceClick(localMatch);
        return;
      }
      // 本地不可达（如跨网络），走云端远控
      if (isAuthenticated.value && device.robotId) {
        appStore.showToast("本地不可达，正在通过云端连接设备...", "info");
        devicesStore.setCurrentDevice({
          id: device.robotId,
          name: device.robotName || "云端设备",
          ip: "",
          port: 0,
          robotId: device.robotId,
          online: true,
        });
        connectViaSignal(device.robotId);
        return;
      }
    }

    // 2. 在已发现设备中查找（按 robotId 或名称匹配）
    const findInDiscovered = () =>
      devicesStore.discovered.find(
        (d) =>
          d.robotId === device.robotId ||
          (d.name === device.robotName && device.robotName),
      );

    let discoveredMatch = findInDiscovered();
    if (discoveredMatch) {
      // 导入到本地列表并连接
      const imported = devicesStore.importDiscovered(discoveredMatch.id);
      if (imported) {
        imported.robotId = device.robotId;
        handleDeviceClick(imported);
      }
      return;
    }

    // 3. 未找到，自动触发 mDNS 扫描
    appStore.showToast(`正在局域网中搜索设备「${targetName}」...`, "info");
    await startScan();

    // 4. 扫描完成后再查找
    discoveredMatch = findInDiscovered();
    if (discoveredMatch) {
      const imported = devicesStore.importDiscovered(discoveredMatch.id);
      if (imported) {
        imported.robotId = device.robotId;
        handleDeviceClick(imported);
      }
      return;
    }

    // 5. 仍未找到 — 如果已登录且有 robotId，自动切换到云端远控模式
    if (isAuthenticated.value && device.robotId) {
      appStore.showToast("正在通过云端连接设备...", "info");
      devicesStore.setCurrentDevice({
        id: device.robotId,
        name: device.robotName || "云端设备",
        ip: "",
        port: 0,
        robotId: device.robotId,
        online: true,
      });
      connectViaSignal(device.robotId);
      return;
    }

    appStore.showToast(
      `设备「${targetName}」未在本地网络中发现，请确认设备已开机并连接到同一局域网`,
      "error",
    );
  } finally {
    connectingCloud.value = false;
  }
}

/**
 * 合并设备列表：本地已保存设备 + 云端绑定设备，按 robotId/id 去重
 * - 同一设备同时存在于本地和云端时，保留本地设备（有 ip:port 可直连），仅显示一次
 * - 纯云端设备（本地未保存）转换为 Device 形态（ip/port 为空），点击走云端连接
 * - tag 统一使用 getDeviceTags；"已绑定"由 isDeviceBoundToUser 自动判定
 *   （本地设备若同时绑定到云端，也会显示"已绑定"标签）
 */
const mergedDevices = computed<Device[]>(() => {
  const localDevices = devicesStore.devices;
  // 本地设备已覆盖的 robotId/id（去重时优先保留有 ip:port 的本地记录）
  const localKeys = new Set<string>();
  for (const d of localDevices) {
    const rid = d.robotId || d.id;
    if (rid) localKeys.add(rid);
  }
  const merged: Device[] = [...localDevices];
  for (const c of cloudDevices.value) {
    if (localKeys.has(c.robotId)) continue; // 去重：本地已存在则跳过
    merged.push({
      id: c.robotId,
      name: c.robotName || c.robotId.slice(0, 12),
      ip: "",
      port: 0,
      online: c.status === "online",
      robotId: c.robotId,
    });
  }
  return merged;
});

/** 合并设备点击：有 ip:port 走本地连接，否则走云端连接 */
function handleMergedDeviceClick(device: Device) {
  if (device.ip && device.port > 0) {
    handleDeviceClick(device);
  } else {
    handleCloudDeviceClick({
      robotId: device.robotId || device.id,
      robotName: device.name,
    });
  }
}

/* ============================================================
 * 设备卡片 tag 显示
 * 按优先级：已绑定 > 已保存 > 在线状态 > 已连接
 * ============================================================ */
type TagVariant = "bound" | "saved" | "local" | "cloud" | "offline" | "connected";
interface DeviceTag {
  key: TagVariant;
  text: string;
  variant: TagVariant;
}

/**
 * storedBindings 存储在 localStorage（非响应式），此处用一个版本号触发响应式刷新。
 * - 跨标签页：监听 window storage 事件
 * - 同标签页：绑定成功后 appStore.connection 会变化，通过 watch 触发刷新
 */
const bindingsVersion = ref(0);
function refreshBindings(): void {
  bindingsVersion.value++;
}
function onStorageBinding(e: StorageEvent): void {
  if (e.key === "wobot_bindings") refreshBindings();
}
onMounted(() => window.addEventListener("storage", onStorageBinding));
onUnmounted(() => window.removeEventListener("storage", onStorageBinding));
watch(() => appStore.connection, () => refreshBindings());

/** 1. 是否已绑定到当前登录用户（cloudDevices 中存在此 robotId） */
function isDeviceBoundToUser(device: Device): boolean {
  const rid = device.robotId || device.id;
  if (!rid) return false;
  return devicesStore.cloudDevices.some((c) => c.robotId === rid);
}

/** 2. 是否已保存到已连接记录（localStorage storedBindings） */
function isDeviceSaved(device: Device): boolean {
  void bindingsVersion.value; // 响应式依赖
  return !!getStoredBinding(device.robotId || "", device.ip, device.port);
}

/** 3. 在线状态 tag：本地在线（优先）/ 云端在线 / 离线 */
function getOnlineStatusTag(device: Device): DeviceTag {
  const isCurrent = isCurrentDevice(device);
  // 当前已连接设备：依据连接模式判定在线类型
  if (isCurrent && appStore.connection === "connected") {
    if (connectionMode.value === "signal") {
      return { key: "cloud", text: "云端在线", variant: "cloud" };
    }
    return { key: "local", text: "本地在线", variant: "local" };
  }
  // 本地在线：mDNS 发现列表中有此设备，或设备有有效 ip:port（已保存设备可能 mDNS 未发现但仍可达）
  const isLocalOnline =
    devicesStore.discovered.some(
      (d) =>
        d.robotId === device.robotId ||
        `${d.ip}:${d.port}` === `${device.ip}:${device.port}`,
    ) || (device.ip && device.port > 0);
  if (isLocalOnline) {
    return { key: "local", text: "本地在线", variant: "local" };
  }
  // 云端在线：信令服务器返回在线
  const rid = device.robotId || device.id;
  const cloudDev = rid ? devicesStore.cloudDevices.find((c) => c.robotId === rid) : undefined;
  if (cloudDev && cloudDev.status === "online") {
    return { key: "cloud", text: "云端在线", variant: "cloud" };
  }
  return { key: "offline", text: "离线", variant: "offline" };
}

/** 4. 是否已连接（当前设备匹配且 connection === "connected"） */
function isDeviceConnected(device: Device): boolean {
  return isCurrentDevice(device) && appStore.connection === "connected";
}

/** 本地/发现设备卡片 tag 列表（按优先级） */
function getDeviceTags(device: Device): DeviceTag[] {
  const tags: DeviceTag[] = [];
  if (isDeviceBoundToUser(device)) tags.push({ key: "bound", text: "已绑定", variant: "bound" });
  if (isDeviceSaved(device)) tags.push({ key: "saved", text: "已保存", variant: "saved" });
  tags.push(getOnlineStatusTag(device));
  if (isDeviceConnected(device)) tags.push({ key: "connected", text: "已连接", variant: "connected" });
  return tags;
}

/** 云端设备卡片 tag 列表 */
function getCloudDeviceTags(device: CloudDevice): DeviceTag[] {
  const tags: DeviceTag[] = [];
  // 云端设备本身就是当前帐号绑定的
  tags.push({ key: "bound", text: "已绑定", variant: "bound" });
  // 是否已保存到已连接记录
  void bindingsVersion.value;
  if (getStoredBinding(device.robotId)) {
    tags.push({ key: "saved", text: "已保存", variant: "saved" });
  }
  // 在线状态
  if (device.status === "online") {
    tags.push({ key: "cloud", text: "云端在线", variant: "cloud" });
  } else {
    tags.push({ key: "offline", text: "离线", variant: "offline" });
  }
  // 已连接：当前设备 robotId 匹配且已连接
  const cd = devicesStore.currentDevice;
  const isConnected =
    !!cd &&
    (cd.robotId === device.robotId || cd.id === device.robotId) &&
    appStore.connection === "connected";
  if (isConnected) tags.push({ key: "connected", text: "已连接", variant: "connected" });
  return tags;
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
    <div class="sidebar-content">
      <div class="device-section">
        <h3 class="section-title">设备列表</h3>
        <div class="device-list">
          <div
            v-for="device in mergedDevices"
            :key="device.id"
            class="device-card"
            :class="{
              active: device.id === currentDeviceKeys.id || `${device.ip}:${device.port}` === currentDeviceKeys.key,
            }"
            @click="handleMergedDeviceClick(device)"
          >
            <div class="device-card-header">
              <span class="device-name">{{ device.name }}</span>
            </div>
            <div class="device-ip">
              <template v-if="device.ip && device.port">{{ device.ip }}:{{ device.port }}</template>
              <template v-else>云端设备</template>
            </div>
            <div class="device-tags">
              <span
                v-for="tag in getDeviceTags(device)"
                :key="tag.key"
                class="dev-tag"
                :class="[`tag-${tag.variant}`, { 'tag-pulse': tag.variant === 'connected' }]"
                >{{ tag.text }}</span
              >
            </div>
          </div>
          <div
            v-if="mergedDevices.length === 0"
            class="empty-state"
            style="padding: 16px; font-size: 12px"
          >
            暂无设备，请扫描发现设备
          </div>
        </div>
      </div>

      <div class="discover-section">
        <div class="section-header">
          <h3 class="section-title">发现设备</h3>
          <button class="rescan-btn" :disabled="appStore.scanning || rescanning" @click="handleRescan">
            {{ appStore.scanning || rescanning ? "扫描中..." : "重新扫描" }}
          </button>
        </div>
        <div v-if="appStore.scanning" class="scan-indicator"><span class="spinner"></span> 扫描中...</div>
        <div class="device-list">
          <div
            v-for="device in devicesStore.discovered"
            :key="device.id"
            class="device-card"
            :class="{
              active: device.id === currentDeviceKeys.id || `${device.ip}:${device.port}` === currentDeviceKeys.key,
            }"
            @click="handleDeviceClick(device)"
          >
            <div class="device-card-header">
              <span class="device-name">{{ device.name }}</span>
            </div>
            <div class="device-ip">{{ device.ip }}:{{ device.port }}</div>
            <div class="device-tags">
              <span
                v-for="tag in getDeviceTags(device)"
                :key="tag.key"
                class="dev-tag"
                :class="[`tag-${tag.variant}`, { 'tag-pulse': tag.variant === 'connected' }]"
                >{{ tag.text }}</span
              >
            </div>
          </div>
          <div
            v-if="!appStore.scanning && devicesStore.discovered.length === 0"
            class="empty-state"
            style="padding: 16px; font-size: 12px"
          >
            暂无发现设备
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-footer">
      <button class="add-device-btn" @click="handleAddDevice">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </svg>
        新增机器人
      </button>
    </div>
  </aside>

  <button
    class="add-device-float-btn"
    :style="{ display: appStore.sidebarCollapsed ? 'flex' : 'none' }"
    title="新增机器人"
    @click="handleAddDevice"
  >
    <svg viewBox="0 0 24 24" width="20" height="20">
      <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  </button>
</template>

<style scoped>
.sidebar {
  width: 260px;
  min-width: 260px;
  flex-shrink: 0;
  height: 100%;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
}
.sidebar.collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
}
.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}
.device-section,
.discover-section,
.cloud-section {
  margin-bottom: 24px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.section-header .section-title {
  margin-bottom: 0;
}
.rescan-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}
.rescan-btn:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.rescan-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.device-card {
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.device-card:hover {
  border-color: var(--accent);
}
.device-card.active {
  border-color: var(--accent);
  background: rgba(0, 212, 255, 0.08);
}
.device-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.device-name {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
}
.device-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.dev-tag {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  font-weight: 600;
  white-space: nowrap;
}
/* 已绑定 / 本地在线：绿色 */
.tag-bound,
.tag-local {
  background: rgba(0, 255, 136, 0.16);
  color: var(--success);
}
/* 已保存 / 云端在线：蓝色 */
.tag-saved,
.tag-cloud {
  background: rgba(0, 212, 255, 0.16);
  color: var(--accent);
}
/* 离线：灰色 */
.tag-offline {
  background: rgba(128, 128, 136, 0.18);
  color: var(--text-muted);
}
/* 已连接：绿色 + 脉冲动画 */
.tag-connected {
  background: rgba(0, 255, 136, 0.22);
  color: var(--success);
  box-shadow: 0 0 0 1px rgba(0, 255, 136, 0.45);
}
.tag-pulse {
  animation: tag-pulse 1.6s ease-in-out infinite;
}
@keyframes tag-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
.cloud-badge {
  font-size: 12px;
  flex-shrink: 0;
}
.cloud-device-card {
  border-style: dashed;
}
.cloud-device-card:hover {
  border-style: solid;
}
.cloud-device-card.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.device-ip {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scan-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  color: var(--text-muted);
  font-size: 12px;
}
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.sidebar-footer {
  padding: 16px;
  border-top: 1px solid var(--border);
}
.add-device-btn {
  width: 100%;
  padding: 10px;
  border: 1px dashed var(--border-light);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
}
.add-device-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.add-device-float-btn {
  position: fixed;
  bottom: 40px;
  left: 20px;
  z-index: 150;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  transition: transform 0.2s;
}
.add-device-float-btn:hover {
  transform: scale(1.1);
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
