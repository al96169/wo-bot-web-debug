<script setup lang="ts">
import { ref } from "vue";
import { useRobotStore } from "@/stores/robot";
import WiFiManager from "@/components/dialogs/WiFiManager.vue";

const robotStore = useRobotStore();

const copiedLabel = ref<string | null>(null);
const showWifiManager = ref(false);

function copyValue(value: string, label: string) {
  navigator.clipboard
    .writeText(value)
    .then(() => {
      copiedLabel.value = label;
      setTimeout(() => {
        copiedLabel.value = null;
      }, 2000);
    })
    .catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      copiedLabel.value = label;
      setTimeout(() => {
        copiedLabel.value = null;
      }, 2000);
    });
}
</script>

<template>
  <div class="view active">
    <h2>系统状态</h2>
    <div class="status-detailed">
      <!-- 运行状态卡片 -->
      <div class="status-section">
        <h3>运行状态</h3>
        <div class="status-run-cards">
          <div class="run-card">
            <div class="run-card-icon">🔋</div>
            <div class="run-card-value">{{ robotStore.systemStatus.battery.level }}%</div>
            <div class="run-card-label">电池电量</div>
          </div>
          <div class="run-card wifi-clickable" title="点击管理 WiFi" @click="showWifiManager = true">
            <div class="run-card-icon">📶</div>
            <div class="run-card-value">{{ robotStore.systemStatus.wifi.ssid }}</div>
            <div class="run-card-label">WiFi 名称</div>
          </div>
          <div class="run-card wifi-clickable" title="点击管理 WiFi" @click="showWifiManager = true">
            <div class="run-card-icon">📶</div>
            <div class="run-card-value">{{ robotStore.systemStatus.wifi.signal }}</div>
            <div class="run-card-label">WiFi 信号</div>
          </div>
          <div class="run-card">
            <div class="run-card-icon">📱</div>
            <div class="run-card-value">{{ robotStore.systemStatus.cellular.signal }}</div>
            <div class="run-card-label">蜂窝信号 / 运营商</div>
          </div>
          <div class="run-card">
            <div class="run-card-icon">💻</div>
            <div class="run-card-value">{{ robotStore.systemStatus.cpu.usage }}%</div>
            <div class="run-card-label">CPU 使用率</div>
          </div>
          <div class="run-card">
            <div class="run-card-icon">🧠</div>
            <div class="run-card-value">{{ robotStore.systemStatus.memory.usage }}%</div>
            <div class="run-card-label">内存使用率</div>
          </div>
          <div class="run-card">
            <div class="run-card-icon">💾</div>
            <div class="run-card-value">{{ robotStore.systemStatus.disk.usage }}%</div>
            <div class="run-card-label">硬盘使用率</div>
          </div>
        </div>
      </div>

      <!-- 设备详情 -->
      <div class="status-section">
        <h3>设备详情</h3>
        <div class="detail-list">
          <div v-for="detail in robotStore.deviceDetails" :key="detail.label" class="detail-item">
            <span class="detail-item-label">
              <span v-if="detail.icon">{{ detail.icon }}</span>
              {{ detail.label }}
            </span>
            <span class="detail-item-value">
              {{ detail.value }}
              <button
                v-if="detail.copyable"
                class="copy-btn"
                :class="{ copied: copiedLabel === detail.label }"
                :title="copiedLabel === detail.label ? '已复制' : '复制'"
                @click="copyValue(detail.value, detail.label)"
              >
                {{ copiedLabel === detail.label ? "✓" : "📋" }}
              </button>
            </span>
          </div>
        </div>
      </div>

      <!-- 环境信息 -->
      <div class="status-section">
        <h3>环境信息</h3>
        <div class="env-grid">
          <div class="env-item">
            <span class="env-label">温度</span>
            <span class="env-value">{{ robotStore.systemStatus.environment.temperature }}&#xB0;C</span>
          </div>
          <div class="env-item">
            <span class="env-label">湿度</span>
            <span class="env-value">{{ robotStore.systemStatus.environment.humidity }}%</span>
          </div>
          <div class="env-item">
            <span class="env-label">燃气</span>
            <span class="env-value">{{ robotStore.systemStatus.environment.gas }}</span>
          </div>
          <div class="env-item">
            <span class="env-label">光照</span>
            <span class="env-value">{{ robotStore.systemStatus.environment.light }} lux</span>
          </div>
        </div>
      </div>

      <!-- 子系统状态 -->
      <div class="status-section">
        <h3>子系统状态</h3>
        <div class="subsystem-list">
          <div v-for="sub in robotStore.subsystemStatus" :key="sub.name" class="subsystem-item">
            <span class="subsystem-name">
              <span>{{ sub.icon }}</span>
              {{ sub.name }}
            </span>
            <span class="subsystem-status" :class="sub.status">
              {{ sub.status === "online" ? "运行中" : "已停止" }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <WiFiManager v-if="showWifiManager" @close="showWifiManager = false" />
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
.status-detailed {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.status-section h3 {
  margin-bottom: 12px;
  font-size: 16px;
}
.status-run-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
}
.run-card {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  text-align: center;
}
.run-card-icon {
  font-size: 24px;
  margin-bottom: 8px;
}
.run-card-value {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 4px;
}
.run-card-label {
  font-size: 11px;
  color: var(--text-muted);
}
.detail-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
}
.detail-item-label {
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.detail-item-value {
  font-family: monospace;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.copy-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}
.copy-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.copy-btn.copied {
  background: var(--success);
  border-color: var(--success);
  color: var(--bg-primary);
}
.env-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}
.env-item {
  padding: 20px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  text-align: center;
}
.env-label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}
.env-value {
  font-size: 24px;
  font-weight: 600;
}
.subsystem-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.subsystem-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.subsystem-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.subsystem-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}
.subsystem-status.online {
  background: rgba(0, 255, 136, 0.2);
  color: var(--success);
}
.subsystem-status.offline {
  background: rgba(255, 71, 87, 0.2);
  color: var(--danger);
}
.wifi-clickable {
  cursor: pointer;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.wifi-clickable:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
</style>
