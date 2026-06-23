<script setup lang="ts">
import { computed } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useAppStore } from "@/stores/app";
import { useWebSocket } from "@/composables/useWebSocket";
import type { ServiceInfo } from "@/types";

const robotStore = useRobotStore();
const appStore = useAppStore();
const { sendServiceControl } = useWebSocket();

const services = computed(() => robotStore.services);

const mainService = computed<ServiceInfo | undefined>(() =>
  services.value.find((s) => s.service_id === "main"),
);

const subServices = computed(() =>
  services.value.filter((s) => s.service_id !== "main"),
);

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: "运行中",
    stopped: "已停止",
    starting: "启动中",
    failed: "异常",
  };
  return map[status] || status;
}

function statusClass(status: string): string {
  const map: Record<string, string> = {
    running: "status-running",
    stopped: "status-stopped",
    starting: "status-starting",
    failed: "status-failed",
  };
  return map[status] || "";
}

function handleStart(serviceId: string): void {
  sendServiceControl(serviceId, "start");
  appStore.showToast(`正在启动服务...`, "info");
}

function handleStop(serviceId: string): void {
  sendServiceControl(serviceId, "stop");
  appStore.showToast(`正在停止服务...`, "info");
}

function handleRestart(serviceId: string): void {
  if (serviceId === "main") {
    appStore.showToast("主服务不可通过面板重启，请通过顶部操作栏重启", "info");
    return;
  }
  sendServiceControl(serviceId, "restart");
  appStore.showToast(`正在重启服务...`, "info");
}
</script>

<template>
  <div class="process-manager-layout">
    <div class="pm-toolbar">
      <div class="pm-toolbar-left">
        <h2 class="pm-title">进程管理器</h2>
        <span class="pm-subtitle">管理所有子服务及进程</span>
      </div>
      <div class="pm-toolbar-right">
        <span class="pm-auto-refresh">自动刷新中</span>
      </div>
    </div>

    <!-- 主服务卡片 -->
    <div class="pm-section">
      <h3 class="pm-section-title">主服务</h3>
      <div class="pm-card pm-card-main" :class="statusClass(mainService?.status ?? 'stopped')">
        <div class="pm-card-header">
          <div class="pm-card-name">
            <span class="pm-dot"></span>
            <span class="pm-name">wo-bot-control</span>
            <span class="pm-tag">主进程</span>
          </div>
          <div class="pm-card-actions">
            <button
              class="pm-action-btn pm-action-restart"
              title="如需重启主服务，请通过顶部操作栏重启"
              @click="handleRestart('main')"
            >
              ?
            </button>
          </div>
        </div>
        <div class="pm-card-body">
          <div class="pm-stat">
            <span class="pm-stat-label">状态</span>
            <span class="pm-stat-value" :class="statusClass(mainService?.status ?? 'stopped')">
              {{ statusLabel(mainService?.status ?? "stopped") }}
            </span>
          </div>
          <div class="pm-stat">
            <span class="pm-stat-label">PID</span>
            <span class="pm-stat-value-mono">{{ mainService?.pid ?? "--" }}</span>
          </div>
          <div class="pm-stat">
            <span class="pm-stat-label">运行时间</span>
            <span class="pm-stat-value">{{ formatUptime(mainService?.uptime ?? 0) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 子服务列表 -->
    <div class="pm-section">
      <h3 class="pm-section-title">子服务 ({{ subServices.length }})</h3>
      <div v-if="subServices.length === 0" class="pm-empty">
        暂无子服务数据
      </div>
      <div
        v-for="svc in subServices"
        :key="svc.service_id"
        class="pm-card"
        :class="statusClass(svc.status)"
      >
        <div class="pm-card-header">
          <div class="pm-card-name">
            <span class="pm-dot"></span>
            <span class="pm-name">{{ svc.name }}</span>
            <span class="pm-id">{{ svc.service_id }}</span>
          </div>
          <div class="pm-card-actions">
            <button
              v-if="svc.status === 'stopped' || svc.status === 'failed'"
              class="pm-action-btn pm-action-start"
              title="启动"
              @click="handleStart(svc.service_id)"
            >
              ▶
            </button>
            <button
              v-if="svc.status === 'running'"
              class="pm-action-btn pm-action-stop"
              title="停止"
              @click="handleStop(svc.service_id)"
            >
              ■
            </button>
            <button
              class="pm-action-btn pm-action-restart"
              title="重启"
              @click="handleRestart(svc.service_id)"
            >
              ↻
            </button>
          </div>
        </div>
        <div class="pm-card-body">
          <div class="pm-stat">
            <span class="pm-stat-label">状态</span>
            <span class="pm-stat-value" :class="statusClass(svc.status)">
              {{ statusLabel(svc.status) }}
            </span>
          </div>
          <div class="pm-stat">
            <span class="pm-stat-label">PID</span>
            <span class="pm-stat-value-mono">{{ svc.pid ?? "--" }}</span>
          </div>
          <div class="pm-stat">
            <span class="pm-stat-label">运行时间</span>
            <span class="pm-stat-value">{{ formatUptime(svc.uptime) }}</span>
          </div>
          <div class="pm-stat">
            <span class="pm-stat-label">重启次数</span>
            <span class="pm-stat-value" :class="{ 'pm-restart-warn': svc.restart_count >= 5 }">
              {{ svc.restart_count }}/10
            </span>
          </div>
        </div>
        <div v-if="svc.last_error" class="pm-card-error">
          <span class="pm-error-label">错误:</span>
          <span class="pm-error-text">{{ svc.last_error }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.process-manager-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  gap: 16px;
}

/* ---- Toolbar ---- */
.pm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  flex-shrink: 0;
}
.pm-toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.pm-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.pm-subtitle {
  font-size: 12px;
  color: var(--text-muted);
}
.pm-auto-refresh {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}
.pm-auto-refresh::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  animation: pulse 1.5s infinite;
}

/* ---- Section ---- */
.pm-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
  padding: 0 4px;
}

/* ---- Card ---- */
.pm-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  transition: border-color 0.2s;
}
.pm-card + .pm-card {
  margin-top: 8px;
}
.pm-card:hover {
  border-color: var(--accent);
}
.pm-card.status-running {
  border-left: 3px solid var(--success);
}
.pm-card.status-stopped {
  border-left: 3px solid var(--text-muted);
}
.pm-card.status-starting {
  border-left: 3px solid var(--warning);
}
.pm-card.status-failed {
  border-left: 3px solid var(--danger);
  background: rgba(255, 68, 68, 0.05);
}
.pm-card-main {
  border-left: 3px solid var(--accent);
}

.pm-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.pm-card-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}
.status-running .pm-dot {
  background: var(--success);
}
.status-starting .pm-dot {
  background: var(--warning);
  animation: pulse 1s infinite;
}
.status-failed .pm-dot {
  background: var(--danger);
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.pm-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}
.pm-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: rgba(0, 212, 255, 0.15);
  color: var(--accent);
}
.pm-id {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
}

.pm-card-actions {
  display: flex;
  gap: 4px;
}
.pm-action-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.pm-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.pm-action-start:hover {
  background: var(--success);
  color: #fff;
  border-color: var(--success);
}
.pm-action-stop:hover {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}
.pm-action-restart:hover {
  background: var(--warning);
  color: #000;
  border-color: var(--warning);
}

.pm-card-body {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.pm-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pm-stat-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
}
.pm-stat-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}
.pm-stat-value.status-running {
  color: var(--success);
}
.pm-stat-value.status-stopped {
  color: var(--text-muted);
}
.pm-stat-value.status-starting {
  color: var(--warning);
}
.pm-stat-value.status-failed {
  color: var(--danger);
}
.pm-stat-value-mono {
  font-size: 13px;
  color: var(--text-primary);
  font-family: var(--font-mono, monospace);
}
.pm-restart-warn {
  color: var(--warning);
}

.pm-card-error {
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(255, 68, 68, 0.08);
  border-radius: var(--radius-sm);
  display: flex;
  gap: 8px;
  font-size: 12px;
}
.pm-error-label {
  color: var(--danger);
  font-weight: 600;
  flex-shrink: 0;
}
.pm-error-text {
  color: var(--text-secondary);
  word-break: break-all;
}

.pm-empty {
  text-align: center;
  padding: 32px;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
