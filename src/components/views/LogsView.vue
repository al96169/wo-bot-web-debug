<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted, onActivated, onDeactivated } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useAppStore } from "@/stores/app";
import { useWebSocket } from "@/composables/useWebSocket";

const robotStore = useRobotStore();
const appStore = useAppStore();
const { requestLogs } = useWebSocket();

const keyword = ref("");
const levelFilter = ref("info");
const sortAsc = ref(false);
const autoScroll = ref(true);

// 轮询控制
const autoRefresh = ref(false);
const refreshInterval = ref(5);
const pageSize = ref(200);

const logContainer = ref<HTMLElement | null>(null);

// 加载状态
const isLoading = ref(false);
const isLoadingMore = ref(false);

// 前端 level → 服务端 level 映射（"warn" → "warning"）
const pollLevelMap: Record<string, string> = {
  all: "",
  debug: "debug",
  info: "info",
  warn: "warning",
  error: "error",
};

function pollLevel(): string {
  return pollLevelMap[levelFilter.value] ?? "";
}

const filteredLogs = computed(() => {
  let logs = [...robotStore.logs];
  if (keyword.value) {
    const kw = keyword.value.toLowerCase();
    logs = logs.filter((l) => l.message.toLowerCase().includes(kw) || l.source.toLowerCase().includes(kw));
  }
  if (levelFilter.value !== "all") {
    logs = logs.filter((l) => l.level === levelFilter.value);
  }
  if (sortAsc.value) {
    logs.reverse();
  }
  return logs;
});

// 时间格式化：服务端 "2026-07-10 12:30:45,123" → 显示 "12:30:45"
function formatTime(time: string): string {
  const parts = time.split(" ");
  if (parts.length >= 2) {
    return parts[1].split(",")[0];
  }
  return time;
}

// ---- 日志请求 ----

/** 首次加载：取最新 N 条（tail 模式） */
function fetchTailLogs(): void {
  if (appStore.connection !== "connected" || appStore.mockMode) return;
  isLoading.value = true;
  requestLogs({ mode: "tail", limit: pageSize.value, level: pollLevel() });
}

/** 增量同步：拉取游标之后的新日志（since 模式） */
function fetchNewLogs(): void {
  if (appStore.connection !== "connected" || appStore.mockMode) return;
  if (robotStore.logCursor === 0) {
    // 游标未初始化，先 tail
    fetchTailLogs();
    return;
  }
  requestLogs({ mode: "since", sinceLine: robotStore.logCursor, limit: pageSize.value, level: pollLevel() });
}

/** 向上加载历史日志：拉取当前最旧行之前的记录（before 模式） */
function fetchOlderLogs(): void {
  if (appStore.connection !== "connected" || appStore.mockMode) return;
  if (isLoadingMore.value || !robotStore.logs.length || !robotStore.logHasMore) return;

  const oldestLineNo = robotStore.logs[0].lineNo;
  if (oldestLineNo <= 0) return;

  isLoadingMore.value = true;
  requestLogs({ mode: "before", beforeLine: oldestLineNo, limit: pageSize.value, level: pollLevel() });
}

// ---- 手动操作 ----

function manualRefresh(): void {
  fetchNewLogs();
}

function clearLogs(): void {
  robotStore.clearLogs();
}

function exportLogs(): void {
  const text = filteredLogs.value
    .map((l) => `[${l.time}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`)
    .join("\n");
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wo-bot-logs-${new Date().toISOString().slice(0, 10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- 轮询逻辑 ----
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  if (!autoRefresh.value) return;
  pollTimer = setInterval(() => {
    fetchNewLogs();
  }, refreshInterval.value * 1000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function handleVisibilityChange(): void {
  if (document.hidden) {
    stopPolling();
  } else if (autoRefresh.value) {
    fetchNewLogs();
    startPolling();
  }
}

// ---- 滚动处理：顶部加载更多，底部自动滚动 ----

function handleScroll(): void {
  if (!logContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = logContainer.value;

  // 滚动到顶部：加载历史日志
  if (scrollTop < 50 && robotStore.logHasMore && !isLoadingMore.value) {
    const prevScrollHeight = scrollHeight;
    fetchOlderLogs();
    // 保持滚动位置（加载后补偿高度差）
    nextTick(() => {
      if (logContainer.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight - prevScrollHeight;
      }
    });
  }
}

// 自动滚动到底部（仅当有新日志追加时）
let _lastLogCount = 0;
watch(
  () => filteredLogs.value.length,
  (newLen) => {
    if (autoScroll.value && newLen > _lastLogCount) {
      nextTick(() => {
        if (logContainer.value) {
          logContainer.value.scrollTop = logContainer.value.scrollHeight;
        }
      });
    }
    _lastLogCount = newLen;
  },
);

// 监听 loading 状态变化
watch(
  () => robotStore.logs.length,
  () => {
    isLoading.value = false;
    isLoadingMore.value = false;
  },
);

// 自动刷新开关或间隔变化时重启轮询
watch([autoRefresh, refreshInterval], () => {
  startPolling();
});

// 级别/条数变化时重新 tail 加载
watch([levelFilter, pageSize], () => {
  fetchTailLogs();
});

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  fetchTailLogs();
});

onActivated(() => {
  fetchNewLogs();
  if (autoRefresh.value) {
    startPolling();
  }
});

onDeactivated(() => {
  stopPolling();
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopPolling();
});
</script>

<template>
  <div class="view active">
    <div class="logs-layout">
      <div class="logs-toolbar">
        <div class="logs-filter">
          <input v-model="keyword" type="text" placeholder="关键词过滤..." />
          <select v-model="levelFilter">
            <option value="all">全部等级</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
          <label class="inline-label">
            条数
            <select v-model.number="pageSize">
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="500">500</option>
              <option :value="1000">1000</option>
            </select>
          </label>
        </div>
        <div class="logs-poll">
          <label> <input v-model="autoRefresh" type="checkbox" /> 自动刷新 </label>
          <select v-model.number="refreshInterval" :disabled="!autoRefresh">
            <option :value="2">2s</option>
            <option :value="5">5s</option>
            <option :value="10">10s</option>
            <option :value="30">30s</option>
          </select>
          <button @click="manualRefresh">刷新</button>
        </div>
        <div class="logs-actions">
          <button title="切换排序" @click="sortAsc = !sortAsc">
            {{ sortAsc ? "↑" : "↓" }} {{ sortAsc ? "正序" : "倒序" }}
          </button>
          <button @click="clearLogs">清空</button>
          <button @click="exportLogs">导出</button>
          <label> <input v-model="autoScroll" type="checkbox" /> 自动滚动 </label>
        </div>
      </div>
      <div class="logs-info">
        <span v-if="isLoading">加载中...</span>
        <span v-else-if="isLoadingMore">加载更多...</span>
        <span v-else-if="robotStore.logHasMore">↑ 滚动到顶部加载更多历史日志</span>
        <span v-else>已加载全部历史日志</span>
        <span class="logs-count">共 {{ filteredLogs.length }} 条</span>
        <span v-if="autoRefresh" class="logs-live">● LIVE</span>
      </div>
      <div ref="logContainer" class="logs-container" @scroll="handleScroll">
        <div v-if="filteredLogs.length === 0" class="empty-state">暂无日志</div>
        <div v-for="(log, idx) in filteredLogs" :key="log.id" class="log-entry">
          <span class="log-time" :title="log.time">{{ formatTime(log.time) }}</span>
          <span class="log-level" :class="log.level">{{ log.level.toUpperCase() }}</span>
          <span class="log-source">{{ log.source }}</span>
          <span>{{ log.message }}</span>
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
.logs-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.logs-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 4px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.logs-filter {
  display: flex;
  gap: 8px;
  align-items: center;
}
.logs-filter input,
.logs-filter select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
}
.logs-filter input {
  min-width: 180px;
}
.logs-poll {
  display: flex;
  gap: 8px;
  align-items: center;
}
.logs-poll select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
}
.logs-poll select:disabled {
  opacity: 0.5;
}
.logs-poll button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}
.logs-poll button:hover {
  background: var(--bg-hover);
}
.logs-poll label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.logs-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.logs-actions button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}
.logs-actions button:hover {
  background: var(--bg-hover);
}
.logs-actions label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.inline-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.inline-label select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
}
.logs-info {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.logs-count {
  margin-left: auto;
}
.logs-live {
  color: var(--danger);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
.logs-container {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px;
  font-family: "SF Mono", Monaco, monospace;
  font-size: 12px;
}
.log-entry {
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
  overflow-wrap: break-word;
}
.log-entry:last-child {
  border-bottom: none;
}
.log-time {
  color: var(--text-muted);
  margin-right: 8px;
}
.log-level {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-size: 10px;
  margin-right: 8px;
  min-width: 40px;
  text-align: center;
}
.log-level.debug {
  background: var(--bg-tertiary);
  color: var(--text-muted);
}
.log-level.info {
  background: var(--accent);
  color: var(--bg-primary);
}
.log-level.warn {
  background: var(--warning);
  color: var(--bg-primary);
}
.log-level.error {
  background: var(--danger);
  color: white;
}
.log-source {
  color: var(--accent-secondary);
  margin-right: 8px;
  font-weight: 600;
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
