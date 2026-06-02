import { defineStore } from 'pinia'
import type { ConnectionStatus, ControlMode, Theme, ToggleKey, ViewName } from '../types'

/* ============================================================
 * wo-bot-vue - 应用全局状态 (Pinia Store)
 * ============================================================ */

function getEffectiveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return theme
}

export const useAppStore = defineStore('app', {
  state: () => ({
    /** 连接状态: disconnected | connecting | connected | error */
    connection: 'disconnected' as ConnectionStatus,

    /** Mock 模式开关 */
    mockMode: false,

    /** 主题: dark | light | auto */
    theme: 'dark' as Theme,

    /** 当前激活视图 */
    currentView: 'quickActions' as ViewName,

    /** 侧边栏是否折叠 */
    sidebarCollapsed: false,

    /** 控制模式: manual | semi | auto */
    controlMode: 'manual' as ControlMode,

    /** 键盘控制是否启用 */
    keyboardEnabled: false,

    /** 实体开关状态 */
    toggleStates: {
      flashlight: false,
      mute: false,
      eco: false,
    } as Record<ToggleKey, boolean>,

    /** SSH 是否已连接 */
    sshConnected: false,

    /** 最近一次 ping 延迟值 (ms) */
    _lastPing: 0,

    /** 底部面板是否展开 */
    bottomPanelExpanded: false,

    /** 底部面板当前标签 */
    bottomPanelTab: 'cmdLog' as 'cmdLog' | 'ssh',

    /** 音量 (0-100) */
    volume: 50,

    /** 设备扫描中 */
    scanning: false,

    /** Toast 提示 */
    toast: null as { message: string; type: 'success' | 'error' | 'info'; id: number } | null,
  }),

  getters: {
    connectionClass(): string {
      return this.connection
    },
    connectionText(): string {
      const map: Record<string, string> = {
        disconnected: '未连接',
        connecting: '连接中...',
        connected: '已连接',
        error: '连接错误',
      }
      return map[this.connection] || '未连接'
    },
    isDark(state): boolean {
      return state.theme === 'dark' || (state.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    },
  },

  actions: {
    /** Toast 提示（自动 3 秒消失） */
    showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
      const id = Date.now()
      this.toast = { message, type, id }
      setTimeout(() => {
        if (this.toast?.id === id) this.toast = null
      }, 3000)
    },

    /** Switch current view */
    setView(view: ViewName) {
      this.currentView = view
    },

    /** Toggle a boolean action (flashlight/mute/eco) */
    toggleAction(key: ToggleKey) {
      this.toggleStates[key] = !this.toggleStates[key]
      this.saveSettings()
    },

    /** Set control mode */
    setControlMode(mode: ControlMode) {
      this.controlMode = mode
      this.saveSettings()
    },

    /** Set volume */
    setVolume(v: number) {
      this.volume = Math.max(0, Math.min(100, v))
    },

    /** Set theme */
    setTheme(theme: Theme) {
      this.theme = theme
      this.applyTheme()
    },

    /** Set bottom panel tab */
    setBottomPanelTab(tab: 'cmdLog' | 'ssh') {
      this.bottomPanelTab = tab
    },

    /** Toggle bottom panel expand/collapse */
    toggleBottomPanel() {
      this.bottomPanelExpanded = !this.bottomPanelExpanded
    },

    /** Set SSH connected state */
    setSSHConnected(val: boolean) {
      this.sshConnected = val
    },

    /* ---- 持久化 ---- */

    /** 从 localStorage 加载设置 */
    loadSettings(): void {
      try {
        const raw = localStorage.getItem('wobot_debug_settings')
        if (!raw) return
        const data = JSON.parse(raw)
        if (data.theme) this.theme = data.theme as Theme
        if (data.mockMode !== undefined) this.mockMode = Boolean(data.mockMode)
        if (data.sidebarCollapsed !== undefined) this.sidebarCollapsed = Boolean(data.sidebarCollapsed)
        if (data.controlMode) this.controlMode = data.controlMode as ControlMode
        if (data.keyboardEnabled !== undefined) this.keyboardEnabled = Boolean(data.keyboardEnabled)
        if (data.volume !== undefined) this.volume = Number(data.volume)
        if (data.toggleStates) {
          const t = data.toggleStates as Partial<Record<ToggleKey, boolean>>
          for (const k of ['flashlight', 'mute', 'eco'] as ToggleKey[]) {
            if (t[k] !== undefined) this.toggleStates[k] = Boolean(t[k])
          }
        }
      } catch {
        // 忽略格式错误
      }
    },

    /** 将设置写入 localStorage */
    saveSettings(): void {
      const payload = {
        theme: this.theme,
        mockMode: this.mockMode,
        sidebarCollapsed: this.sidebarCollapsed,
        controlMode: this.controlMode,
        keyboardEnabled: this.keyboardEnabled,
        volume: this.volume,
        toggleStates: { ...this.toggleStates },
      }
      localStorage.setItem('wobot_debug_settings', JSON.stringify(payload))
    },

    /* ---- 主题 ---- */

    /** 应用主题到 document */
    applyTheme(): void {
      const effective = getEffectiveTheme(this.theme)
      document.documentElement.setAttribute('data-theme', effective)
      // 同步到 localStorage
      this.saveSettings()
    },

    /** 切换主题（轮转 dark -> light -> auto -> dark） */
    toggleTheme(): void {
      const order: Theme[] = ['dark', 'light', 'auto']
      const idx = order.indexOf(this.theme)
      this.theme = order[(idx + 1) % order.length]
      this.applyTheme()
    },
  },
})
