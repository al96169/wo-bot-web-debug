<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRobotStore } from '@/stores/robot'
import { useWebSocket } from '@/composables/useWebSocket'

const emit = defineEmits<{ close: [] }>()

const robotStore = useRobotStore()
const { sendWifiScan, sendWifiConnect, sendWifiDisconnect } = useWebSocket()

const scanning = ref(false)
const connecting = ref<string | null>(null)
const showPasswordFor = ref<string | null>(null)
const password = ref('')
const showAddForm = ref(false)
const newSsid = ref('')
const newPassword = ref('')

// 排序：已连接 > 信号强度
const sortedNetworks = computed(() => {
  const list = [...robotStore.wifiScanResult.networks]
  list.sort((a, b) => {
    if (a.connected && !b.connected) return -1
    if (!a.connected && b.connected) return 1
    return b.signal - a.signal
  })
  return list
})

function signalIcon(signal: number): string {
  if (signal >= 80) return '▂▄▆█'
  if (signal >= 60) return '▂▄▆▁'
  if (signal >= 40) return '▂▄▁▁'
  if (signal >= 20) return '▂▁▁▁'
  return '▁▁▁▁'
}

function signalPercent(signal: number): number {
  return Math.min(100, Math.max(0, (signal + 90) * 100 / 70))
}

async function doScan() {
  scanning.value = true
  sendWifiScan()
  // 等待 3 秒后停止动画
  setTimeout(() => { scanning.value = false }, 3000)
}

function handleNetworkClick(network: { ssid: string; security: string; connected: boolean }) {
  if (network.connected) return
  if (network.security !== '--' && network.security !== '') {
    showPasswordFor.value = network.ssid
    password.value = ''
  } else {
    doConnect(network.ssid, '')
  }
}

function doConnect(ssid: string, pwd: string) {
  connecting.value = ssid
  sendWifiConnect(ssid, pwd)
  showPasswordFor.value = null
  password.value = ''
  // 3 秒后重置连接状态
  setTimeout(() => { connecting.value = null }, 5000)
}

function handleDisconnect() {
  const device = robotStore.wifiScanResult.currentDevice
  sendWifiDisconnect(device)
}

function handleAddNetwork() {
  if (!newSsid.value.trim()) return
  doConnect(newSsid.value.trim(), newPassword.value)
  newSsid.value = ''
  newPassword.value = ''
  showAddForm.value = false
}

onMounted(() => {
  doScan()
})
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog wifi-dialog">
      <div class="dialog-header">
        <h3>WiFi 管理</h3>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>

      <!-- 当前连接 -->
      <div class="current-section" v-if="robotStore.wifiScanResult.currentSsid">
        <div class="current-label">当前连接</div>
        <div class="current-info">
          <span class="current-icon">📶</span>
          <span class="current-ssid">{{ robotStore.wifiScanResult.currentSsid }}</span>
          <button class="btn-disconnect" @click="handleDisconnect">断开</button>
        </div>
      </div>

      <!-- 操作栏 -->
      <div class="toolbar">
        <button class="btn-scan" :disabled="scanning" @click="doScan">
          {{ scanning ? '扫描中...' : '重新扫描' }}
        </button>
        <button class="btn-add" @click="showAddForm = !showAddForm">
          {{ showAddForm ? '取消' : '+ 添加网络' }}
        </button>
      </div>

      <!-- 手动添加网络 -->
      <div class="add-form" v-if="showAddForm">
        <input
          type="text"
          v-model="newSsid"
          placeholder="WiFi 名称 (SSID)"
          class="input-wifi"
        />
        <input
          type="password"
          v-model="newPassword"
          placeholder="密码（可选）"
          class="input-wifi"
        />
        <button class="btn-connect" @click="handleAddNetwork">连接</button>
      </div>

      <!-- 网络列表 -->
      <div class="network-list">
        <div
          v-for="net in sortedNetworks"
          :key="net.ssid"
          class="network-item"
          :class="{ connected: net.connected, connecting: connecting === net.ssid }"
          @click="handleNetworkClick(net)"
        >
          <div class="network-left">
            <span class="network-signal">
              <span v-if="net.connected" class="connected-badge">✓</span>
              <span v-else class="signal-bars">{{ signalIcon(net.signal) }}</span>
            </span>
            <div class="network-info">
              <div class="network-ssid">{{ net.ssid }}</div>
              <div class="network-meta">
                <span class="network-strength">{{ signalPercent(net.signal) }}%</span>
                <span v-if="net.security !== '--' && net.security !== ''" class="network-lock">🔒</span>
              </div>
            </div>
          </div>
          <div class="network-right">
            <span v-if="net.connected" class="status-connected">已连接</span>
            <span v-else-if="connecting === net.ssid" class="status-connecting">连接中...</span>
          </div>
        </div>

        <div v-if="sortedNetworks.length === 0 && !scanning" class="empty-list">
          未发现 WiFi 网络，请点击"重新扫描"
        </div>
      </div>

      <!-- 密码输入弹窗 -->
      <div class="password-overlay" v-if="showPasswordFor" @click.self="showPasswordFor = null">
        <div class="password-dialog">
          <h4>连接到 {{ showPasswordFor }}</h4>
          <input
            type="password"
            v-model="password"
            placeholder="输入 WiFi 密码"
            class="input-wifi"
            autofocus
            @keyup.enter="doConnect(showPasswordFor!, password)"
          />
          <div class="password-actions">
            <button class="btn-secondary" @click="showPasswordFor = null">取消</button>
            <button class="btn-primary" @click="doConnect(showPasswordFor!, password)">连接</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.wifi-dialog {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 24px;
  width: 420px; max-height: 80vh; display: flex; flex-direction: column;
}
.dialog-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
}
.dialog-header h3 { font-size: 18px; }
.close-btn {
  width: 28px; height: 28px; border: none; background: transparent;
  color: var(--text-muted); font-size: 22px; cursor: pointer; border-radius: var(--radius-sm);
}
.close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.current-section {
  padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: 12px;
}
.current-label { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
.current-info { display: flex; align-items: center; gap: 8px; }
.current-icon { font-size: 16px; }
.current-ssid { font-weight: 600; flex: 1; }
.btn-disconnect {
  padding: 4px 12px; border: 1px solid var(--danger); color: var(--danger);
  background: transparent; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px;
}
.btn-disconnect:hover { background: rgba(255, 71, 87, 0.1); }

.toolbar {
  display: flex; gap: 8px; margin-bottom: 12px;
}
.btn-scan, .btn-add {
  flex: 1; padding: 8px; border: 1px solid var(--border);
  border-radius: var(--radius-md); cursor: pointer; font-size: 13px; text-align: center;
  background: var(--bg-secondary); color: var(--text-primary);
}
.btn-scan:hover, .btn-add:hover { border-color: var(--accent); color: var(--accent); }
.btn-scan:disabled { opacity: 0.5; cursor: not-allowed; }

.add-form {
  display: flex; gap: 8px; margin-bottom: 12px; padding: 12px;
  background: var(--bg-secondary); border-radius: var(--radius-md);
}
.input-wifi {
  flex: 1; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: var(--radius-md); background: var(--bg-primary); color: var(--text-primary);
  font-size: 13px;
}
.btn-connect {
  padding: 8px 16px; border: none; border-radius: var(--radius-md);
  background: var(--accent); color: var(--bg-primary); cursor: pointer; font-size: 13px;
}

.network-list {
  flex: 1; overflow-y: auto; min-height: 0;
}
.network-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px; border-radius: var(--radius-md); cursor: pointer;
  margin-bottom: 4px; transition: background 0.15s;
}
.network-item:hover { background: var(--bg-hover); }
.network-item.connected { background: rgba(0, 200, 83, 0.1); }
.network-item.connecting { opacity: 0.6; pointer-events: none; }
.network-left { display: flex; align-items: center; gap: 12px; }
.signal-bars { font-size: 20px; letter-spacing: -2px; color: var(--accent); }
.connected-badge { color: var(--success); font-size: 18px; font-weight: 700; }
.network-ssid { font-size: 14px; font-weight: 500; }
.network-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.network-lock { font-size: 10px; }
.status-connected { font-size: 12px; color: var(--success); }
.status-connecting { font-size: 12px; color: var(--accent); }
.empty-list {
  text-align: center; color: var(--text-muted); padding: 32px 0; font-size: 14px;
}

.password-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center; z-index: 1100;
}
.password-dialog {
  background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 24px; width: 320px;
}
.password-dialog h4 { margin-bottom: 12px; font-size: 15px; }
.password-dialog .input-wifi { width: 100%; margin-bottom: 12px; }
.password-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn-secondary {
  padding: 8px 16px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 13px;
}
.btn-primary {
  padding: 8px 16px; border: none; border-radius: var(--radius-md);
  background: var(--accent); color: var(--bg-primary); cursor: pointer; font-size: 13px;
}
</style>
