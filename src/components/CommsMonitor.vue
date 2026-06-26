<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useAppStore } from "@/stores/app";
import { useDevicesStore } from "@/stores/devices";
import { useWebSocket } from "@/composables/useWebSocket";
import { useWebRTC } from "@/composables/useWebRTC";

const appStore = useAppStore();
const devicesStore = useDevicesStore();
const { ws, connectedIp, connectedPort, reconnectCount } = useWebSocket();
const {
  webrtcState,
  iceConnectionState,
  iceGatheringState,
  connectionState,
  signalingState,
  dcReadyState,
  dcEverOpened,
  gatheringCompleted,
  localCandidates,
  remoteCandidates,
} = useWebRTC();

// ---- 心跳时间响应式更新 ----
const lastPingAge = ref(0);
let _pingTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  _pingTimer = setInterval(() => {
    lastPingAge.value = appStore._lastPing ? Date.now() - appStore._lastPing : -1;
  }, 1000);
});
onUnmounted(() => {
  if (_pingTimer) clearInterval(_pingTimer);
});

// ---- WebSocket 状态 ----
const wsReadyState = computed(() => {
  const wsVal = ws.value;
  if (!wsVal) return "N/A";
  const states: Record<number, string> = {
    [WebSocket.CONNECTING]: "CONNECTING",
    [WebSocket.OPEN]: "OPEN",
    [WebSocket.CLOSING]: "CLOSING",
    [WebSocket.CLOSED]: "CLOSED",
  };
  return states[wsVal.readyState] ?? String(wsVal.readyState);
});

const wsReadyStateClass = computed(() => {
  const s = wsReadyState.value;
  if (s === "OPEN") return "status-ok";
  if (s === "CONNECTING") return "status-warn";
  return "status-err";
});

// ---- 状态样式映射 ----
function stateClass(s: string): string {
  if (s === "connected" || s === "completed" || s === "complete" || s === "open") return "status-ok";
  if (s === "connecting" || s === "checking" || s === "gathering") return "status-warn";
  if (s === "failed" || s === "closed" || s === "error" || s === "disconnected") return "status-err";
  return "status-neutral";
}

function stateLabel(s: string): string {
  if (s === "new") return "新建";
  if (s === "connected") return "已连接";
  if (s === "completed" || s === "complete") return "已完成";
  if (s === "connecting") return "连接中";
  if (s === "checking") return "检查中";
  if (s === "gathering") return "收集中";
  if (s === "failed") return "失败";
  if (s === "closed") return "已关闭";
  if (s === "disconnected") return "已断开";
  if (s === "idle") return "空闲";
  if (s === "open") return "已打开";
  if (s === "stable") return "稳定";
  if (s === "have-local-offer") return "本地Offer";
  if (s === "have-remote-offer") return "远端Offer";
  if (s === "have-local-pranswer") return "本地临时应答";
  if (s === "have-remote-pranswer") return "远端临时应答";
  return s || "未知";
}

// DataChannel 状态：区分"从未建立"和"打开后关闭"
const dcStateLabel = computed(() => {
  if (dcReadyState.value === "closed" && !dcEverOpened.value) {
    return "未建立";
  }
  return stateLabel(dcReadyState.value);
});

const dcStateClass = computed(() => {
  if (dcReadyState.value === "closed" && !dcEverOpened.value) {
    return "status-neutral";
  }
  return stateClass(dcReadyState.value);
});

// ---- 候选简化显示 ----
function shortCandidate(cand: string): string {
  // 提取 IP:port
  const m = cand.match(/(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+typ\s+(\w+)/);
  if (m) return `${m[1]}:${m[2]} (${m[3]})`;
  // 回退到前 50 个字符
  return cand.length > 50 ? cand.substring(0, 50) + "..." : cand;
}
</script>

<template>
  <div class="comms-monitor">
    <div class="monitor-section">
      <div class="section-title">WebSocket 信令</div>
      <div class="monitor-grid">
        <div class="monitor-row">
          <span class="monitor-label">连接状态</span>
          <span class="monitor-value">
            <span
              :class="[
                'state-dot',
                appStore.connection === 'connected'
                  ? 'dot-ok'
                  : appStore.connection === 'connecting'
                    ? 'dot-warn'
                    : 'dot-err',
              ]"
            ></span>
            {{
              appStore.connection === "connected"
                ? "已连接"
                : appStore.connection === "connecting"
                  ? "连接中"
                  : appStore.connection === "error"
                    ? "错误"
                    : "未连接"
            }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">Socket 状态</span>
          <span class="monitor-value">
            <span :class="['state-dot', wsReadyStateClass]"></span>
            {{ wsReadyState }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">目标地址</span>
          <span class="monitor-value monospace">{{ connectedIp || "--" }}:{{ connectedPort || "--" }}</span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">协议版本</span>
          <span class="monitor-value">v1</span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">重连次数</span>
          <span class="monitor-value">{{ reconnectCount }}</span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">上次心跳</span>
          <span class="monitor-value">{{
            lastPingAge >= 0
              ? lastPingAge < 1000
                ? lastPingAge + "ms 前"
                : (lastPingAge / 1000).toFixed(1) + "s 前"
              : "--"
          }}</span>
        </div>
      </div>
    </div>

    <div class="monitor-section">
      <div class="section-title">WebRTC 媒体通道</div>
      <div class="monitor-grid">
        <div class="monitor-row">
          <span class="monitor-label">整体状态</span>
          <span class="monitor-value">
            <span :class="['state-dot', stateClass(webrtcState)]"></span>
            {{ stateLabel(webrtcState) }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">ICE 连接</span>
          <span class="monitor-value">
            <span :class="['state-dot', stateClass(iceConnectionState)]"></span>
            {{ stateLabel(iceConnectionState) }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">ICE 收集</span>
          <span class="monitor-value">
            <span :class="['state-dot', stateClass(iceGatheringState)]"></span>
            {{ stateLabel(iceGatheringState) }}{{ gatheringCompleted ? " ✓" : "" }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">连接状态</span>
          <span class="monitor-value">
            <span :class="['state-dot', stateClass(connectionState)]"></span>
            {{ stateLabel(connectionState) }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">信令状态</span>
          <span class="monitor-value">
            <span :class="['state-dot', signalingState === 'stable' ? 'dot-ok' : 'dot-warn']"></span>
            {{ stateLabel(signalingState) }}
          </span>
        </div>
        <div class="monitor-row">
          <span class="monitor-label">DataChannel</span>
          <span class="monitor-value">
            <span :class="['state-dot', dcStateClass]"></span>
            {{ dcStateLabel }}
          </span>
        </div>
      </div>
      <div class="candidates-row">
        <div class="cand-col">
          <div class="cand-title">本地候选 ({{ localCandidates.length }})</div>
          <div v-if="localCandidates.length > 0" class="cand-list">
            <div v-for="(c, i) in localCandidates" :key="'l' + i" class="cand-item">
              {{ shortCandidate(c) }}
            </div>
          </div>
          <div v-else class="cand-empty">暂无</div>
        </div>
        <div class="cand-col">
          <div class="cand-title">远端候选 ({{ remoteCandidates.length }})</div>
          <div v-if="remoteCandidates.length > 0" class="cand-list">
            <div v-for="(c, i) in remoteCandidates" :key="'r' + i" class="cand-item">
              {{ shortCandidate(c) }}
            </div>
          </div>
          <div v-else class="cand-empty">暂无</div>
        </div>
      </div>
    </div>

    <div v-if="devicesStore.currentDevice" class="monitor-section">
      <div class="section-title">设备信息</div>
      <div class="monitor-grid">
        <div class="monitor-row">
          <span class="monitor-label">设备名称</span>
          <span class="monitor-value">{{ devicesStore.robotInfo?.name || devicesStore.currentDevice.name }}</span>
        </div>
        <div v-if="devicesStore.robotInfo?.robot_id" class="monitor-row">
          <span class="monitor-label">机器人 ID</span>
          <span class="monitor-value monospace">{{ devicesStore.robotInfo.robot_id }}</span>
        </div>
        <div v-if="devicesStore.currentDevice.ip" class="monitor-row">
          <span class="monitor-label">机器人 IP</span>
          <span class="monitor-value monospace"
            >{{ devicesStore.currentDevice.ip }}:{{ devicesStore.currentDevice.port }}</span
          >
        </div>
        <div v-if="devicesStore.robotInfo?.features?.length" class="monitor-row">
          <span class="monitor-label">功能列表</span>
          <span class="monitor-value features">{{ devicesStore.robotInfo.features.join(", ") }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.comms-monitor {
  width: 380px;
  max-width: calc(100vw - 32px);
  max-height: 70vh;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  padding: 12px 14px;
  font-size: 12px;
  line-height: 1.6;
}

.monitor-section {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-light, rgba(128, 128, 128, 0.15));
}
.monitor-section:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.section-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.monitor-grid {
  display: grid;
  gap: 4px;
}

.monitor-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 3px 4px;
  border-radius: var(--radius-sm);
}
.monitor-row:nth-child(even) {
  background: var(--bg-hover, rgba(128, 128, 128, 0.05));
}

.monitor-label {
  color: var(--text-muted);
  flex-shrink: 0;
  margin-right: 8px;
}

.monitor-value {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}

.monospace {
  font-family: var(--font-mono, "SF Mono", "Fira Code", "Consolas", monospace);
  font-size: 11px;
}

.features {
  font-size: 10px;
  word-break: break-all;
}

/* 状态点 */
.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-ok,
.status-ok {
  background: var(--success, #4caf50);
}
.dot-warn,
.status-warn {
  background: var(--warning, #ff9800);
}
.dot-err,
.status-err {
  background: var(--danger, #f44336);
}
.status-neutral {
  background: var(--text-muted, #888);
}

/* 候选列表 */
.candidates-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.cand-col {
  flex: 1;
  min-width: 0;
}
.cand-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.cand-list {
  max-height: 120px;
  overflow-y: auto;
}
.cand-item {
  font-size: 10px;
  font-family: var(--font-mono, "SF Mono", "Fira Code", "Consolas", monospace);
  padding: 2px 4px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: var(--radius-sm);
}
.cand-item:nth-child(odd) {
  background: var(--bg-hover, rgba(128, 128, 128, 0.05));
}
.cand-empty {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}

/* 平板触控优化 */
@media (pointer: coarse) {
  .comms-monitor {
    width: 360px;
    padding: 14px 16px;
  }
  .monitor-row {
    padding: 5px 6px;
  }
}
</style>
