<script setup lang="ts">
import { ref, computed } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRobotStore } from '@/stores/robot'
import { useWebSocket } from '@/composables/useWebSocket'

const appStore = useAppStore()
const robotStore = useRobotStore()
const { sendDeviceControl, sendEmergencyStop } = useWebSocket()

const actionItems = [
  { action: 'find', label: '🔔 寻找设备', cssClass: 'toggle', cmdType: 'find' },
  { action: 'flashlight', label: '🔦 手电', cssClass: 'toggle', cmdType: 'flashlight' },
  { action: 'charge', label: '🔌 去充电', cssClass: 'toggle', cmdType: 'charge' },
  { action: 'mute', label: '🔇 静音', cssClass: 'toggle', cmdType: 'mute' },
  { action: 'eco', label: '🔋 省电模式', cssClass: 'toggle', cmdType: 'eco' },
  { action: 'emergency', label: '🛑 急停', cssClass: 'danger', cmdType: 'emergency' },
]

function textTime() {
  return new Date().toLocaleTimeString()
}

function handleAction(action: string, cmdType: string) {
  const isToggle = ['find', 'flashlight', 'charge', 'mute', 'eco'].includes(action)
  if (isToggle) {
    const next = !appStore.toggleStates[action]
    appStore.toggleStates[action] = next
    robotStore.addCmdLog({ time: textTime(), direction: 'send', type: cmdType, data: `${action} → ${next ? 'ON' : 'OFF'}` })
    robotStore.addLog('info', 'QuickAction', `${action}: ${next ? '开' : '关'}`)
    sendDeviceControl(action, next)
    return
  }
  if (action === 'emergency') {
    robotStore.addCmdLog({ time: textTime(), direction: 'send', type: 'emergency', data: '急停触发' })
    robotStore.addLog('warn', 'QuickAction', '急停已触发')
    sendEmergencyStop()
    return
  }
}

function handleControlModeChange(e: Event) {
  const target = e.target as HTMLSelectElement
  appStore.controlMode = target.value as 'manual' | 'semi' | 'auto'
  robotStore.addCmdLog({ time: textTime(), direction: 'send', type: 'mode', data: `控制模式 → ${target.value}` })
  robotStore.addLog('info', 'QuickAction', `控制模式切换: ${target.value}`)
  appStore.saveSettings()
}

let volTimer: ReturnType<typeof setTimeout> | null = null

function handleVolumeInput(e: Event) {
  const target = e.target as HTMLInputElement
  appStore.volume = Number(target.value)
}

function handleVolumeChange(e: Event) {
  const target = e.target as HTMLInputElement
  const val = Number(target.value)
  if (volTimer) clearTimeout(volTimer)
  volTimer = setTimeout(() => {
    robotStore.addCmdLog({ time: textTime(), direction: 'send', type: 'volume', data: `音量 → ${val}%` })
    robotStore.addLog('info', 'QuickAction', `音量调节: ${val}%`)
  }, 300)
}

const volumeIcon = computed(() => {
  const v = appStore.volume
  if (v === 0) return '🔇'
  if (v < 50) return '🔉'
  return '🔊'
})
</script>

<template>
  <div class="view active">
    <h2>快速操作</h2>
    <div class="quick-actions-grid">
      <button
        v-for="item in actionItems"
        :key="item.action"
        class="action-card"
        :class="{
          [item.cssClass]: true,
          active: item.cssClass === 'toggle' && appStore.toggleStates[item.action],
        }"
        @click="handleAction(item.action, item.cmdType)"
      >{{ item.label }}</button>
    </div>
    <div class="quick-actions-extra">
      <div class="control-mode-card">
        <h4>🎛️ 控制模式</h4>
        <select :value="appStore.controlMode" @change="handleControlModeChange">
          <option value="manual">手动操控</option>
          <option value="semi">半自动巡航</option>
          <option value="auto">全自动导航</option>
        </select>
      </div>
      <div class="volume-card">
        <h4>🔊 音量</h4>
        <input type="range" min="0" max="100" :value="appStore.volume" @input="handleVolumeInput" @change="handleVolumeChange" />
        <span>{{ appStore.volume }}</span>%
      </div>
    </div>
    <div class="modules-list">
      <h3>扩展模块</h3>
      <div v-if="robotStore.modules.length === 0" class="empty-state">加载中...</div>
      <div
        v-for="mod in robotStore.modules"
        :key="mod.id"
        class="module-item"
      >
        <div class="module-info">
          <span class="module-name">{{ mod.name }}</span>
          <span class="module-version">v{{ mod.version }}</span>
        </div>
        <span
          class="module-status-badge"
          :class="mod.status"
        >{{ mod.status === 'online' ? '运行中' : mod.status === 'offline' ? '离线' : '已禁用' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { display: none; }
.view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
h2 { margin-bottom: 16px; font-size: 22px; }
.quick-actions-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
  max-width: 600px; margin-bottom: 20px;
}
.action-card {
  padding: 20px 16px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-lg); cursor: pointer; transition: all 0.2s;
  font-size: 14px; color: var(--text-primary); display: flex; align-items: center;
  justify-content: center; gap: 8px; text-align: center;
}
.action-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.action-card.toggle:hover, .action-card.toggle.active { border-color: var(--accent); background: rgba(0,212,255,0.08); }
.action-card.danger { border-color: var(--danger); color: var(--danger); }
.action-card.danger:hover { background: rgba(255,71,87,0.1); }
.quick-actions-extra { display: flex; gap: 20px; max-width: 600px; margin-bottom: 20px; }
.control-mode-card, .volume-card {
  flex: 1; padding: 16px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.control-mode-card h4, .volume-card h4 { margin-bottom: 10px; font-size: 14px; }
.control-mode-card select {
  width: 100%; padding: 8px 12px; border-radius: var(--radius-sm);
  background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border);
  font-size: 14px;
}
.volume-card { display: flex; align-items: center; gap: 8px; }
.volume-card input[type="range"] { flex: 1; }
.volume-card span { font-weight: 600; min-width: 30px; }
.modules-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.module-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.module-info { display: flex; flex-direction: column; gap: 2px; }
.module-name { font-weight: 600; font-size: 13px; }
.module-version { font-size: 11px; color: var(--text-muted); }
.module-status-badge { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-sm); }
.module-status-badge.online { background: rgba(0, 255, 136, 0.2); color: var(--success); }
.module-status-badge.offline { background: rgba(255, 71, 87, 0.2); color: var(--danger); }
.module-status-badge.disabled { background: var(--bg-tertiary); color: var(--text-muted); }
.empty-state { text-align: center; padding: 48px; color: var(--text-muted); }
</style>
