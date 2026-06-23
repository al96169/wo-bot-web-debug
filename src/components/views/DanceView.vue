<script setup lang="ts">
import { computed, ref } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket, getRemoteFeatures, onMessage } from "@/composables/useWebSocket";

const { send } = useWebSocket();
const robotStore = useRobotStore();

// ----- 功能可用性 -----
const danceAvailable = computed(() => getRemoteFeatures().includes("dance"));

// ----- 从 store 读取舞蹈数据（跨视图切换持久化） -----
const dances = computed(() => robotStore.dances);
const status = computed(() => robotStore.danceStatus);
const currentDanceId = computed(() => robotStore.danceCurrentId);
const progress = computed(() => robotStore.danceProgress);
const selectedDanceId = ref<string | null>(null);

// 监听来自服务端的消息，自动拉取列表
onMessage((msg: { type: string; data?: any }) => {
  // 连接后 features 中有 dance 且列表为空时自动拉取
  if (msg.type === "status" && msg.data?.features?.includes("dance") && robotStore.dances.length === 0) {
    send({ type: "dance", data: { command: "list" } });
  }
});

// 播放
function play(danceId: string) {
  selectedDanceId.value = danceId;
  send({ type: "dance", data: { command: "play", dance_id: danceId } });
  robotStore.addLog("info", "舞蹈", `开始播放: ${dances.value.find((d) => d.id === danceId)?.name ?? danceId}`);
}

// 暂停/恢复
function togglePause() {
  send({ type: "dance", data: { command: "pause" } });
  robotStore.addLog("info", "舞蹈", status.value === "playing" ? "暂停" : "恢复");
}

// 停止
function stop() {
  send({ type: "dance", data: { command: "stop" } });
  robotStore.addLog("info", "舞蹈", "停止播放");
}

// 手动拉取列表
function requestList() {
  send({ type: "dance", data: { command: "list" } });
}

// 格式化时长
function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

const progressPercent = computed(() => Math.round(progress.value * 100));

const currentDanceName = computed(() => {
  const d = dances.value.find((d) => d.id === currentDanceId.value);
  return d?.name ?? "";
});
</script>

<template>
  <div class="dance-view">
    <div v-if="!danceAvailable" class="dance-unavailable">
      <div class="empty-icon">💃</div>
      <p>舞蹈功能不可用</p>
      <p class="hint">请确认机器人固件已更新，或等待连接后 features 到达。</p>
    </div>

    <template v-else>
      <!-- 舞蹈列表 -->
      <div class="dance-section">
        <div class="section-header">
          <h3>舞蹈曲目</h3>
          <button class="btn-sm" @click="requestList">刷新</button>
        </div>

        <div v-if="dances.length === 0" class="empty-list">
          <p>暂无舞蹈数据，请点击刷新</p>
        </div>

        <div v-else class="dance-grid">
          <button
            v-for="d in dances"
            :key="d.id"
            class="dance-card"
            :class="{
              selected: selectedDanceId === d.id,
              active: currentDanceId === d.id && status !== 'stopped',
            }"
            @click="play(d.id)"
          >
            <span class="dance-icon">{{ d.icon }}</span>
            <span class="dance-name">{{ d.name }}</span>
            <span class="dance-duration">{{ formatDuration(d.duration_sec) }}</span>
          </button>
        </div>
      </div>

      <!-- 播放控制 -->
      <div class="player-section" :class="{ active: currentDanceId }">
        <div class="player-status">
          <span class="status-badge" :class="status">
            {{ status === "playing" ? "▶ 播放中" : status === "paused" ? "⏸ 已暂停" : "⏹ 已停止" }}
          </span>
          <span v-if="currentDanceName" class="now-playing">{{ currentDanceName }}</span>
        </div>

        <!-- 进度条 -->
        <div class="progress-bar-wrap">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
          </div>
          <span class="progress-text">{{ progressPercent }}%</span>
        </div>

        <!-- 控制按钮 -->
        <div class="player-controls">
          <button class="control-btn pause" :disabled="status === 'stopped'" @click="togglePause">
            {{ status === "paused" ? "▶ 恢复" : "⏸ 暂停" }}
          </button>
          <button class="control-btn stop" :disabled="status === 'stopped'" @click="stop">⏹ 停止</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dance-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
}

.dance-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-muted, #888);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.hint {
  font-size: 13px;
  opacity: 0.6;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.btn-sm {
  padding: 4px 12px;
  font-size: 13px;
  border: 1px solid var(--color-border, #444);
  border-radius: 6px;
  background: var(--color-bg-secondary, #2a2a2a);
  color: var(--color-text, #eee);
  cursor: pointer;
}
.btn-sm:hover {
  background: var(--color-bg-hover, #3a3a3a);
}

.empty-list {
  text-align: center;
  color: var(--color-text-muted, #888);
  padding: 24px 0;
}

.dance-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}

.dance-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  border: 1px solid var(--color-border, #444);
  border-radius: 10px;
  background: var(--color-bg-secondary, #2a2a2a);
  cursor: pointer;
  transition: all 0.15s;
  color: var(--color-text, #eee);
}

.dance-card:hover {
  border-color: var(--color-primary, #6c8cff);
  background: var(--color-bg-hover, #333);
}

.dance-card.selected {
  border-color: var(--color-primary, #6c8cff);
}

.dance-card.active {
  border-color: #4caf50;
  background: rgba(76, 175, 80, 0.08);
}

.dance-icon {
  font-size: 28px;
}
.dance-name {
  font-size: 13px;
  font-weight: 500;
  text-align: center;
}
.dance-duration {
  font-size: 11px;
  color: var(--color-text-muted, #888);
}

/* ----- 播放器 ----- */
.player-section {
  border: 1px solid var(--color-border, #444);
  border-radius: 10px;
  padding: 16px;
  background: var(--color-bg-secondary, #2a2a2a);
  opacity: 0.5;
  transition: opacity 0.2s;
}

.player-section.active {
  opacity: 1;
}

.player-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.status-badge {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.status-badge.stopped {
  background: rgba(255, 255, 255, 0.08);
  color: #888;
}
.status-badge.playing {
  background: rgba(76, 175, 80, 0.15);
  color: #4caf50;
}
.status-badge.paused {
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}

.now-playing {
  font-size: 14px;
  font-weight: 500;
}

.progress-bar-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--color-primary, #6c8cff);
  transition: width 0.3s;
}

.progress-text {
  font-size: 12px;
  color: var(--color-text-muted, #888);
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.player-controls {
  display: flex;
  gap: 10px;
}

.control-btn {
  flex: 1;
  padding: 10px 0;
  border: 1px solid var(--color-border, #444);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: var(--color-bg-secondary, #2a2a2a);
  color: var(--color-text, #eee);
  transition: all 0.15s;
}

.control-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.control-btn.pause:not(:disabled):hover {
  background: rgba(255, 193, 7, 0.1);
  border-color: #ffc107;
}

.control-btn.stop:not(:disabled):hover {
  background: rgba(244, 67, 54, 0.1);
  border-color: #f44336;
}
</style>
