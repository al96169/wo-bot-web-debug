<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useRoute } from "vue-router";
import { useAuth } from "@/composables/useAuth";
import { useAppStore } from "@/stores/app";
import { useDevicesStore } from "@/stores/devices";
import { useRobotStore } from "@/stores/robot";
import {
  useWebSocket,
  getRemoteFeatures,
  setOnVersionMismatch,
  setOnReconnect,
  setOnAuthRequired,
  authRequired,
  setPendingShareCode,
  getStoredBinding,
} from "@/composables/useWebSocket";
import { useWebRTC } from "@/composables/useWebRTC";
import { useMock } from "@/composables/useMock";
import { useDiscovery } from "@/composables/useDiscovery";

import AppHeader from "@/components/AppHeader.vue";
import AppSidebar from "@/components/AppSidebar.vue";
import AppFooter from "@/components/AppFooter.vue";
import BottomPanel from "@/components/BottomPanel.vue";
import QuickActionsView from "@/components/views/QuickActionsView.vue";
import LogsView from "@/components/views/LogsView.vue";
import MessagesView from "@/components/views/MessagesView.vue";
import StatusView from "@/components/views/StatusView.vue";
import SoftwareView from "@/components/views/SoftwareView.vue";
import RemoteView from "@/components/views/RemoteView.vue";
import DanceView from "@/components/views/DanceView.vue";
import MapView from "@/components/views/MapView.vue";
import GalleryView from "@/components/views/GalleryView.vue";
import SettingsView from "@/components/views/SettingsView.vue";
import ProcessManagerView from "@/components/views/ProcessManagerView.vue";
import MusicView from "@/components/views/MusicView.vue";
import ConfigView from "@/components/views/ConfigView.vue";
import BindView from "@/components/views/BindView.vue";
import type { Device, ViewName, AuthRequiredData } from "@/types";
import AddDeviceDialog from "@/components/dialogs/AddDeviceDialog.vue";
import SwitchDeviceDialog from "@/components/dialogs/SwitchDeviceDialog.vue";
import OpsConfirmDialog from "@/components/dialogs/OpsConfirmDialog.vue";
import ConnectTimeoutDialog from "@/components/dialogs/ConnectTimeoutDialog.vue";
import VersionMismatchDialog from "@/components/dialogs/VersionMismatchDialog.vue";

const appStore = useAppStore();
const devicesStore = useDevicesStore();
const { isAuthenticated } = useAuth();
const robotStore = useRobotStore();
const route = useRoute();

// 判断当前是否为路由页面（auth/callback, cloud/*）
const isRoutePage = computed(() =>
  route.path.startsWith("/auth/") || route.path.startsWith("/cloud/")
);
const { connect, disconnect, sendSystemAction } = useWebSocket();
const { establishConnection: establishWebRTC, close: closeWebRTC, webrtcState } = useWebRTC();
const { startMockMode, stopMockMode } = useMock();
const { startScan: startDiscoveryScan } = useDiscovery();

// auth_required 数据（收到 auth_required 消息时填充）
const authRequiredData = ref<AuthRequiredData | null>(null);

// 注册 auth_required 回调
setOnAuthRequired((data: AuthRequiredData) => {
  authRequiredData.value = data;
});

// WebSocket "connected" 消息到达后立即建立 WebRTC
let _webrtcTimer: ReturnType<typeof setTimeout> | null = null;
let _webrtcEstablishing = false;

function scheduleWebRTC(): void {
  if (_webrtcTimer) clearTimeout(_webrtcTimer);
  _webrtcTimer = setTimeout(() => {
    _webrtcTimer = null;
    if (_webrtcEstablishing) return;

    const features = getRemoteFeatures();
    // 如果 features 尚未就绪（connected 消息还没到），延迟再试（最多 10 次）
    if (features.length === 0) {
      _scheduleRetries = (_scheduleRetries || 0) + 1;
      if (_scheduleRetries < 20) {
        console.log("[App] scheduleWebRTC: features 为空，500ms 后重试");
        scheduleWebRTC();
        return;
      }
      console.warn("[App] scheduleWebRTC: features 始终为空，放弃建立 WebRTC");
      appStore.showToast("WebRTC 无法建立：未收到服务端 capabilities", "error");
      return;
    }
    _scheduleRetries = 0;
    _webrtcEstablishing = true;
    console.log("[App] scheduleWebRTC firing, features:", features);
    // 启动超时检测
    const failTimer = setTimeout(() => {
      if (webrtcState.value === "connecting") {
        console.warn("[App] WebRTC 建立超时 (15s)");
        appStore.showToast("WebRTC 连接未建立，摄像头/云台可能不可用", "error");
      }
    }, 15000);
    const stopWatch = watch(webrtcState, (state) => {
      if (state === "connected" || state === "failed" || state === "idle") {
        clearTimeout(failTimer);
        stopWatch();
        if (state === "failed") {
          appStore.showToast("WebRTC 连接失败，摄像头/云台不可用", "error");
        }
      }
    });
    establishWebRTC().finally(() => {
      _webrtcEstablishing = false;
    });
  }, 500);
}

let _scheduleRetries = 0;

// Dialog states
const showAddDevice = ref(false);
const switchTarget = ref<Device | null>(null);
const opsConfirm = ref<{ type: string; title: string; message: string } | null>(null);
const connectTimeout = ref<{ message: string } | null>(null);
const showVersionMismatch = ref(false);

// 注册版本不匹配回调
setOnVersionMismatch(() => {
  showVersionMismatch.value = true;
});

// 注册 WebSocket 连接成功回调：收到 "connected" 消息后立即建立 WebRTC
// 此时 _remoteFeatures 已由 connected handler 填充，可直接使用
setOnReconnect(() => {
  console.log("[App] onReconnect: connected 消息到达, 直接建立 WebRTC");
  _scheduleRetries = 0; // 重置 retry 计数
  // 取消 connectDirectly 中的冗余调度
  if (_webrtcTimer) {
    clearTimeout(_webrtcTimer);
    _webrtcTimer = null;
  }
  if (_webrtcEstablishing) {
    console.log("[App] onReconnect: WebRTC 已在建立中，跳过");
    return;
  }
  _webrtcEstablishing = true;
  // 启动 WebRTC 建立超时检测：15 秒内未 connected 则弹窗提示
  const failTimer = setTimeout(() => {
    if (webrtcState.value === "connecting") {
      console.warn("[App] WebRTC 建立超时 (15s), 当前状态:", webrtcState.value);
      appStore.showToast("WebRTC 连接未建立，摄像头/云台可能不可用，请尝试断开后重连", "error");
    }
  }, 15000);
  establishWebRTC().finally(() => {
    _webrtcEstablishing = false;
  });
  // connected/idle/failed 后清除超时 timer
  const stopWatch = watch(webrtcState, (state) => {
    if (state === "connected" || state === "failed" || state === "idle") {
      clearTimeout(failTimer);
      stopWatch();
      if (state === "failed") {
        appStore.showToast("WebRTC 连接失败，摄像头/云台不可用", "error");
      }
    }
  });
});

// 加载持久化设置和设备列表
appStore.loadSettings();
devicesStore.loadDevices();

// 登录状态变化时自动加载/清空云端设备
watch(
  isAuthenticated,
  (authed) => {
    if (authed) {
      devicesStore.loadCloudDevices();
    } else {
      devicesStore.clearCloudDevices();
    }
  },
  { immediate: true },
);

// Mock 启动配置：URL ?mock 参数优先，其次 .env VITE_MOCK_DEFAULT
const urlParams = new URLSearchParams(window.location.search);
const shouldMock = urlParams.has("mock") ? urlParams.get("mock") !== "0" : import.meta.env.VITE_MOCK_DEFAULT === "true";

// 分享码自动连接：URL 带 robotIp + robotPort + shareCode 时自动连接并绑定
const shareRobotIp = urlParams.get("robotIp") || "";
const shareRobotPort = parseInt(urlParams.get("robotPort") || "0", 10);
const shareCode = urlParams.get("shareCode") || "";
const shareRobotId = urlParams.get("robotId") || "";

if (shareRobotIp && shareRobotPort && shareCode) {
  // 清理 URL 中的敏感参数，避免刷新时重复使用
  urlParams.delete("robotIp");
  urlParams.delete("robotPort");
  urlParams.delete("shareCode");
  urlParams.delete("robotId");
  const cleanQuery = urlParams.toString();
  const cleanUrl = window.location.pathname + (cleanQuery ? `?${cleanQuery}` : "");
  window.history.replaceState({}, "", cleanUrl);
  // 延迟处理（等待 stores 初始化）
  setTimeout(() => {
    // 优先用 robotId 匹配，其次用 IP:port 匹配
    const existingDevice = devicesStore.devices.find(
      (d) => (shareRobotId && d.id === shareRobotId) || (d.ip === shareRobotIp && d.port === shareRobotPort),
    );
    if (existingDevice) {
      // 设备已存在，检查是否已绑定
      const binding = getStoredBinding(shareRobotId || existingDevice.id, shareRobotIp, shareRobotPort);
      if (binding) {
        // 已绑定：无需使用分享码，直接连接
        appStore.showToast("该设备已绑定，无需重复绑定", "info");
        console.log("[App] 分享链接：设备已存在且已绑定，直接连接");
        connectDirectly(existingDevice);
        return;
      }
      // 未绑定：复用已有设备，使用分享码绑定
      setPendingShareCode(shareCode);
      console.log("[App] 分享链接：设备已存在但未绑定，使用分享码绑定");
      connectDirectly(existingDevice);
      return;
    }
    // 设备不存在：创建新设备，连接后由后端 robot_id 覆盖本地临时 ID
    setPendingShareCode(shareCode);
    const newDevice = devicesStore.addDevice({
      name: `机器人 ${shareRobotIp}`,
      ip: shareRobotIp,
      port: shareRobotPort,
    });
    console.log("[App] 分享链接：新设备，使用分享码连接:", shareRobotIp, shareRobotPort);
    connectDirectly(newDevice);
  }, 500);
} else if (shouldMock) {
  startMockMode();
} else {
  // 非 Mock 模式：延迟 1 秒后自动扫描局域网设备
  setTimeout(() => startDiscoveryScan(), 1000);
}

// Theme class
watch(
  () => appStore.theme,
  () => {
    appStore.applyTheme();
  },
  { immediate: true },
);

// Handle sidebar device select
function handleSelectDevice(device: Device) {
  const sameDevice = (a: Device, b: Device) => a.id === b.id || (a.ip === b.ip && a.port === b.port);
  let cd = devicesStore.currentDevice;

  // 核心修复：已点击设备匹配 currentDevice（ip:port 相同），自动同步 id
  if (cd && sameDevice(cd, device) && cd.id !== device.id) {
    console.log("[App] currentDevice ID 不匹配，自动同步:", cd.id, "->", device.id);
    devicesStore.setCurrentDevice(device);
    // 重新获取最新的 currentDevice 引用，确保后续判断准确
    cd = devicesStore.currentDevice;
  }

  console.log("[App] handleSelectDevice:", {
    name: device.name,
    ip: device.ip,
    port: device.port,
    hasCurrentDevice: !!cd,
    isSame: cd ? sameDevice(cd, device) : "N/A",
    connection: appStore.connection,
  });
  if (!cd) {
    console.log("[App] 无当前设备 -> connectDirectly");
    connectDirectly(device);
  } else if (!sameDevice(cd, device)) {
    console.log("[App] 不同设备 -> 弹出切换确认");
    switchTarget.value = device;
  } else if (appStore.connection === "connected") {
    console.log("[App] 同一设备已连接, 显示 Toast");
    appStore.showToast("已连接该设备", "info");
  } else if (appStore.connection === "connecting") {
    console.log("[App] 同一设备连接中, 显示 Toast");
    appStore.showToast("正在连接中...", "info");
  } else {
    console.log("[App] 同一设备, 连接状态:", appStore.connection, "-> 重新连接");
    connectDirectly(device);
  }
}

function connectDirectly(device: Device) {
  console.log("[App] connectDirectly:", {
    name: device.name,
    ip: device.ip,
    port: device.port,
    mockMode: appStore.mockMode,
  });

  // 如果设备来自发现列表，先将其移到已保存设备列表，然后用新设备作为 currentDevice
  const discoveredIdx = devicesStore.discovered.findIndex(
    (d) => d.ip === device.ip && d.port === device.port && d.id === device.id,
  );
  let targetDevice = device;
  if (discoveredIdx !== -1) {
    console.log("[App] 将发现设备移到已保存列表:", device.name);
    const newDevice = devicesStore.importDiscovered(device.id);
    if (newDevice) {
      targetDevice = newDevice;
    }
  }
  devicesStore.setCurrentDevice(targetDevice);

  // Mock mode: skip WebSocket, just switch to this device
  if (appStore.mockMode) {
    console.log("[App] Mock 模式, 跳过 WebSocket");
    appStore.connection = "connected";
    appStore.showToast("已切换到 Mock 模式", "success");
    return;
  }

  // 确保关闭 Mock 模式
  stopMockMode();
  appStore.mockMode = false;
  try {
    console.log("[App] 清理 WebRTC, 发起 WebSocket 连接");
    closeWebRTC(); // 先清理旧 WebRTC 状态
    _scheduleRetries = 0; // 重置重试计数器
    connect(device.ip, device.port);
    // scheduleWebRTC 由 _onReconnect 在收到 connected 消息后调度
    // 此处也调度作为保险（setTimeout 确保 _remoteFeatures 已填充）
    scheduleWebRTC();
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("[App] connectDirectly 异常:", errMsg);
    appStore.connection = "error";
    appStore.showToast(`无法连接到 ${device.name}`, "error");
    connectTimeout.value = { message: `无法连接到 ${device.name}，请检查设备是否在线。` };
  }
}

function handleSwitchConfirm() {
  if (switchTarget.value) {
    closeWebRTC();
    disconnect();
    connectDirectly(switchTarget.value);
    switchTarget.value = null;
  }
}

function handleSwitchCancel() {
  switchTarget.value = null;
}

// Handle add device
function handleAddDevice() {
  showAddDevice.value = true;
}

function handleAddDeviceConfirm(ip: string, port: number, name: string) {
  showAddDevice.value = false;
  const id = `device-${Date.now()}`;
  const device: Device = {
    id,
    name: name || ip,
    ip,
    port,
    online: true,
  };
  devicesStore.addDevice(device);
  // Connect to the new device
  if (devicesStore.currentDevice) {
    switchTarget.value = device;
  } else {
    connectDirectly(device);
  }
}

function handleAddDeviceCancel() {
  showAddDevice.value = false;
}

// Handle ops actions
function handleOpsAction(payload: { type: string }) {
  const actions: Record<string, { title: string; message: string }> = {
    reboot: { title: "确认操作", message: "确定要重启机器人吗？此操作将断开当前连接。" },
    shutdown: { title: "确认操作", message: "确定要关闭机器人吗？" },
    forget: { title: "确认操作", message: "确定要忘记此设备吗？此操作将删除设备的连接记录。" },
    restart_service: { title: "确认操作", message: "确定要重启主服务吗？此操作将断开当前连接。" },
  };
  const action = actions[payload.type];
  if (action) {
    opsConfirm.value = { ...action, type: payload.type };
    return;
  }
  // 断开连接无需确认
  if (payload.type === "disconnect") {
    handleDisconnect();
  }
}

function handleDisconnect() {
  console.log("[App] 主动断开连接");
  closeWebRTC();
  disconnect();
  devicesStore.setCurrentDevice(null);
  appStore.connection = "disconnected";
  appStore.setSSHConnected(false);
  appStore.showToast("连接已断开", "info");
}

function handleOpsConfirm() {
  if (!opsConfirm.value) return;
  const type = opsConfirm.value.type;
  if (type === "forget" && devicesStore.currentDevice) {
    devicesStore.removeDevice(devicesStore.currentDevice.id);
    devicesStore.setCurrentDevice(null);
    disconnect();
  }
  if (type === "reboot") {
    robotStore.addCmdLog({
      time: new Date().toLocaleTimeString(),
      direction: "send",
      type: "reboot",
      data: "重启指令",
    });
    sendSystemAction("reboot");
    disconnect();
  }
  if (type === "shutdown") {
    robotStore.addCmdLog({
      time: new Date().toLocaleTimeString(),
      direction: "send",
      type: "shutdown",
      data: "关机指令",
    });
    sendSystemAction("shutdown");
    disconnect();
  }
  if (type === "restart_service") {
    robotStore.addCmdLog({
      time: new Date().toLocaleTimeString(),
      direction: "send",
      type: "restart_service",
      data: "重启主服务",
    });
    sendSystemAction("restart_service");
    disconnect();
  }
  opsConfirm.value = null;
}

function handleOpsCancel() {
  opsConfirm.value = null;
}

// Handle connect timeout
function handleRetryConnect() {
  connectTimeout.value = null;
  if (devicesStore.currentDevice) {
    connect(devicesStore.currentDevice.ip, devicesStore.currentDevice.port);
  }
}

function handleTimeoutClose() {
  connectTimeout.value = null;
}

// 关闭绑定浮窗 = 断开连接
function closeBindPanel() {
  disconnect();
  authRequired.value = false;
  authRequiredData.value = null;
}

const viewsMap: Record<ViewName, unknown> = {
  quickActions: QuickActionsView,
  logs: LogsView,
  messages: MessagesView,
  status: StatusView,
  software: SoftwareView,
  remote: RemoteView,
  dance: DanceView,
  map: MapView,
  gallery: GalleryView,
  settings: SettingsView,
  processManager: ProcessManagerView,
  music: MusicView,
  config: ConfigView,
};
</script>

<template>
  <div id="app">
    <AppHeader @ops-action="handleOpsAction" />
    <div class="main-layout">
      <AppSidebar @select-device="handleSelectDevice" @add-device="handleAddDevice" />
      <main class="main-content">
        <div class="views-container">
          <!-- 路由页面（auth/callback, cloud/*） -->
          <router-view v-if="isRoutePage" />
          <!-- 绑定认证浮窗（覆盖层） -->
          <div v-else-if="authRequired" class="bind-overlay">
            <div class="bind-modal">
              <button class="bind-close-btn" title="关闭并断开连接" @click="closeBindPanel">×</button>
              <BindView :auth-data="authRequiredData" />
            </div>
          </div>
          <!-- 未连接 -->
          <div v-if="!isRoutePage && appStore.connection !== 'connected' && !authRequired" class="empty-state">
            <div class="empty-state-icon">🔌</div>
            <div class="empty-state-text">请连接机器人</div>
          </div>
          <!-- 正常视图 -->
          <KeepAlive v-if="!isRoutePage && appStore.connection === 'connected' && !authRequired">
            <component :is="viewsMap[appStore.currentView]" />
          </KeepAlive>
        </div>
        <BottomPanel />
      </main>
    </div>
    <AppFooter />

    <!-- Dialogs -->
    <AddDeviceDialog v-if="showAddDevice" @close="handleAddDeviceCancel" @confirm="handleAddDeviceConfirm" />
    <SwitchDeviceDialog
      v-if="switchTarget"
      :device-name="switchTarget.name"
      @close="handleSwitchCancel"
      @confirm="handleSwitchConfirm"
    />
    <OpsConfirmDialog
      v-if="opsConfirm"
      :title="opsConfirm.title"
      :message="opsConfirm.message"
      @close="handleOpsCancel"
      @confirm="handleOpsConfirm"
    />
    <ConnectTimeoutDialog
      v-if="connectTimeout"
      :message="connectTimeout.message"
      @close="handleTimeoutClose"
      @retry="handleRetryConnect"
    />
    <VersionMismatchDialog v-if="showVersionMismatch" @close="showVersionMismatch = false" />

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="appStore.toast" class="toast" :class="'toast-' + appStore.toast.type">
        {{ appStore.toast.message }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}
.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.views-container {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
}

/* 绑定浮窗 */
.bind-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.bind-modal {
  position: relative;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.bind-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border: none;
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: 50%;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: background 0.2s;
}

.bind-close-btn:hover {
  background: var(--bg-hover);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 12px;
}
.empty-state-icon {
  font-size: 48px;
  opacity: 0.4;
}
.empty-state-text {
  font-size: 16px;
  font-weight: 500;
}

/* Toast */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  padding: 12px 20px;
  border-radius: var(--radius-md);
  font-size: 14px;
  color: #fff;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}
.toast-success {
  background: var(--success);
}
.toast-error {
  background: var(--danger);
}
.toast-info {
  background: var(--accent);
}

.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.25s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
