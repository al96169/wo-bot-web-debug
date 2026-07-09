<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket } from "@/composables/useWebSocket";
import type { Software, SoftwareTask } from "@/types";

const robotStore = useRobotStore();
const { requestSoftwareList, requestSoftwareAvailable, sendSoftwareAction } = useWebSocket();

const rootEl = ref<HTMLElement | null>(null);
const activeTab = ref<"installed" | "available" | "tasks">("installed");

const runningTaskCount = computed(
  () => robotStore.softwareTasks.filter((t) => t.status === "running").length,
);

const sortedTasks = computed(() =>
  [...robotStore.softwareTasks].sort((a, b) => b.startedAt - a.startedAt),
);

const actionLabel: Record<SoftwareTask["action"], string> = {
  install: "安装",
  uninstall: "卸载",
  upgrade: "升级",
};

// 进入页面时刷新已安装 + 可安装列表
onMounted(() => {
  requestSoftwareList();
  requestSoftwareAvailable();
});

// 实时日志输出自动滚动到底部
watch(
  () => robotStore.softwareTasks.map((t) => t.output).join("|"),
  () => {
    nextTick(() => {
      rootEl.value?.querySelectorAll(".task-output").forEach((el) => {
        el.scrollTop = el.scrollHeight;
      });
    });
  },
);

function startTask(sw: Software, action: SoftwareTask["action"]): void {
  const task: SoftwareTask = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    package: sw.name,
    action,
    progress: 0,
    stage: "pending",
    output: "",
    status: "running",
    startedAt: Date.now(),
    fromVersion: sw.version || undefined,
  };
  robotStore.addSoftwareTask(task);
  robotStore.addLog("info", "Software", `${action} ${sw.name}`);
  robotStore.addCmdLog({
    time: new Date().toLocaleTimeString(),
    direction: "send",
    type: `software_${action}`,
    data: sw.name,
  });
  sendSoftwareAction(action, sw.name);
  activeTab.value = "tasks";
}

function handleInstall(sw: Software): void {
  startTask(sw, "install");
}

function handleUninstall(sw: Software): void {
  startTask(sw, "uninstall");
}

function handleUpgrade(sw: Software): void {
  if (sw.critical) {
    const ok = window.confirm("此为关键服务，升级完成后需重新连接。客户端将自动定时重试连接。");
    if (!ok) return;
  }
  startTask(sw, "upgrade");
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

/** 版本号变化描述：仅在有版本信息时展示 */
function versionChange(task: SoftwareTask): string {
  const from = task.fromVersion;
  const to = task.toVersion;
  if (from && to) return `${from} → ${to}`;
  if (to && !from) return `→ ${to}`;
  if (from && !to) return `${from} → 已移除`;
  return "";
}
</script>

<template>
  <div ref="rootEl" class="view active">
    <h2>软件管理</h2>
    <div class="software-layout">
      <div class="software-tabs">
        <button class="tab-btn" :class="{ active: activeTab === 'installed' }" @click="activeTab = 'installed'">
          已安装
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'available' }" @click="activeTab = 'available'">
          可安装
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'tasks' }" @click="activeTab = 'tasks'">
          安装任务
          <span v-if="runningTaskCount > 0" class="tab-badge">{{ runningTaskCount }}</span>
        </button>
      </div>
      <div class="software-content">
        <!-- 已安装 -->
        <div class="tab-panel" :class="{ active: activeTab === 'installed' }">
          <div class="software-hint">仅展示 wo-bot 官方软件，系统其他软件请使用终端</div>
          <div class="software-list">
            <div v-if="robotStore.softwareInstalled.length === 0" class="empty-state">暂无已安装软件</div>
            <div v-for="sw in robotStore.softwareInstalled" :key="sw.name" class="software-card">
              <div class="software-card-icon">{{ sw.icon }}</div>
              <div class="software-card-info">
                <div class="software-card-name">
                  {{ sw.display_name }}
                  <span class="category-badge">{{ sw.category }}</span>
                </div>
                <div class="software-card-meta">
                  <span v-if="sw.version" class="sw-version">v{{ sw.version }}</span>
                  <span class="sw-desc">{{ sw.description }}</span>
                </div>
              </div>
              <div class="software-card-actions">
                <button v-if="sw.upgradable" class="upgrade" @click="handleUpgrade(sw)">升级</button>
                <span v-else class="up-to-date">已是最新</span>
                <button
                  class="uninstall"
                  :disabled="sw.critical"
                  :title="sw.critical ? '关键服务，不可卸载' : ''"
                  @click="handleUninstall(sw)"
                >
                  <span v-if="sw.critical">🔒</span> 卸载
                </button>
              </div>
            </div>
          </div>
        </div>
        <!-- 可安装 -->
        <div class="tab-panel" :class="{ active: activeTab === 'available' }">
          <div class="software-list">
            <div v-if="robotStore.softwareAvailable.length === 0" class="empty-state">暂无可安装软件</div>
            <div v-for="sw in robotStore.softwareAvailable" :key="sw.name" class="software-card">
              <div class="software-card-icon">{{ sw.icon }}</div>
              <div class="software-card-info">
                <div class="software-card-name">
                  {{ sw.display_name }}
                  <span class="category-badge">{{ sw.category }}</span>
                </div>
                <div class="software-card-meta">
                  <span class="sw-desc">{{ sw.description }}</span>
                </div>
              </div>
              <div class="software-card-actions">
                <button class="install" @click="handleInstall(sw)">安装</button>
              </div>
            </div>
          </div>
        </div>
        <!-- 安装任务 -->
        <div class="tab-panel" :class="{ active: activeTab === 'tasks' }">
          <div class="task-list">
            <div v-if="sortedTasks.length === 0" class="empty-state">暂无任务</div>
            <div v-for="task in sortedTasks" :key="task.id" class="task-card">
              <div class="task-header">
                <span class="task-action" :class="task.action">{{ actionLabel[task.action] }}</span>
                <span class="task-package">{{ task.package }}</span>
                <span v-if="versionChange(task)" class="task-version">{{ versionChange(task) }}</span>
                <span class="task-status" :class="task.status">
                  <template v-if="task.status === 'running'">进行中</template>
                  <template v-else-if="task.status === 'success'">成功</template>
                  <template v-else>失败</template>
                </span>
              </div>
              <template v-if="task.status === 'running'">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: task.progress + '%' }"></div>
                </div>
                <div class="progress-info">
                  <span class="progress-stage">{{ task.stage || "等待中" }}</span>
                  <span class="progress-percent">{{ Math.round(task.progress) }}%</span>
                </div>
                <pre v-if="task.output" class="task-output">{{ task.output }}</pre>
              </template>
              <template v-else>
                <div class="task-result">
                  耗时 {{ formatDuration((task.completedAt ?? task.startedAt) - task.startedAt) }}
                </div>
              </template>
            </div>
          </div>
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
.software-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.software-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.tab-btn {
  position: relative;
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.tab-btn.active {
  background: var(--accent);
  color: var(--bg-primary);
}
.tab-badge {
  display: inline-block;
  margin-left: 6px;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
}
.software-content {
  flex: 1;
  overflow: hidden;
}
.tab-panel {
  display: none;
  height: 100%;
}
.tab-panel.active {
  display: flex;
  flex-direction: column;
}
.software-hint {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
}
.software-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  flex: 1;
}
.software-card {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 16px;
}
.software-card-icon {
  font-size: 28px;
}
.software-card-info {
  flex: 1;
  min-width: 0;
}
.software-card-name {
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.category-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 400;
}
.software-card-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  display: flex;
  gap: 8px;
  align-items: center;
}
.sw-version {
  color: var(--accent);
}
.sw-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.software-card-actions {
  display: flex;
  gap: 8px;
}
.software-card-actions button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}
.software-card-actions button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.software-card-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.software-card-actions button.install {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}
.software-card-actions button.uninstall {
  color: var(--danger);
  border-color: var(--danger);
}
.software-card-actions button.upgrade {
  color: var(--warning);
  border-color: var(--warning);
}
.up-to-date {
  color: var(--text-muted);
  font-size: 12px;
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}

/* ---- 安装任务 ---- */
.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
}
.task-card {
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.task-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.task-action {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.task-action.install {
  background: var(--accent);
  color: var(--bg-primary);
}
.task-action.uninstall {
  background: var(--danger);
  color: #fff;
}
.task-action.upgrade {
  background: var(--warning);
  color: var(--bg-primary);
}
.task-package {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}
.task-version {
  font-size: 11px;
  color: var(--text-muted);
  font-family: "SFMono-Regular", Consolas, monospace;
}
.task-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
}
.task-status.running {
  background: var(--bg-hover);
  color: var(--accent);
}
.task-status.success {
  background: rgba(76, 175, 80, 0.15);
  color: #4caf50;
}
.task-status.failed {
  background: rgba(244, 67, 54, 0.15);
  color: var(--danger);
}
.progress-bar {
  height: 8px;
  background: var(--bg-hover);
  border-radius: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 4px;
  transition: width 0.3s ease;
}
.progress-info {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}
.task-output {
  margin: 8px 0 0;
  max-height: 160px;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: "SFMono-Regular", Consolas, monospace;
}
.task-result {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
