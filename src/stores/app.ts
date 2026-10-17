import { defineStore } from "pinia";
import type { ConnectionStatus, ControlMode, Theme, ToggleKey, ViewName } from "../types";

/* ============================================================
 * wo-bot-vue - 应用全局状态 (Pinia Store)
 * ============================================================ */

function getEffectiveTheme(theme: Theme): "dark" | "light" {
  if (theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}

export const useAppStore = defineStore("app", {
  state: () => ({
    /** 连接状态: disconnected | connecting | connected | error */
    connection: "disconnected" as ConnectionStatus,

    /** Mock 模式开关 */
    mockMode: false,

    /** 主题: dark | light | auto */
    theme: "dark" as Theme,

    /** 当前激活视图 */
    currentView: "quickActions" as ViewName,

    /** 侧边栏是否折叠 */
    sidebarCollapsed: false,

    /** 控制模式: manual | semi | auto */
    controlMode: "manual" as ControlMode,

    /** 控制模式的服务端真实状态（含安全降级原因 —— 降级不允许静默，S0） */
    controlModeStatus: {
      degraded: false,
      degradeReason: null as string | null,
      allowSemi: false,
      allowAuto: false,
    },

    /** 可用执行器自检项（来自 actuator_selftest_list） */
    selftestList: [] as Array<Record<string, unknown>>,

    /** 轮子主动自检结果（null=未运行） */
    wheelSelftest: null as null | Record<string, unknown>,

    /** 硬件诊断报告（来自独立诊断子服务，经主服务 WS 转发） */
    diagnostics: null as null | Record<string, unknown>,

    /** 安全底座状态（S1）：触发即停车，且**不会自动恢复** */
    safety: {
      tripped: false,
      reason: null as string | null,
      kind: null as string | null,
    },

    /** 最近一次模式切换被服务端拒绝（S0）。
     *  为什么需要：只弹 toast 会一闪而过，而 <select> 的 DOM 值会停在用户选的项上，
     *  看起来像"点了没反应"。这里留下持久状态用于回弹选择器 + 持续提示。 */
    modeRejection: {
      count: 0,
      message: "",
    },

    /** 里程计位姿（S0）；null = 尚未收到 */
    odometry: null as null | {
      x: number;
      y: number;
      thetaDeg: number;
      v: number;
      calibrated: boolean;
      quality: string;
    },

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
    bottomPanelTab: "cmdLog" as "cmdLog" | "ssh",

    /** 音量 (0-100) */
    volume: 50,

    /** 设备扫描中 */
    scanning: false,

    /** Toast 提示 */
    toast: null as { message: string; type: "success" | "error" | "info"; id: number } | null,

    /** Debug 模式：开启后在浏览器控制台输出调试日志 */
    debugMode: false,
  }),

  getters: {
    connectionClass(): string {
      return this.connection;
    },
    connectionText(): string {
      const map: Record<string, string> = {
        disconnected: "未连接",
        connecting: "连接中...",
        connected: "已连接",
        binding: "绑定中",
        error: "连接错误",
      };
      return map[this.connection] || "未连接";
    },
    isDark(state): boolean {
      return (
        state.theme === "dark" || (state.theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)
      );
    },
  },

  actions: {
    /** Toast 提示（自动 3 秒消失，相同消息去重） */
    showToast(message: string, type: "success" | "error" | "info" = "info") {
      if (this.toast?.message === message && this.toast?.type === type) return;
      const id = Date.now();
      this.toast = { message, type, id };
      if (type === "error") {
        console.error(`[Toast:error] ${message}`);
      }
      setTimeout(() => {
        if (this.toast?.id === id) this.toast = null;
      }, 3000);
    },

    /** Switch current view */
    setView(view: ViewName) {
      this.currentView = view;
    },

    /** Toggle a boolean action (flashlight/mute/eco) */
    toggleAction(key: ToggleKey) {
      this.toggleStates[key] = !this.toggleStates[key];
      this.saveSettings();
    },

    /** Set control mode */
    setControlMode(mode: ControlMode) {
      this.controlMode = mode;
      this.saveSettings();
    },

    /** 更新可用自检项 */
    setSelftestList(list: Array<Record<string, unknown>>) {
      this.selftestList = list;
    },

    /** 记录轮子自检结果 */
    setWheelSelftest(data: Record<string, unknown> | null) {
      this.wheelSelftest = data;
    },

    /** 更新硬件诊断报告 */
    setDiagnostics(data: Record<string, unknown> | null) {
      this.diagnostics = data;
    },

    /** 应用服务端下发的控制模式状态（S0） */
    applyControlModeStatus(data: Record<string, unknown>) {
      if (typeof data.mode === "string") {
        this.controlMode = data.mode as ControlMode;
      }
      this.controlModeStatus.degraded = Boolean(data.degraded);
      this.controlModeStatus.degradeReason = typeof data.degrade_reason === "string" ? data.degrade_reason : null;
      if (data.allow_semi !== undefined) this.controlModeStatus.allowSemi = Boolean(data.allow_semi);
      if (data.allow_auto !== undefined) this.controlModeStatus.allowAuto = Boolean(data.allow_auto);
    },

    /** 更新安全状态（S1）。触发原因必须展示给用户 —— 安全停车不允许静默 */
    applySafetyStatus(data: Record<string, unknown>) {
      if (data.available === false) {
        this.safety = { tripped: false, reason: null, kind: null };
        return;
      }
      const active = (data.active ?? null) as Record<string, unknown> | null;
      this.safety = {
        tripped: Boolean(data.tripped),
        reason: active && typeof active.reason === "string" ? active.reason : null,
        kind: active && typeof active.kind === "string" ? active.kind : null,
      };
    },

    /** 记录模式切换被拒绝（S0） */
    setModeRejection(message: string) {
      this.modeRejection = { count: this.modeRejection.count + 1, message };
    },

    /** 更新里程计位姿（S0） */
    setOdometry(pose: Record<string, unknown> | null) {
      if (!pose) {
        this.odometry = null;
        return;
      }
      this.odometry = {
        x: Number(pose.x ?? 0),
        y: Number(pose.y ?? 0),
        thetaDeg: Number(pose.theta_deg ?? 0),
        v: Number(pose.v ?? 0),
        calibrated: Boolean(pose.calibrated),
        quality: typeof pose.quality === "string" ? pose.quality : "",
      };
    },

    /** Set volume */
    setVolume(v: number) {
      this.volume = Math.max(0, Math.min(100, v));
    },

    /** Set theme */
    setTheme(theme: Theme) {
      this.theme = theme;
      this.applyTheme();
    },

    /** Set bottom panel tab */
    setBottomPanelTab(tab: "cmdLog" | "ssh") {
      this.bottomPanelTab = tab;
    },

    /** Toggle bottom panel expand/collapse */
    toggleBottomPanel() {
      this.bottomPanelExpanded = !this.bottomPanelExpanded;
    },

    /** Set SSH connected state */
    setSSHConnected(val: boolean) {
      this.sshConnected = val;
    },

    /* ---- 持久化 ---- */

    /** 从 localStorage 加载设置 */
    loadSettings(): void {
      try {
        const raw = localStorage.getItem("wobot_debug_settings");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.theme) this.theme = data.theme as Theme;
        if (data.mockMode !== undefined) this.mockMode = Boolean(data.mockMode);
        if (data.sidebarCollapsed !== undefined) this.sidebarCollapsed = Boolean(data.sidebarCollapsed);
        if (data.controlMode) this.controlMode = data.controlMode as ControlMode;
        if (data.keyboardEnabled !== undefined) this.keyboardEnabled = Boolean(data.keyboardEnabled);
        if (data.volume !== undefined) this.volume = Number(data.volume);
        if (data.debugMode !== undefined) this.debugMode = Boolean(data.debugMode);
        if (data.toggleStates) {
          const t = data.toggleStates as Partial<Record<ToggleKey, boolean>>;
          for (const k of ["flashlight", "mute", "eco"] as ToggleKey[]) {
            if (t[k] !== undefined) this.toggleStates[k] = Boolean(t[k]);
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
        debugMode: this.debugMode,
        toggleStates: { ...this.toggleStates },
      };
      localStorage.setItem("wobot_debug_settings", JSON.stringify(payload));
    },

    /* ---- 主题 ---- */

    /** 应用主题到 document */
    applyTheme(): void {
      const effective = getEffectiveTheme(this.theme);
      document.documentElement.setAttribute("data-theme", effective);
      // 同步到 localStorage
      this.saveSettings();
    },

    /** 切换主题（轮转 dark -> light -> auto -> dark） */
    toggleTheme(): void {
      const order: Theme[] = ["dark", "light", "auto"];
      const idx = order.indexOf(this.theme);
      this.theme = order[(idx + 1) % order.length];
      this.applyTheme();
    },
  },
});
