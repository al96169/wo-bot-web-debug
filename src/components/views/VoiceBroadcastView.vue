<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";

const { sendBinary } = useWebSocket();

// ---- 状态 ----
const mode = ref<"record" | "phone">("record");
const recording = ref(false);
const phoneActive = ref(false);
const recordDuration = ref(0);
const audioBlob = ref<Blob | null>(null);
const audioUrl = ref<string | null>(null);
const playing = ref(false);
const statusText = ref("");
const statusClass = ref<"info" | "success" | "error">("info");

let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
let phoneChunks: Blob[] = [];

const MAX_DURATION = 30; // 秒

// ---- 释放麦克风 ----
function releaseMic() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
}

onUnmounted(() => {
  stopPhoneMode();
  releaseMic();
});

// ---- 录音发送模式 ----
async function startRecording() {
  audioBlob.value = null;
  audioUrl.value = null;
  recordDuration.value = 0;
  statusText.value = "";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 48000, channelCount: 1, echoCancellation: false },
    });

    // 多种 MIME 类型兼容
    const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    let mimeType = "";
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        mimeType = mt;
        break;
      }
    }

    const chunks: Blob[] = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType || undefined });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mediaRecorder!.mimeType });
      audioBlob.value = blob;
      audioUrl.value = URL.createObjectURL(blob);
      recording.value = false;
      releaseMic();
      statusText.value = `录音完成 (${formatDuration(recordDuration.value)})`;
      statusClass.value = "success";

      // 自动发送
      sendAudio(blob);
    };

    mediaRecorder.start();
    recording.value = true;
    statusText.value = "录音中...";
    statusClass.value = "info";

    // 时长计时器
    const startTime = Date.now();
    durationTimer = setInterval(() => {
      recordDuration.value = Math.floor((Date.now() - startTime) / 1000);
      if (recordDuration.value >= MAX_DURATION) {
        stopRecording();
      }
    }, 200);
  } catch (err: any) {
    statusText.value = "无法访问麦克风: " + (err.message || "未知错误");
    statusClass.value = "error";
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

async function replayAudio() {
  if (!audioUrl.value) return;
  const audio = new Audio(audioUrl.value);
  playing.value = true;
  statusText.value = "试听中...";
  statusClass.value = "info";
  audio.onended = () => {
    playing.value = false;
    statusText.value = "播放完毕";
    statusClass.value = "success";
  };
  audio.onerror = () => {
    playing.value = false;
    statusText.value = "播放失败";
    statusClass.value = "error";
  };
  await audio.play();
}

async function sendAudio(blob: Blob) {
  statusText.value = "发送中...";
  statusClass.value = "info";
  try {
    const buffer = await blob.arrayBuffer();
    sendBinary(
      "voice_broadcast",
      {
        mode: "record",
        timestamp: Date.now(),
      },
      new Uint8Array(buffer),
    );
    statusText.value = "喊话已发送";
    statusClass.value = "success";
  } catch (err: any) {
    statusText.value = "发送失败: " + (err.message || "未知错误");
    statusClass.value = "error";
  }
}

function retryRecording() {
  audioBlob.value = null;
  audioUrl.value = null;
  recordDuration.value = 0;
  statusText.value = "";
}

// ---- 电话模式 ----
async function startPhoneMode() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: false },
    });

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;

    mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType || undefined });

    // 每 500ms 产生一个音频分片，实时发送
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        phoneChunks.push(e.data);
      }
    };

    // 每 400ms 发送累积的音频分片
    const sendInterval = setInterval(async () => {
      if (!phoneActive.value || phoneChunks.length === 0) return;
      const combined = new Blob(phoneChunks, { type: mediaRecorder!.mimeType });
      phoneChunks = [];
      const buffer = await combined.arrayBuffer();
      sendBinary(
        "voice_broadcast",
        {
          mode: "phone",
          timestamp: Date.now(),
        },
        new Uint8Array(buffer),
      );
    }, 400);

    mediaRecorder.start(400); // 每 400ms 采集一次

    phoneActive.value = true;
    statusText.value = "电话模式已开启";
    statusClass.value = "info";

    // 存储 sendInterval 的引用以便清理
    (mediaRecorder as any)._sendInterval = sendInterval;
  } catch (err: any) {
    statusText.value = "无法访问麦克风: " + (err.message || "未知错误");
    statusClass.value = "error";
  }
}

function stopPhoneMode() {
  phoneActive.value = false;
  if (mediaRecorder) {
    const sendInterval = (mediaRecorder as any)._sendInterval;
    if (sendInterval) clearInterval(sendInterval);
    if (mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    mediaRecorder = null;
  }
  phoneChunks = [];
  releaseMic();
  statusText.value = "电话模式已关闭";
  statusClass.value = "info";
}

function togglePhoneMode() {
  if (phoneActive.value) {
    stopPhoneMode();
  } else {
    startPhoneMode();
  }
}

// ---- 工具函数 ----
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
</script>

<template>
  <div class="voice-broadcast-view">
    <h2 class="view-title">📢 喊话</h2>
    <p class="view-desc">录音或实时电话，发送语音到机器人扬声器播放</p>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button :class="{ active: mode === 'record' }" @click="mode = 'record'">录音发送</button>
      <button :class="{ active: mode === 'phone' }" @click="mode = 'phone'">电话模式</button>
    </div>

    <!-- 录音发送模式 -->
    <div v-if="mode === 'record'" class="card">
      <div class="record-panel">
        <!-- 未录音：开始按钮 -->
        <div v-if="!recording && !audioBlob" class="record-idle">
          <button class="record-btn" @click="startRecording">
            <span class="record-icon">🎙️</span>
            <span>开始录音</span>
          </button>
          <p class="hint">最长录音 {{ MAX_DURATION }} 秒</p>
        </div>

        <!-- 录音中 -->
        <div v-if="recording" class="record-active">
          <div class="recording-indicator">
            <span class="pulse-dot"></span>
            <span>录音中... {{ formatDuration(recordDuration) }}</span>
          </div>
          <div class="waveform-bar">
            <div
              v-for="i in 20"
              :key="i"
              class="wave-bar"
              :style="{ animationDelay: i * 0.08 + 's', height: 20 + Math.sin(i * 0.5 + Date.now() / 300) * 15 + 'px' }"
            ></div>
          </div>
          <progress class="duration-bar" :value="recordDuration" :max="MAX_DURATION"></progress>
          <button class="stop-btn" @click="stopRecording">停止并发送</button>
        </div>

        <!-- 录音完成 -->
        <div v-if="audioBlob && !recording" class="record-done">
          <div class="done-info">
            <span class="done-icon">✅</span>
            <span>已录制 {{ formatDuration(recordDuration) }}</span>
          </div>
          <div class="playback-row">
            <button :disabled="playing" class="action-btn" @click="replayAudio">
              {{ playing ? "播放中..." : "🔊 试听" }}
            </button>
            <button class="action-btn secondary" @click="sendAudio(audioBlob!)">📤 重新发送</button>
            <button class="action-btn secondary" @click="retryRecording">🔄 重新录制</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 电话模式 -->
    <div v-if="mode === 'phone'" class="card">
      <div class="phone-panel">
        <button :class="['phone-btn', { active: phoneActive }]" @click="togglePhoneMode">
          <span class="phone-icon">{{ phoneActive ? "🔴" : "📞" }}</span>
          <span>{{ phoneActive ? "挂断" : "开始通话" }}</span>
        </button>
        <p class="hint">{{ phoneActive ? "通话中... 说话即可发送到机器人" : "点击开始后无需按住，说话实时推送" }}</p>
      </div>
    </div>

    <!-- 状态栏 -->
    <div v-if="statusText" :class="['status-bar', statusClass]">
      {{ statusText }}
    </div>
  </div>
</template>

<style scoped>
.voice-broadcast-view {
  max-width: 520px;
  margin: 0 auto;
  padding: 24px;
}
.view-title {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 4px;
  color: var(--text-primary);
}
.view-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 20px;
}

/* ---- 模式切换 ---- */
.mode-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 20px;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border);
}
.mode-tabs button {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.mode-tabs button.active {
  background: var(--accent);
  color: #fff;
}
.mode-tabs button:not(:last-child) {
  border-right: 1px solid var(--border);
}

/* ---- 卡片 ---- */
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 24px;
  margin-bottom: 16px;
}

/* ---- 录音面板 ---- */
.record-panel {
  text-align: center;
}
.record-idle {
  padding: 16px 0;
}
.record-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 48px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.record-btn:hover {
  border-color: var(--accent);
  background: rgba(0, 212, 255, 0.05);
}
.record-icon {
  font-size: 32px;
}

/* 录音中 */
.record-active {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.recording-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  color: var(--danger);
  font-weight: 500;
}
.pulse-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--danger);
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.8);
  }
}
.waveform-bar {
  display: flex;
  gap: 3px;
  align-items: flex-end;
  height: 50px;
  justify-content: center;
}
.wave-bar {
  width: 5px;
  background: var(--accent);
  border-radius: 2px;
  animation: wave 0.6s ease-in-out infinite alternate;
}
@keyframes wave {
  from {
    opacity: 0.4;
  }
  to {
    opacity: 1;
  }
}
.duration-bar {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-tertiary);
}
.duration-bar::-webkit-progress-value {
  background: var(--danger);
  border-radius: 2px;
}
.stop-btn {
  padding: 10px 32px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--danger);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
}
.stop-btn:hover {
  opacity: 0.9;
}

/* 录音完成 */
.record-done {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.done-info {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  font-size: 14px;
  color: var(--success);
}
.done-icon {
  font-size: 20px;
}
.playback-row {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}
.action-btn {
  padding: 10px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: rgba(0, 212, 255, 0.05);
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn.secondary {
  color: var(--text-secondary);
}

/* ---- 电话模式 ---- */
.phone-panel {
  text-align: center;
  padding: 16px 0;
}
.phone-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 48px;
  border: 2px solid var(--success);
  border-radius: var(--radius-lg);
  background: var(--bg-tertiary);
  color: var(--success);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.phone-btn.active {
  border-color: var(--danger);
  color: var(--danger);
  background: rgba(255, 68, 68, 0.05);
}
.phone-btn:hover {
  opacity: 0.85;
}
.phone-icon {
  font-size: 32px;
}
.hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 12px;
}

/* ---- 状态栏 ---- */
.status-bar {
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  text-align: center;
}
.status-bar.info {
  background: rgba(0, 212, 255, 0.08);
  color: var(--accent);
}
.status-bar.success {
  background: rgba(0, 200, 83, 0.08);
  color: var(--success);
}
.status-bar.error {
  background: rgba(255, 68, 68, 0.08);
  color: var(--danger);
}
</style>
