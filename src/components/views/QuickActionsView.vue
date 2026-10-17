<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useAppStore } from "@/stores/app";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket } from "@/composables/useWebSocket";
import type { ToggleKey } from "@/types";

const appStore = useAppStore();
const robotStore = useRobotStore();
const {
  sendDeviceControl,
  sendEmergencyStop,
  sendEmergencyRelease,
  sendMusicCommand,
  sendControlMode,
  sendControlModeGet,
} = useWebSocket();

// 挂载时回读服务端真实状态（S0/S1：模式与安全状态都由服务端托管，不能只信本地 store）
// 硬件诊断：经 WS 推送（本项目约定，不用 REST 轮询）
onMounted(() => {
  sendControlModeGet();
});

// 模式 <select> 的回弹：被服务端拒绝时 store 未变、Vue 不会重新 patch，
// DOM 会停在用户选的项上（看起来像"点了没反应"），必须显式拉回真实模式。
const modeSelect = ref<HTMLSelectElement | null>(null);
watch(
  () => appStore.modeRejection.count,
  () => {
    if (modeSelect.value) modeSelect.value.value = appStore.controlMode;
  },
);

// ---- 寻找设备：二态 + 30s 倒计时 ----
const FIND_DURATION = 30;
const findActive = ref(false);
const findRemaining = ref(FIND_DURATION);
let findTimer: ReturnType<typeof setInterval> | null = null;

function clearFindTimer() {
  if (findTimer) {
    clearInterval(findTimer);
    findTimer = null;
  }
}

function startFindCountdown() {
  clearFindTimer();
  findRemaining.value = FIND_DURATION;
  findTimer = setInterval(() => {
    findRemaining.value -= 1;
    if (findRemaining.value <= 0) {
      // 倒计时结束：服务端会自动停止，前端仅需复位 UI
      clearFindTimer();
      findActive.value = false;
      findRemaining.value = FIND_DURATION;
    }
  }, 1000);
}

function handleFind() {
  if (findActive.value) {
    // 寻找中 → 手动停止
    findActive.value = false;
    clearFindTimer();
    findRemaining.value = FIND_DURATION;
    robotStore.addCmdLog({
      time: textTime(),
      direction: "send",
      type: "find",
      data: "find_device → OFF",
    });
    sendDeviceControl("find_device", false);
  } else {
    // 空闲 → 开始寻找
    findActive.value = true;
    startFindCountdown();
    robotStore.addCmdLog({
      time: textTime(),
      direction: "send",
      type: "find",
      data: "find_device → ON",
    });
    sendDeviceControl("find_device", true);
  }
}

onUnmounted(() => clearFindTimer());

const actionItems: {
  action: ToggleKey | "emergency";
  label: string;
  cssClass: string;
  cmdType: string;
  disabled?: boolean;
  hint?: string;
}[] = [
  {
    action: "find",
    get label() {
      return findActive.value ? `⏹ 停止 ${findRemaining.value}s` : "🔔 寻找设备";
    },
    cssClass: "toggle",
    cmdType: "find",
  },
  // T015 手电：机器人暂无手电硬件，暂缓实现
  {
    action: "flashlight",
    label: "🔦 手电",
    cssClass: "toggle",
    cmdType: "flashlight",
    disabled: true,
    hint: "暂缓：机器人暂无手电硬件（T015）",
  },
  { action: "charge", label: "🔌 去充电", cssClass: "toggle", cmdType: "charge" },
  { action: "mute", label: "🔇 静音", cssClass: "toggle", cmdType: "mute" },
  {
    action: "eco",
    get label() {
      return robotStore.powerPolicy.mode === "eco" ? "⚡ 省电中" : "🔋 省电模式";
    },
    cssClass: "toggle",
    cmdType: "eco",
  },
  { action: "emergency", label: "🛑 急停", cssClass: "danger", cmdType: "emergency" },
];

function textTime() {
  return new Date().toLocaleTimeString();
}

function handleAction(action: string, cmdType: string) {
  // 未实现/暂缓的动作：不发送命令，明确提示
  const item = actionItems.find((i) => i.action === action);
  if (item?.disabled) {
    appStore.showToast(item.hint ?? "该功能暂不可用", "info");
    return;
  }
  // 寻找设备：独立二态 + 倒计时处理
  if (action === "find") {
    handleFind();
    return;
  }
  const isToggle = ["flashlight", "charge", "mute", "eco"].includes(action);
  if (isToggle) {
    const key = action as ToggleKey;
    const next = !appStore.toggleStates[key];
    appStore.toggleStates[key] = next;
    robotStore.addCmdLog({
      time: textTime(),
      direction: "send",
      type: cmdType,
      data: `${action} → ${next ? "ON" : "OFF"}`,
    });
    sendDeviceControl(action, next);
    return;
  }
  if (action === "emergency") {
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "emergency", data: "急停触发" });
    sendEmergencyStop();
    return;
  }
}

function handleControlModeChange(e: Event) {
  const sel = e.target as HTMLSelectElement;
  const target = sel.value as "manual" | "semi" | "auto";
  // 不再弹二次确认：模式切换即时生效，失败时由服务端返回原因并回弹
  sendControlMode(target, true);
  robotStore.addCmdLog({
    time: textTime(),
    direction: "send",
    type: "mode",
    data: `控制模式 → ${target}`,
  });
}

let volTimer: ReturnType<typeof setTimeout> | null = null;

function handleVolumeInput(e: Event) {
  const target = e.target as HTMLInputElement;
  appStore.volume = Number(target.value);
}

function handleVolumeChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const val = Number(target.value);
  appStore.volume = val;
  if (volTimer) clearTimeout(volTimer);
  volTimer = setTimeout(() => {
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "volume", data: `音量 → ${val}%` });
    sendMusicCommand("music_volume", { volume: val });
  }, 300);
}
</script>

<template>
  <div class="view active">
    <h2>快速操作</h2>
    <div class="quick-actions-grid">
      <button
        v-for="item in actionItems"
        :key="item.action"
        class="action-card"
        :disabled="item.disabled"
        :title="item.hint"
        :class="{
          [item.cssClass]: true,
          active:
            item.cssClass === 'toggle' &&
            (item.action === 'find'
              ? findActive
              : item.action === 'eco'
                ? robotStore.powerPolicy.mode === 'eco'
                : (appStore.toggleStates as Record<string, boolean>)[item.action]),
        }"
        @click="handleAction(item.action, item.cmdType)"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="quick-actions-extra">
      <div class="control-mode-card">
        <h4>🎛️ 控制模式</h4>
        <!-- S1：安全停车优先级最高，必须最显眼；解除需用户显式操作（不自动恢复） -->
        <p v-if="appStore.safety.tripped" class="safety-banner">
          🛑 已安全停车：[{{ appStore.safety.kind }}] {{ appStore.safety.reason }}
          <button class="safety-release" @click="sendEmergencyRelease">解除急停</button>
        </p>
        <select ref="modeSelect" :value="appStore.controlMode" @change="handleControlModeChange">
          <option value="manual">手动操控</option>
          <option value="semi">半自动巡航</option>
          <option value="auto">全自动导航</option>
        </select>
        <!-- 安全降级必须显式提示用户，不允许静默（S0） -->
        <p v-if="appStore.controlModeStatus.degraded" class="mode-degraded">
          ⚠️ 已安全降级到手动：{{ appStore.controlModeStatus.degradeReason || "未指明原因" }}
        </p>
        <p v-else-if="!appStore.controlModeStatus.allowSemi && !appStore.controlModeStatus.allowAuto" class="mode-hint">
          自主模式当前被服务端禁用（navigation.mode）
        </p>
        <!-- 被拒绝的原因要持续可见（不能只靠一闪而过的 toast） -->
        <p v-if="appStore.modeRejection.message" class="mode-rejected">
          ⛔ {{ appStore.modeRejection.message }} <br />启用方法：在 config.yaml 把 navigation.mode.allow_semi /
          allow_auto 设为 true 并重启服务
        </p>
        <!-- 里程计位姿（S0）：未标定时只显示航向，不假装知道距离 -->
        <p v-if="appStore.odometry" class="odom-line">
          pose
          <template v-if="appStore.odometry.calibrated">
            x={{ appStore.odometry.x.toFixed(2) }}m y={{ appStore.odometry.y.toFixed(2) }}m
          </template>
          <template v-else>（未标定·仅航向）</template>
          θ={{ appStore.odometry.thetaDeg.toFixed(1) }}° v={{ appStore.odometry.v.toFixed(2) }}m/s
        </p>
      </div>
      <div class="volume-card">
        <h4>🔊 音量</h4>
        <input
          type="range"
          min="0"
          max="100"
          :value="appStore.volume"
          @input="handleVolumeInput"
          @change="handleVolumeChange"
        />
        <span>{{ appStore.volume }}</span
        >%
      </div>
    </div>
    <div class="modules-list">
      <h3>扩展模块</h3>
      <div v-if="robotStore.modules.length === 0" class="empty-state">加载中...</div>
      <div v-for="mod in robotStore.modules" :key="mod.id" class="module-item">
        <div class="module-info">
          <span class="module-name">{{ mod.name }}</span>
          <span class="module-version">v{{ mod.version }}</span>
        </div>
        <span class="module-status-badge" :class="mod.status">{{
          mod.status === "online" ? "运行中" : mod.status === "offline" ? "离线" : "已禁用"
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  display: none;
}
.view.active {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
h2 {
  margin-bottom: 16px;
  font-size: 22px;
}
.quick-actions-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  max-width: 600px;
  margin-bottom: 20px;
}
.action-card {
  padding: 20px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}
.action-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.action-card.toggle:hover,
.action-card.toggle.active {
  border-color: var(--accent);
  background: rgba(0, 212, 255, 0.08);
}
.action-card.danger {
  border-color: var(--danger);
  color: var(--danger);
}
.action-card.danger:hover {
  background: rgba(255, 71, 87, 0.1);
}
.action-card:disabled,
.action-card:disabled:hover {
  opacity: 0.45;
  cursor: not-allowed;
  border-color: var(--border);
  background: var(--bg-card);
  transform: none;
}
.quick-actions-extra {
  display: flex;
  gap: 20px;
  max-width: 600px;
  margin-bottom: 20px;
}
.control-mode-card,
.volume-card {
  flex: 1;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.control-mode-card h4,
.volume-card h4 {
  margin-bottom: 10px;
  font-size: 14px;
}
.control-mode-card select {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  font-size: 14px;
}
/* S1：安全停车横幅 —— 必须显眼，因为机器人已停止响应运动指令 */
.control-mode-card .safety-banner {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgba(229, 72, 77, 0.14);
  border: 1px solid var(--danger, #e5484d);
  color: var(--danger, #e5484d);
  font-size: 12px;
  line-height: 1.5;
}
.control-mode-card .safety-release {
  margin-top: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--danger, #e5484d);
  background: transparent;
  color: var(--danger, #e5484d);
  font-size: 12px;
  cursor: pointer;
}
/* S0：安全降级提示与位姿显示 */
.control-mode-card .mode-degraded {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--danger, #e5484d);
}
.control-mode-card .mode-rejected {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: rgba(229, 72, 77, 0.1);
  border: 1px solid var(--danger, #e5484d);
  color: var(--danger, #e5484d);
  font-size: 12px;
  line-height: 1.5;
}
.control-mode-card .mode-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
.control-mode-card .odom-line {
  margin: 6px 0 0;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-muted);
  white-space: normal;
}
.volume-card {
  display: flex;
  align-items: center;
  gap: 8px;
}
.volume-card input[type="range"] {
  flex: 1;
}
.volume-card span {
  font-weight: 600;
  min-width: 30px;
}
.modules-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.module-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.module-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.module-name {
  font-weight: 600;
  font-size: 13px;
}
.module-version {
  font-size: 11px;
  color: var(--text-muted);
}
.module-status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}
.module-status-badge.online {
  background: rgba(0, 255, 136, 0.2);
  color: var(--success);
}
.module-status-badge.offline {
  background: rgba(255, 71, 87, 0.2);
  color: var(--danger);
}
.module-status-badge.disabled {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
