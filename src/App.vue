<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useDevicesStore } from '@/stores/devices'
import { useRobotStore } from '@/stores/robot'
import { useWebSocket, getRemoteFeatures, setOnReconnect } from '@/composables/useWebSocket'
import { useWebRTC } from '@/composables/useWebRTC'
import { useMock } from '@/composables/useMock'
import { useDiscovery } from '@/composables/useDiscovery'

import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import AppFooter from '@/components/AppFooter.vue'
import BottomPanel from '@/components/BottomPanel.vue'
import QuickActionsView from '@/components/views/QuickActionsView.vue'
import LogsView from '@/components/views/LogsView.vue'
import MessagesView from '@/components/views/MessagesView.vue'
import StatusView from '@/components/views/StatusView.vue'
import SoftwareView from '@/components/views/SoftwareView.vue'
import RemoteView from '@/components/views/RemoteView.vue'
import MapView from '@/components/views/MapView.vue'
import GalleryView from '@/components/views/GalleryView.vue'
import SettingsView from '@/components/views/SettingsView.vue'
import AddDeviceDialog from '@/components/dialogs/AddDeviceDialog.vue'
import SwitchDeviceDialog from '@/components/dialogs/SwitchDeviceDialog.vue'
import OpsConfirmDialog from '@/components/dialogs/OpsConfirmDialog.vue'
import ConnectTimeoutDialog from '@/components/dialogs/ConnectTimeoutDialog.vue'
import type { Device, ViewName } from '@/types'

const appStore = useAppStore()
const devicesStore = useDevicesStore()
const robotStore = useRobotStore()
const { connect, disconnect, sendSystemAction } = useWebSocket()
const { establishConnection: establishWebRTC, close: closeWebRTC, webrtcState } = useWebRTC()
const { startMockMode, stopMockMode } = useMock()
const { startScan: startDiscoveryScan } = useDiscovery()

// WebSocket 信令连通后，延迟建立 WebRTC（等待 connected 消息含 features）
let _webrtcTimer: ReturnType<typeof setTimeout> | null = null
function scheduleWebRTC(): void {
  if (_webrtcTimer) clearTimeout(_webrtcTimer)
  _webrtcTimer = setTimeout(() => {
    _webrtcTimer = null
    establishWebRTC()
  }, 800)  // 稍长一点，确保 connected 消息已处理
}

// 注册自动重连时的 WebRTC 握手回调
setOnReconnect(scheduleWebRTC)

// Dialog states
const showAddDevice = ref(false)
const switchTarget = ref<Device | null>(null)
const opsConfirm = ref<{ type: string; title: string; message: string } | null>(null)
const connectTimeout = ref<{ message: string } | null>(null)

// Mock 启动配置：URL ?mock 参数优先，其次 .env VITE_MOCK_DEFAULT
const urlParams = new URLSearchParams(window.location.search)
const shouldMock = urlParams.has('mock') ? urlParams.get('mock') !== '0' : import.meta.env.VITE_MOCK_DEFAULT === 'true'

if (shouldMock) {
  startMockMode()
} else {
  // 非 Mock 模式：延迟 1 秒后自动扫描局域网设备
  setTimeout(() => startDiscoveryScan(), 1000)
}

const connectionTooltip = computed(() => {
  const device = devicesStore.currentDevice
  if (!device) return ''
  return `设备: ${device.name}\nIP: ${device.ip}:${device.port}`
})

// Theme class
watch(() => appStore.theme, () => {
  appStore.applyTheme()
}, { immediate: true })

// Handle sidebar device select
function handleSelectDevice(device: Device) {
  if (!devicesStore.currentDevice) {
    connectDirectly(device)
  } else if (devicesStore.currentDevice.id !== device.id) {
    switchTarget.value = device
  }
}

function connectDirectly(device: Device) {
  devicesStore.setCurrentDevice(device)

  // Mock mode: skip WebSocket, just switch to this device
  if (appStore.mockMode) {
    appStore.connection = 'connected'
    appStore.showToast('已切换到 Mock 模式', 'success')
    return
  }

  appStore.mockMode = false
  stopMockMode()
  try {
    closeWebRTC()  // 先清理旧 WebRTC 状态
    connect(device.ip, device.port)
    // WebSocket 信令连通后，延迟建立 WebRTC（等 connected 含 features）
    scheduleWebRTC()
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    appStore.connection = 'error'
    appStore.showToast(`无法连接到 ${device.name}`, 'error')
    robotStore.addLog('error', '连接', `连接失败: ${device.name} - ${errMsg}`)
    connectTimeout.value = { message: `无法连接到 ${device.name}，请检查设备是否在线。` }
  }
}

function handleSwitchConfirm() {
  if (switchTarget.value) {
    closeWebRTC()
    disconnect()
    connectDirectly(switchTarget.value)
    switchTarget.value = null
  }
}

function handleSwitchCancel() {
  switchTarget.value = null
}

// Handle add device
function handleAddDevice() {
  showAddDevice.value = true
}

function handleAddDeviceConfirm(ip: string, port: number, name: string) {
  showAddDevice.value = false
  const id = `device-${Date.now()}`
  const device: Device = {
    id,
    name: name || ip,
    ip,
    port,
    online: true,
  }
  devicesStore.addDevice(device)
  // Connect to the new device
  if (devicesStore.currentDevice) {
    switchTarget.value = device
  } else {
    connectDirectly(device)
  }
}

function handleAddDeviceCancel() {
  showAddDevice.value = false
}

// Handle ops actions
function handleOpsAction(payload: { type: string }) {
  const actions: Record<string, { title: string; message: string }> = {
    reboot: { title: '确认操作', message: '确定要重启机器人吗？此操作将断开当前连接。' },
    shutdown: { title: '确认操作', message: '确定要关闭机器人吗？' },
    forget: { title: '确认操作', message: '确定要忘记此设备吗？此操作将删除设备的连接记录。' },
  }
  const action = actions[payload.type]
  if (action) {
    opsConfirm.value = { ...action, type: payload.type }
  }
}

function handleOpsConfirm() {
  if (!opsConfirm.value) return
  const type = opsConfirm.value.type
  if (type === 'forget' && devicesStore.currentDevice) {
    robotStore.addLog('info', '设备', `忘记设备: ${devicesStore.currentDevice.name}`)
    devicesStore.removeDevice(devicesStore.currentDevice.id)
    devicesStore.setCurrentDevice(null)
    disconnect()
  }
  if (type === 'reboot') {
    robotStore.addCmdLog({ time: new Date().toLocaleTimeString(), direction: 'send', type: 'reboot', data: '重启指令' })
    robotStore.addLog('info', '设备', '发送重启指令')
    sendSystemAction('reboot')
    disconnect()
  }
  if (type === 'shutdown') {
    robotStore.addCmdLog({ time: new Date().toLocaleTimeString(), direction: 'send', type: 'shutdown', data: '关机指令' })
    robotStore.addLog('info', '设备', '发送关机指令')
    sendSystemAction('shutdown')
    disconnect()
  }
  opsConfirm.value = null
}

function handleOpsCancel() {
  opsConfirm.value = null
}

// Handle connect timeout
function handleRetryConnect() {
  connectTimeout.value = null
  if (devicesStore.currentDevice) {
    connect(devicesStore.currentDevice.ip, devicesStore.currentDevice.port)
  }
}

function handleTimeoutClose() {
  connectTimeout.value = null
}

const viewsMap: Record<ViewName, unknown> = {
  quickActions: QuickActionsView,
  logs: LogsView,
  messages: MessagesView,
  status: StatusView,
  software: SoftwareView,
  remote: RemoteView,
  map: MapView,
  gallery: GalleryView,
  settings: SettingsView,
}
</script>

<template>
  <div id="app">
    <AppHeader @ops-action="handleOpsAction" />
    <div class="main-layout">
      <AppSidebar
        @select-device="handleSelectDevice"
        @add-device="handleAddDevice"
      />
      <main class="main-content">
        <div class="views-container">
          <component :is="viewsMap[appStore.currentView]" />
        </div>
        <BottomPanel />
      </main>
    </div>
    <AppFooter />

    <!-- Dialogs -->
    <AddDeviceDialog
      v-if="showAddDevice"
      @close="handleAddDeviceCancel"
      @confirm="handleAddDeviceConfirm"
    />
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

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="appStore.toast" class="toast" :class="'toast-' + appStore.toast.type">
        {{ appStore.toast.message }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.main-layout { display: flex; flex: 1; min-height: 0; }
.main-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.views-container { flex: 1; min-height: 0; overflow: hidden; padding: 16px; display: flex; flex-direction: column; }

/* Toast */
.toast {
  position: fixed; top: 20px; right: 20px; z-index: 9999;
  padding: 12px 20px; border-radius: var(--radius-md);
  font-size: 14px; color: #fff; pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.toast-success { background: var(--success); }
.toast-error { background: var(--danger); }
.toast-info { background: var(--accent); }

.toast-enter-active { transition: all 0.3s ease-out; }
.toast-leave-active { transition: all 0.25s ease-in; }
.toast-enter-from { opacity: 0; transform: translateY(-12px); }
.toast-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
