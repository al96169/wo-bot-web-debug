<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket } from "@/composables/useWebSocket";

const robotStore = useRobotStore();
const { send, sendWs, connectedIp } = useWebSocket();

const activeTab = ref<string>("system");
const thresholdValue = ref<number>(robotStore.powerPolicy.threshold);
const isSaving = ref(false);
const saveResult = ref<string>("");
const simulateBatteryLevel = ref<number>(25);
const isSimulating = ref(false);
let _simulateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  // 从 store 同步模拟状态（其他客户端设置的模拟）
  const sim = (robotStore.powerPolicy as any).simulated_battery;
  if (sim != null) {
    isSimulating.value = true;
    simulateBatteryLevel.value = sim;
  }
});

// 模拟中拖动滑块时自动更新（300ms 防抖）
watch(simulateBatteryLevel, (val) => {
  if (!isSimulating.value) return;
  if (_simulateDebounceTimer) clearTimeout(_simulateDebounceTimer);
  _simulateDebounceTimer = setTimeout(() => {
    sendSimulateBattery(val);
  }, 300);
});

const tabs = [
  { id: "system", label: "🖥️ 系统配置" },
];

function textTime() {
  return new Date().toLocaleTimeString();
}

watch(
  () => robotStore.powerPolicy.threshold,
  (val) => {
    thresholdValue.value = val;
  },
);

function sendPowerPolicyConfig(action: "get" | "set", threshold?: number) {
  send({ type: "power_policy_config", data: { action, threshold } });
}

function sendSimulateBattery(level: number | null) {
  sendWs({ type: "power_policy_simulate", data: { level } });
  robotStore.addCmdLog({
    time: textTime(),
    direction: "send",
    type: "config",
    data: level !== null ? `模拟电量 → ${level}%` : "恢复真实电量",
  });
}

function handleSimulate() {
  isSimulating.value = true;
  sendSimulateBattery(simulateBatteryLevel.value);
}

function handleClearSimulation() {
  isSimulating.value = false;
  sendSimulateBattery(null);
}

async function handleSaveThreshold() {
  isSaving.value = true;
  saveResult.value = "";

  sendPowerPolicyConfig("set", thresholdValue.value);
  robotStore.addCmdLog({
    time: textTime(),
    direction: "send",
    type: "config",
    data: `省电阀值 → ${thresholdValue.value}%`,
  });

  setTimeout(() => {
    isSaving.value = false;
    saveResult.value = "已保存";
    setTimeout(() => {
      saveResult.value = "";
    }, 2000);
  }, 300);
}
</script>

<template>
  <div class="view active">
    <h2>⚙️ 机器人配置</h2>

    <!-- 二级导航 -->
    <div class="config-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="config-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 系统配置面板 -->
    <div v-if="activeTab === 'system'" class="config-panel">
      <div class="config-section">
        <h3>🔋 省电策略配置</h3>

        <div class="config-item">
          <div class="config-item-header">
            <label>省电阀值</label>
            <span class="config-item-value">{{ thresholdValue }}%</span>
            <span v-if="robotStore.powerPolicy.mode === 'eco'" class="eco-badge">当前省电中</span>
          </div>
          <p class="config-item-desc">
            当电量低于此阀值时，自动进入省电模式（限制跳舞、限制音量等）。范围 10% - 50%。
          </p>
          <div class="threshold-slider">
            <input
              type="range"
              min="10"
              max="50"
              step="5"
              v-model.number="thresholdValue"
            />
            <div class="threshold-labels">
              <span>10%</span>
              <span>30%</span>
              <span>50%</span>
            </div>
          </div>
        </div>

        <div class="config-item">
          <div class="config-item-header">
            <label>当前省电模式</label>
            <span class="mode-badge" :class="robotStore.powerPolicy.mode">
              {{ robotStore.powerPolicy.mode === "eco" ? "⚡ 省电模式" : "✅ 正常模式" }}
            </span>
          </div>
          <p class="config-item-desc" v-if="robotStore.powerPolicy.mode === 'eco'">
            省电模式下，跳舞功能不可用，音乐音量限制为 50% 以下。
          </p>
          <p class="config-item-desc" v-if="robotStore.powerPolicy.manual_override">
            已触发手动豁免，本次会话不再自动进入省电模式。
          </p>
        </div>

        <div class="config-actions">
          <button class="btn-save" :disabled="isSaving" @click="handleSaveThreshold">
            {{ isSaving ? "保存中..." : "💾 保存" }}
          </button>
          <span v-if="saveResult" class="save-result">{{ saveResult }}</span>
        </div>

        <!-- 🔧 调试：模拟低电量 -->
        <div class="debug-section">
          <h4>🧪 调试：模拟低电量测试</h4>
          <p class="config-item-desc">
            设置一个低于阀值的模拟电量，可立即测试自动进入省电模式。模拟期间不影响真实电量采集。
          </p>

          <div class="simulate-row">
            <input
              type="range"
              min="5"
              max="95"
              step="1"
              v-model.number="simulateBatteryLevel"
              class="simulate-slider"
            />
            <span class="simulate-value">{{ simulateBatteryLevel }}%</span>
          </div>

          <div class="simulate-actions">
            <button class="btn-simulate" @click="handleSimulate">
              {{ isSimulating ? '🔄 更新模拟值' : '🧪 模拟此电量' }}
            </button>
            <button class="btn-clear-sim" v-if="isSimulating" @click="handleClearSimulation">
              ↩️ 恢复真实电量
            </button>
          </div>

          <p v-if="isSimulating" class="simulate-active-tip">
            ⚠️ 当前为模拟电量 {{ simulateBatteryLevel }}%，真实电量采集不受影响。
          </p>
        </div>
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

/* ---- 二级导航 ---- */
.config-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0;
}
.config-tab {
  padding: 8px 16px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}
.config-tab:hover {
  color: var(--text-primary);
}
.config-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* ---- 配置面板 ---- */
.config-panel {
  flex: 1;
  overflow-y: auto;
}
.config-section {
  max-width: 560px;
}
.config-section h3 {
  font-size: 16px;
  margin-bottom: 16px;
}

.config-item {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
}
.config-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.config-item-header label {
  font-weight: 600;
  font-size: 14px;
}
.config-item-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
}
.eco-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}
.mode-badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 10px;
}
.mode-badge.normal {
  background: rgba(0, 255, 136, 0.15);
  color: var(--success);
}
.mode-badge.eco {
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}

.config-item-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* ---- 滑动条 ---- */
.threshold-slider {
  margin-top: 12px;
}
.threshold-slider input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}
.threshold-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* ---- 保存 ---- */
.config-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.btn-save {
  padding: 10px 24px;
  background: var(--accent);
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-save:hover:not(:disabled) {
  opacity: 0.85;
}
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.save-result {
  font-size: 13px;
  color: var(--success);
}

/* ---- 模拟低电量调试 ---- */
.debug-section {
  margin-top: 28px;
  padding: 16px;
  background: var(--bg-card);
  border: 1px dashed rgba(255, 193, 7, 0.4);
  border-radius: var(--radius-md);
}
.debug-section h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
}
.simulate-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.simulate-slider {
  flex: 1;
  accent-color: #ffc107;
}
.simulate-value {
  font-size: 18px;
  font-weight: 700;
  color: #ffc107;
  min-width: 44px;
  text-align: right;
}
.simulate-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.btn-simulate {
  padding: 8px 18px;
  background: #ffc107;
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-simulate:hover:not(:disabled) {
  opacity: 0.8;
}
.btn-simulate:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-clear-sim {
  padding: 8px 18px;
  background: none;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-clear-sim:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.simulate-active-tip {
  margin-top: 10px;
  font-size: 12px;
  color: #ffc107;
}
</style>
