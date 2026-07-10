<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket, getRemoteFeatures, onMessage } from "@/composables/useWebSocket";

const { send } = useWebSocket();
const robotStore = useRobotStore();

const danceAvailable = computed(() => getRemoteFeatures().includes("dance"));

const dances = computed(() => robotStore.dances);
const status = computed(() => robotStore.danceStatus);
const currentDanceId = computed(() => robotStore.danceCurrentId);
const progress = computed(() => robotStore.danceProgress);
const loopEnabled = computed({
  get: () => robotStore.danceLoop,
  set: (val: boolean) => {
    robotStore.danceLoop = val;
  },
});

// 连接后自动拉取舞蹈列表
onMessage((msg: { type: string; data?: any }) => {
  if (msg.type === "status" && msg.data?.features?.includes("dance") && robotStore.dances.length === 0) {
    send({ type: "dance", data: { command: "list" } });
  }
});

// ----- 播放控制 -----
function play(danceId: string) {
  send({ type: "dance", data: { command: "play", dance_id: danceId, loop: loopEnabled.value } });
}

function togglePlay() {
  if (status.value === "stopped") {
    if (dances.value.length > 0) play(dances.value[0].id);
  } else {
    send({ type: "dance", data: { command: "pause" } });
  }
}

function stop() {
  send({ type: "dance", data: { command: "stop" } });
}

function requestList() {
  send({ type: "dance", data: { command: "list" } });
}

// ----- 格式化 -----
function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

// ----- 计算属性 -----
const progressPercent = computed(() => Math.round(progress.value * 100));
const isPlaying = computed(() => status.value !== "stopped");

const currentDanceName = computed(() => {
  const d = dances.value.find((d) => d.id === currentDanceId.value);
  return d?.name ?? "";
});

const currentDanceIcon = computed(() => {
  const d = dances.value.find((d) => d.id === currentDanceId.value);
  return d?.icon ?? "💃";
});

// ----- 定时轮询进度 -----
let pollTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  pollTimer = setInterval(() => {
    if (robotStore.danceStatus !== "stopped") {
      send({ type: "dance", data: { command: "status" } });
    }
  }, 1000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div class="dance-view">
    <!-- 不可用 -->
    <div v-if="!danceAvailable" class="dance-unavailable">
      <div class="empty-icon">💃</div>
      <p>舞蹈功能不可用</p>
      <p class="hint">请确认机器人固件已更新，或等待连接后 features 到达。</p>
    </div>

    <template v-else>
      <!-- 舞蹈卡片区域（可滚动） -->
      <div class="dance-content">
        <div class="section-header">
          <h3>舞蹈曲目</h3>
          <button class="btn-sm" @click="requestList">🔄 刷新</button>
        </div>

        <div v-if="dances.length === 0" class="empty-list">
          <p>暂无舞蹈数据，请点击刷新</p>
        </div>

        <div v-else class="dance-grid">
          <button
            v-for="d in dances"
            :key="d.id"
            class="dance-card"
            :class="{ active: currentDanceId === d.id && isPlaying }"
            @click="play(d.id)"
          >
            <span class="dance-icon">{{ d.icon }}</span>
            <span class="dance-name">{{ d.name }}</span>
            <span class="dance-duration">{{ formatDuration(d.duration_sec) }}</span>
          </button>
        </div>
      </div>

      <!-- 底部播放栏（始终可见） -->
      <div class="player-bar" :class="{ active: isPlaying }">
        <!-- 进度条（不可拖动） -->
        <div class="bar-progress">
          <div class="bar-fill" :style="{ width: progressPercent + '%' }" />
        </div>
        <!-- 信息 + 循环开关 + 按钮 -->
        <div class="bar-row">
          <div class="bar-info">
            <div class="bar-cover">{{ isPlaying ? currentDanceIcon : "💃" }}</div>
            <div class="bar-text">
              <div class="bar-title">{{ isPlaying ? currentDanceName : "无舞蹈播放" }}</div>
              <div class="bar-sub">
                <template v-if="isPlaying">
                  {{ progressPercent }}%
                  <span class="status-tag" :class="status">{{ status === "playing" ? "播放中" : "已暂停" }}</span>
                </template>
                <template v-else>点击 ▶ 开始播放</template>
              </div>
            </div>
          </div>

          <!-- 循环播放开关（始终可切换） -->
          <label class="loop-toggle" title="循环播放">
            <input v-model="loopEnabled" type="checkbox" />
            <span class="loop-label">循环</span>
          </label>

          <!-- 控制按钮 -->
          <div class="bar-ctrls">
            <button class="ctrl-btn-sm play-btn-sm" :title="status === 'playing' ? '暂停' : '播放'" @click="togglePlay">
              {{ status === "playing" ? "⏸" : "▶️" }}
            </button>
            <button v-if="isPlaying" class="ctrl-btn-sm" title="停止" @click="stop">⏹</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dance-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* ---- 不可用 ---- */
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

/* ---- 卡片区域 ---- */
.dance-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
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
  padding-bottom: 8px;
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
  font-family: inherit;
}
.dance-card:hover {
  border-color: var(--color-primary, #6c8cff);
  background: var(--color-bg-hover, #333);
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
  line-height: 1.3;
}
.dance-duration {
  font-size: 11px;
  color: var(--color-text-muted, #888);
}

/* ---- 底部播放栏 ---- */
.player-bar {
  flex-shrink: 0;
  background: var(--color-bg-secondary, #2a2a2a);
  border-top: 1px solid var(--color-border, #444);
}

.bar-progress {
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
}
.bar-fill {
  height: 100%;
  background: var(--color-primary, #6c8cff);
  transition: width 0.3s linear;
  border-radius: 0 2px 2px 0;
}

.bar-row {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  gap: 10px;
}

.bar-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.bar-cover {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.bar-text {
  min-width: 0;
  flex: 1;
}
.bar-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.bar-sub {
  font-size: 11px;
  color: var(--color-text-muted, #888);
  line-height: 1.4;
}
.status-tag {
  margin-left: 6px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
}
.status-tag.playing {
  background: rgba(76, 175, 80, 0.15);
  color: #4caf50;
}
.status-tag.paused {
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}

/* 循环开关 */
.loop-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-muted, #888);
  user-select: none;
  flex-shrink: 0;
}
.loop-toggle input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--color-primary, #6c8cff);
  cursor: pointer;
}
.loop-toggle input[type="checkbox"]:checked + .loop-label {
  color: var(--color-primary, #6c8cff);
}
.loop-label {
  font-size: 12px;
  font-weight: 500;
}

/* 控制按钮 */
.bar-ctrls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.ctrl-btn-sm {
  width: 34px;
  height: 34px;
  border: 1px solid var(--color-border, #444);
  border-radius: 50%;
  background: var(--color-bg-secondary, #2a2a2a);
  color: var(--color-text, #eee);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  padding: 0;
}
.ctrl-btn-sm:hover {
  border-color: var(--color-primary, #6c8cff);
}
.ctrl-btn-sm.play-btn-sm {
  width: 40px;
  height: 40px;
  background: var(--color-primary, #6c8cff);
  border-color: var(--color-primary, #6c8cff);
  color: #fff;
  font-size: 16px;
}
.ctrl-btn-sm.play-btn-sm:hover {
  filter: brightness(1.1);
}
</style>
