<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useDevicesStore } from '@/stores/devices'
import { useDiscovery } from '@/composables/useDiscovery'
import type { Device } from '@/types'

const appStore = useAppStore()
const devicesStore = useDevicesStore()
const { startScan } = useDiscovery()

const rescanning = ref(false)

async function handleRescan() {
  rescanning.value = true
  await startScan()
  rescanning.value = false
}

const emit = defineEmits<{
  selectDevice: [device: Device]
  addDevice: []
}>()

function isSameDevice(a: Device, b: Device): boolean {
  return a.id === b.id || (a.ip === b.ip && a.port === b.port)
}

/** 当前设备标识符集合（id + ip:port），用于模板中 O(1) 匹配且保证响应式 */
const currentDeviceKeys = computed(() => {
  const cd = devicesStore.currentDevice
  if (!cd) return { id: '', key: '' }
  return { id: cd.id, key: `${cd.ip}:${cd.port}` }
})

function isCurrentDevice(device: Device): boolean {
  const keys = currentDeviceKeys.value
  return device.id === keys.id || `${device.ip}:${device.port}` === keys.key
}

function handleDeviceClick(device: Device) {
  console.log('[Sidebar] 点击设备:', { name: device.name, ip: device.ip, port: device.port, hasCurrentDevice: !!devicesStore.currentDevice, isSame: devicesStore.currentDevice ? isSameDevice(devicesStore.currentDevice, device) : 'N/A', connection: appStore.connection })
  if (!devicesStore.currentDevice) {
    console.log('[Sidebar] 无当前设备, 发起连接')
    emit('selectDevice', device)
  } else if (!isSameDevice(devicesStore.currentDevice, device)) {
    console.log('[Sidebar] 不同设备, 发起切换')
    emit('selectDevice', device)
  } else if (appStore.connection === 'connected') {
    console.log('[Sidebar] 同一设备已连接, 显示 Toast')
    appStore.showToast('当前设备已连接', 'info')
  } else if (appStore.connection === 'connecting') {
    console.log('[Sidebar] 同一设备连接中, 显示 Toast')
    appStore.showToast('正在连接中...', 'info')
  } else {
    console.log('[Sidebar] 同一设备, 连接状态:', appStore.connection, '-> 重新连接')
    emit('selectDevice', device)
  }
}

function handleAddDevice() {
  emit('addDevice')
}

/** 统一设备状态：当前设备跟随 appStore.connection，其他设备跟随 device.online */
function getDeviceStatus(device: Device): { text: string; cls: string } {
  const isCurrent = isCurrentDevice(device)
  if (isCurrent) {
    if (appStore.connection === 'connected') return { text: '● 已连接', cls: '' }
    if (appStore.connection === 'connecting') return { text: '● 连接中...', cls: '' }
    if (appStore.connection === 'error') return { text: '● 连接错误', cls: 'offline' }
  }
  return device.online ? { text: '● 在线', cls: '' } : { text: '● 离线', cls: 'offline' }
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: appStore.sidebarCollapsed }">
    <div class="sidebar-content">
      <div class="device-section">
        <h3 class="section-title">设备列表</h3>
        <div class="device-list">
          <div
            v-for="device in devicesStore.devices"
            :key="device.id"
            class="device-card"
            :class="{ active: device.id === currentDeviceKeys.id || `${device.ip}:${device.port}` === currentDeviceKeys.key }"
            @click="handleDeviceClick(device)"
          >
            <div class="device-card-header">
              <span class="device-name">{{ device.name }}</span>
              <span class="device-badge" v-if="device.id === currentDeviceKeys.id || `${device.ip}:${device.port}` === currentDeviceKeys.key">当前设备</span>
            </div>
            <div class="device-ip">{{ device.ip }}:{{ device.port }}</div>
            <div class="device-status-line" :class="getDeviceStatus(device).cls">
              {{ getDeviceStatus(device).text }}
            </div>
          </div>
        </div>
      </div>
      <div class="discover-section">
        <div class="section-header">
          <h3 class="section-title">发现设备</h3>
          <button class="rescan-btn" :disabled="appStore.scanning || rescanning" @click="handleRescan">
            {{ appStore.scanning || rescanning ? '扫描中...' : '重新扫描' }}
          </button>
        </div>
        <div v-if="appStore.scanning" class="scan-indicator">
          <span class="spinner"></span> 扫描中...
        </div>
        <div class="device-list">
          <div
            v-for="device in devicesStore.discovered"
            :key="device.id"
            class="device-card"
            :class="{ active: device.id === currentDeviceKeys.id || `${device.ip}:${device.port}` === currentDeviceKeys.key }"
            @click="handleDeviceClick(device)"
          >
            <div class="device-card-header">
              <span class="device-name">{{ device.name }}</span>
              <span class="device-badge" v-if="device.id === currentDeviceKeys.id || `${device.ip}:${device.port}` === currentDeviceKeys.key">当前设备</span>
            </div>
            <div class="device-ip">{{ device.ip }}:{{ device.port }}</div>
            <div class="device-status-line" :class="getDeviceStatus(device).cls">
              {{ getDeviceStatus(device).text }}
            </div>
          </div>
          <div v-if="!appStore.scanning && devicesStore.discovered.length === 0" class="empty-state" style="padding: 16px; font-size:12px;">
            暂无发现设备
          </div>
        </div>
      </div>
    </div>
    <div class="sidebar-footer">
      <button class="add-device-btn" @click="handleAddDevice">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
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
    <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
  </button>
</template>

<style scoped>
.sidebar {
  width: 260px; min-width: 260px; flex-shrink: 0; height: 100%;
  background: var(--bg-secondary); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; transition: width 0.2s;
}
.sidebar.collapsed { width: 0; min-width: 0; overflow: hidden; padding: 0; }
.sidebar-content { flex: 1; overflow-y: auto; padding: 16px; }
.section-title {
  font-size: 11px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;
}
.device-section, .discover-section { margin-bottom: 24px; }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.section-header .section-title { margin-bottom: 0; }
.rescan-btn {
  font-size: 11px; padding: 2px 8px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-tertiary);
  color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.rescan-btn:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
.rescan-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.device-card {
  padding: 12px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-md); margin-bottom: 8px; cursor: pointer; transition: all 0.15s;
}
.device-card:hover { border-color: var(--accent); }
.device-card.active { border-color: var(--accent); background: rgba(0, 212, 255, 0.08); }
.device-card-header { display: flex; justify-content: space-between; align-items: center; }
.device-name { font-weight: 600; font-size: 13px; }
.device-badge {
  font-size: 10px; padding: 1px 6px; border-radius: var(--radius-sm);
  background: rgba(0, 212, 255, 0.2); color: var(--accent);
}
.device-ip { font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 2px; }
.device-status-line { font-size: 11px; margin-top: 4px; color: var(--success); }
.device-status-line.offline { color: var(--danger); }
.scan-indicator {
  display: flex; align-items: center; gap: 8px;
  padding: 8px; color: var(--text-muted); font-size: 12px;
}
.spinner {
  width: 14px; height: 14px; border: 2px solid var(--border);
  border-top-color: var(--accent); border-radius: 50%;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.sidebar-footer { padding: 16px; border-top: 1px solid var(--border); }
.add-device-btn {
  width: 100%; padding: 10px; border: 1px dashed var(--border-light); border-radius: var(--radius-md);
  background: transparent; color: var(--text-secondary); font-size: 13px;
  display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
}
.add-device-btn:hover { border-color: var(--accent); color: var(--accent); }
.add-device-float-btn {
  position: fixed; bottom: 40px; left: 20px; z-index: 150;
  width: 48px; height: 48px; border-radius: 50%; border: none;
  background: var(--accent); color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  transition: transform 0.2s;
}
.add-device-float-btn:hover { transform: scale(1.1); }
.empty-state { text-align: center; padding: 48px; color: var(--text-muted); }
</style>
