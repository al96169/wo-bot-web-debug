<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, onDeactivated, watch } from "vue";
import { useAppStore } from "@/stores/app";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket, getRemoteFeatures } from "@/composables/useWebSocket";
import { useWebRTC } from "@/composables/useWebRTC";

const appStore = useAppStore();
const robotStore = useRobotStore();
const {
  sendMotion,
  sendMotionStop,
  sendEmergencyStop,
  sendEmergencyRelease,
  sendCamera,
  sendGimbalMoveBegin,
  sendGimbalMoveUpdate,
  sendGimbalMoveEnd,
  sendGimbalCenter,
  requestCameraStatus,
  sendBinary,
  sendCameraCapture,
  sendCameraRecordStart,
  sendCameraRecordStop,
  sendStreamQuality,
} = useWebSocket();
const {
  videoStream0,
  videoStream1,
  webrtcState,
  iceConnectionState,
  iceGatheringState,
  connectionState,
  signalingState,
  dcReadyState,
  localCandidates,
  remoteCandidates,
  markVideoPlaying,
} = useWebRTC();

// 云台功能是否可用（服务端 features 包含 "gimbal"）
const gimbalAvailable = computed(() => getRemoteFeatures().includes("gimbal"));
// 喊话功能是否可用（服务端 features 包含 "voice_broadcast"）
const voiceBroadcastAvailable = computed(() => getRemoteFeatures().includes("voice_broadcast"));
// 拍照/录像功能是否可用（服务端 features 包含 "camera_capture"）
const cameraCaptureAvailable = computed(() => getRemoteFeatures().includes("camera_capture"));

// ---- 拍照 / 录像 (R00034) ----
/** 主摄摄像头 ID（取第一个已注册摄像头，作为录制摄像头） */
const mainCameraId = computed(() => (robotStore.cameras.length > 0 ? robotStore.cameras[0].id : 0));
/** 是否正在录制（状态由服务端 camera_record_status / camera_recording_ui_state 同步） */
const isRecording = computed(() => robotStore.cameraRecord.is_recording);
/** 录制时长（秒） */
const recordElapsed = computed(() => robotStore.cameraRecord.elapsed_s);
/** 录制文件大小 */
const recordFileSize = computed(() => robotStore.cameraRecord.file_size_bytes);
/** 录制中的摄像头是否为主摄（左摄像头 cam 0） */
const mainCameraRecording = computed(
  () =>
    isRecording.value &&
    (robotStore.cameraRecord.camera_id === null || robotStore.cameraRecord.camera_id === mainCameraId.value),
);

/** 格式化录制时长 mm:ss */
function formatRecordTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** 格式化文件大小 */
function formatRecordSize(bytes: number): string {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 拍照：对所有已注册摄像头各拍一张，使用配置中的画质 */
function handleCapture(): void {
  const quality = robotStore.robotConfig?.camera?.capture_quality || "high";
  sendCameraCapture(quality);
  appStore.showToast(`正在拍照 (${qualityLabelMap[quality] || quality})...`, "info");
  robotStore.addCmdLog({
    time: textTime(),
    direction: "send",
    type: "camera_capture",
    data: `拍照 (${qualityLabelMap[quality] || quality})`,
  });
}

/** 录像按钮：切换开始/停止（乐观更新），使用配置中的画质 */
function handleRecordToggle(): void {
  if (isRecording.value) {
    // 停止录像 — 立即更新本地状态
    robotStore.setRecordingUiState(false, robotStore.cameraRecord.camera_id ?? undefined);
    sendCameraRecordStop();
    robotStore.addCmdLog({
      time: textTime(),
      direction: "send",
      type: "camera_record_stop",
      data: "停止录像",
    });
  } else {
    // 开始录像 — 立即更新本地状态，使用配置中的录制画质
    const recordQuality = robotStore.robotConfig?.camera?.record_quality || "high";
    robotStore.setRecordingUiState(true, mainCameraId.value);
    sendCameraRecordStart(mainCameraId.value, recordQuality);
    robotStore.addCmdLog({
      time: textTime(),
      direction: "send",
      type: "camera_record_start",
      data: `开始录像 摄像头${mainCameraId.value} (${qualityLabelMap[recordQuality] || recordQuality})`,
    });
  }
}

/** 画质标签映射 */
const qualityLabelMap: Record<string, string> = { auto: "自动", high: "高画质", medium: "中画质", low: "低画质" };
/** 可选画质列表 */
const qualityOptions: { value: string; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "high", label: "高画质" },
  { value: "medium", label: "中画质" },
  { value: "low", label: "低画质" },
];

/** 切换摄像头直播画质 */
function handleQualityChange(mode: "auto" | "high" | "medium" | "low"): void {
  robotStore.setStreamQuality(mode);
  sendStreamQuality(mode);
  appStore.showToast(`画质切换中: ${qualityLabelMap[mode]}`, "info");
  robotStore.addCmdLog({
    time: textTime(),
    direction: "send",
    type: "camera_stream_quality",
    data: `画质 → ${qualityLabelMap[mode]}`,
  });
}

/** 自动停止录像（切换面板 / 网页切后台时调用） */
function autoStopRecording(): void {
  if (isRecording.value) {
    sendCameraRecordStop();
    robotStore.addCmdLog({
      time: textTime(),
      direction: "send",
      type: "camera_record_stop",
      data: "自动停止录像",
    });
  }
}

// 喊话面板
const broadcastRecording = ref(false);
const broadcastPhoneActive = ref(false);
const broadcastAudioBlob = ref<Blob | null>(null);
const broadcastAudioUrl = ref<string | null>(null);
const broadcastStatus = ref("");
const broadcastCountdown = ref(0);
const previewPlaying = ref(false);

let broadcastRecorder: MediaRecorder | null = null;
let broadcastStream: MediaStream | null = null;
let broadcastPhoneTimer: ReturnType<typeof setInterval> | null = null;
let broadcastCountdownTimer: ReturnType<typeof setInterval> | null = null;
let broadcastChunks: Blob[] = [];
let broadcastAudioCtx: AudioContext | null = null; // 电话模式原始 PCM 捕获

function clearBroadcastCountdown() {
  if (broadcastCountdownTimer) {
    clearInterval(broadcastCountdownTimer);
    broadcastCountdownTimer = null;
  }
  broadcastCountdown.value = 0;
}

function releaseBroadcastMic() {
  if (broadcastStream) {
    broadcastStream.getTracks().forEach((t) => t.stop());
    broadcastStream = null;
  }
}

async function startBroadcastRecord() {
  broadcastAudioBlob.value = null;
  broadcastAudioUrl.value = null;
  broadcastStatus.value = "";
  previewPlaying.value = false;
  broadcastChunks = [];
  clearBroadcastCountdown();
  try {
    broadcastStream = await navigator.mediaDevices
      .getUserMedia({
        audio: { sampleRate: { ideal: 48000 }, channelCount: { ideal: 1 } },
      })
      .catch(() =>
        // 降级：不指定任何约束
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      );
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
    broadcastRecorder = new MediaRecorder(broadcastStream, {
      mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined,
    });
    const captureMimeType = broadcastRecorder.mimeType;
    broadcastRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) broadcastChunks.push(e.data);
    };
    broadcastRecorder.onstop = async () => {
      clearBroadcastCountdown();
      const blob = new Blob(broadcastChunks, { type: captureMimeType });
      broadcastAudioBlob.value = blob;
      broadcastAudioUrl.value = URL.createObjectURL(blob);
      releaseBroadcastMic();
      broadcastStatus.value = "录制完成";
    };
    broadcastRecorder.start();
    broadcastRecording.value = true;
    broadcastStatus.value = "录音中...";
    // 60秒倒计时
    broadcastCountdown.value = 60;
    broadcastCountdownTimer = setInterval(() => {
      broadcastCountdown.value--;
      if (broadcastCountdown.value <= 0) {
        clearBroadcastCountdown();
        alert("最多支持60秒录音");
        if (broadcastRecorder && broadcastRecorder.state !== "inactive") {
          broadcastRecorder.stop();
        }
        broadcastRecording.value = false;
        broadcastRecorder = null;
      }
    }, 1000);
  } catch {
    broadcastStatus.value = "麦克风不可用";
  }
}

function stopBroadcastRecord() {
  clearBroadcastCountdown();
  if (broadcastRecorder && broadcastRecorder.state !== "inactive") {
    broadcastRecorder.stop();
    broadcastRecording.value = false;
    broadcastRecorder = null;
  }
}

async function sendBroadcast() {
  if (!broadcastAudioBlob.value) return;
  try {
    const buffer = await broadcastAudioBlob.value.arrayBuffer();
    const ok = sendBinary("voice_broadcast", { mode: "record", timestamp: Date.now() }, new Uint8Array(buffer));
    broadcastStatus.value = ok ? "已发送" : "发送失败 (无连接)";
    if (!ok) {
      appStore.showToast("喊话发送失败：WebSocket 未连接，请刷新页面重试", "error");
    }
  } catch {
    broadcastStatus.value = "发送失败";
    appStore.showToast("喊话发送失败", "error");
  }
}

function previewBroadcast() {
  if (!broadcastAudioUrl.value || previewPlaying.value) return;
  const audio = new Audio(broadcastAudioUrl.value);
  previewPlaying.value = true;
  audio.onended = () => {
    previewPlaying.value = false;
  };
  audio.onerror = () => {
    previewPlaying.value = false;
  };
  audio.play().catch(() => {
    previewPlaying.value = false;
  });
}

function toggleBroadcastPhone() {
  if (broadcastPhoneActive.value) {
    stopBroadcastPhone();
  } else {
    startBroadcastPhone();
  }
}

async function startBroadcastPhone() {
  broadcastPhoneActive.value = false;
  broadcastChunks = [];
  try {
    broadcastStream = await navigator.mediaDevices
      .getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
        },
      })
      .catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));

    // 用 AudioContext + ScriptProcessorNode 直接捕获原始 PCM，绕过 WebM 编解码
    broadcastAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
    const source = broadcastAudioCtx.createMediaStreamSource(broadcastStream);
    // ScriptProcessorNode: bufferSize=4096, 1 input channel, 1 output channel
    const processor = broadcastAudioCtx.createScriptProcessor(4096, 1, 1);
    const pcmAccumulator: Uint8Array[] = [];

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const inputData = e.inputBuffer.getChannelData(0); // Float32Array
      // Float32 [-1,1] → Int16 PCM，加 5x 增益补偿话筒低输入电平
      const GAIN = 5.0;
      const int16 = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i] * GAIN));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      pcmAccumulator.push(new Uint8Array(int16.buffer));
      // 静音输出通道，避免本地回放造成回声
      e.outputBuffer.getChannelData(0).fill(0);
    };

    source.connect(processor);
    processor.connect(broadcastAudioCtx.destination);

    // 每 200ms 批量发送累积的 PCM 数据
    broadcastPhoneTimer = setInterval(() => {
      if (!broadcastPhoneActive.value || pcmAccumulator.length === 0) return;
      const chunks = pcmAccumulator.splice(0);
      const totalLen = chunks.reduce((s, c) => s + c.byteLength, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.byteLength;
      }
      console.log("[Broadcast Phone] PCM %d bytes, %d frames", totalLen, chunks.length);
      sendBinary(
        "voice_broadcast",
        { mode: "phone", timestamp: Date.now(), format: "pcm_s16le", rate: 48000 },
        combined,
      );
    }, 200);

    broadcastPhoneActive.value = true;
    broadcastStatus.value = "通话中";
  } catch (e) {
    console.error("[Broadcast Phone] start error:", e);
    broadcastStatus.value = "麦克风不可用";
  }
}

function stopBroadcastPhone() {
  broadcastPhoneActive.value = false;
  if (broadcastPhoneTimer) {
    clearInterval(broadcastPhoneTimer);
    broadcastPhoneTimer = null;
  }
  if (broadcastAudioCtx) {
    broadcastAudioCtx.close().catch(() => {});
    broadcastAudioCtx = null;
  }
  if (broadcastRecorder && broadcastRecorder.state !== "inactive") {
    broadcastRecorder.stop();
    broadcastRecorder = null;
  }
  releaseBroadcastMic();
  broadcastStatus.value = "";
}

// ---- WebRTC 监控面板 ----
const showWebRTCInfo = ref(true);
function stateClass(state: string): string {
  const ok = ["connected", "completed", "open"];
  const warn = ["connecting", "checking", "gathering"];
  const err = ["failed", "closed", "disconnected"];
  if (ok.includes(state)) return "state-ok";
  if (warn.includes(state)) return "state-warn";
  if (err.includes(state)) return "state-err";
  return "";
}
function shortCandidate(c: string): string {
  // 提取候选类型和 IP 地址
  const parts = c.split(" ");
  const typIdx = parts.indexOf("typ");
  const type = typIdx >= 0 ? parts[typIdx + 1] : "?";
  const ip = parts.length >= 5 ? parts[4] : "?";
  const port = parts.length >= 6 ? parts[5] : "?";
  return `${type} ${ip}:${port}`;
}

// Refs
const joystickMoveRef = ref<HTMLCanvasElement | null>(null);
const joystickCamLeftRef = ref<HTMLCanvasElement | null>(null);
const joystickYawRef = ref<HTMLCanvasElement | null>(null);
const videoLeftRef = ref<HTMLVideoElement | null>(null);
const videoRightRef = ref<HTMLVideoElement | null>(null);

// Camera states
const cameraLeftOn = ref(false);
const cameraRightOn = ref(false);
const leftCameraId = computed(() => (robotStore.cameras.length > 0 ? 0 : null));
const rightCameraId = computed(() => (robotStore.cameras.length > 1 ? 1 : null));

// video 元素事件回调引用（用于清理）
let _onVid0Stalled: (() => void) | null = null;
let _onVid0Waiting: (() => void) | null = null;
let _onVid1Stalled: (() => void) | null = null;
let _onVid1Waiting: (() => void) | null = null;

function bindVideoEvents(videoEl: HTMLVideoElement, idx: 0 | 1, stream: MediaStream): void {
  // 移除旧监听器
  unbindVideoEvents(videoEl, idx);

  const onStalled = () => {
    console.warn(
      `[Video] cam${idx} stalled, currentTime:${videoEl.currentTime}, paused:${videoEl.paused}, ready:${videoEl.readyState}, network:${videoEl.networkState}`,
    );
    // 尝试恢复：重新绑定 srcObject
    if (videoEl.srcObject) {
      videoEl.srcObject = stream;
      videoEl.play().catch((e) => console.error("[Video] cam" + idx + " stalled恢复播放失败:", e));
    }
  };
  const onWaiting = () => {
    console.warn(
      `[Video] cam${idx} waiting, currentTime:${videoEl.currentTime}, paused:${videoEl.paused}, ready:${videoEl.readyState}, network:${videoEl.networkState}`,
    );
  };

  videoEl.addEventListener("stalled", onStalled);
  videoEl.addEventListener("waiting", onWaiting);

  if (idx === 0) {
    _onVid0Stalled = onStalled;
    _onVid0Waiting = onWaiting;
  } else {
    _onVid1Stalled = onStalled;
    _onVid1Waiting = onWaiting;
  }
}

function unbindVideoEvents(videoEl: HTMLVideoElement, idx: 0 | 1): void {
  const stalled = idx === 0 ? _onVid0Stalled : _onVid1Stalled;
  const waiting = idx === 0 ? _onVid0Waiting : _onVid1Waiting;
  if (stalled) {
    videoEl.removeEventListener("stalled", stalled);
  }
  if (waiting) {
    videoEl.removeEventListener("waiting", waiting);
  }
  if (idx === 0) {
    _onVid0Stalled = null;
    _onVid0Waiting = null;
  } else {
    _onVid1Stalled = null;
    _onVid1Waiting = null;
  }
}

// 绑定 WebRTC 视频流到 <video> 元素（双摄像头独立流）
// 流到达时自动显示，流清空时重置状态
watch(
  videoStream0,
  (stream) => {
    const v = videoLeftRef.value;
    if (stream && v) {
      v.muted = true; // iOS WebKit 需要显式设置才能 autoplay
      v.srcObject = stream;
      v.play().catch((e) => console.error("[Video] cam0 play() 失败:", e));
      bindVideoEvents(v, 0, stream);
      cameraLeftOn.value = true;
      startDebugLoop(0);
      // loadeddata 作为 onunmute 的补充信号：某些浏览器 onunmute 不触发
      v.addEventListener("loadeddata", () => markVideoPlaying(), { once: true });
    } else if (!stream) {
      // 断开连接时重置
      if (v) {
        v.srcObject = null;
        unbindVideoEvents(v, 0);
      }
      cameraLeftOn.value = false;
    }
  },
  { immediate: true, flush: "post" },
);
watch(
  videoStream1,
  (stream) => {
    const v = videoRightRef.value;
    if (stream && v) {
      v.muted = true; // iOS WebKit 需要显式设置才能 autoplay
      v.srcObject = stream;
      v.play().catch((e) => console.error("[Video] cam1 play() 失败:", e));
      bindVideoEvents(v, 1, stream);
      cameraRightOn.value = true;
      startDebugLoop(1);
      // loadeddata 作为 onunmute 的补充信号：某些浏览器 onunmute 不触发
      v.addEventListener("loadeddata", () => markVideoPlaying(), { once: true });
    } else if (!stream) {
      if (v) {
        v.srcObject = null;
        unbindVideoEvents(v, 1);
      }
      cameraRightOn.value = false;
    }
  },
  { immediate: true, flush: "post" },
);

// 视频调试信息
const videoDebug0 = ref<string>("");
const videoDebug1 = ref<string>("");
let _debugTimer0: ReturnType<typeof setInterval> | null = null;
let _debugTimer1: ReturnType<typeof setInterval> | null = null;

function updateVideoDebug(idx: 0 | 1): void {
  const videoEl = idx === 0 ? videoLeftRef.value : videoRightRef.value;
  const dbgRef = idx === 0 ? videoDebug0 : videoDebug1;
  if (!videoEl) return;
  const track = (idx === 0 ? videoStream0.value : videoStream1.value)?.getVideoTracks()?.[0];
  dbgRef.value = [
    `srcObj:${!!videoEl.srcObject}`,
    `pause:${videoEl.paused}`,
    `${videoEl.videoWidth}x${videoEl.videoHeight}`,
    `ready:${videoEl.readyState}`,
    `trk:${track?.readyState ?? "-"}/${track?.enabled ?? "-"}`,
    `muted:${track?.muted ?? "-"}`,
    videoEl.muted ? "vmuted" : "vunmuted",
  ].join(" ");
}

function startDebugLoop(idx: 0 | 1): void {
  const existing = idx === 0 ? _debugTimer0 : _debugTimer1;
  if (existing) return;
  const timer = setInterval(() => {
    updateVideoDebug(idx);
  }, 500);
  if (idx === 0) _debugTimer0 = timer;
  else _debugTimer1 = timer;
  updateVideoDebug(idx);
}
interface JoystickState {
  x: number;
  y: number;
  dragging: boolean;
}

const joystickStates: Record<string, JoystickState> = {
  move: { x: 70, y: 70, dragging: false },
  camLeft: { x: 70, y: 70, dragging: false },
  yaw: { x: 70, y: 70, dragging: false },
  camRight: { x: 70, y: 70, dragging: false },
};

const size = 140;
const cx = size / 2;
const cy = size / 2;
const knobR = 22;

function textTime() {
  return new Date().toLocaleTimeString();
}

function drawJoystick(canvas: HTMLCanvasElement, state: JoystickState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);

  ctx.strokeStyle = "var(--border)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(size, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, size);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 55, 0, Math.PI * 2);
  ctx.strokeStyle = "var(--border-light)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.strokeStyle = "var(--border)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(state.x, state.y, knobR, 0, Math.PI * 2);
  ctx.fillStyle = state.dragging ? "var(--accent)" : "rgba(0, 212, 255, 0.6)";
  ctx.fill();
  ctx.strokeStyle = "var(--accent)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(state.x - 8, state.y);
  ctx.lineTo(state.x + 8, state.y);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(state.x, state.y - 8);
  ctx.lineTo(state.x, state.y + 8);
  ctx.stroke();
}

function getCanvasPos(canvas: HTMLCanvasElement, e: MouseEvent | Touch) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (size / rect.width),
    y: (e.clientY - rect.top) * (size / rect.height),
  };
}

function clampJoystick(pos: { x: number; y: number }) {
  const dx = pos.x - cx,
    dy = pos.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDist = 55 - knobR;
  if (dist > maxDist) {
    const angle = Math.atan2(dy, dx);
    return { x: cx + Math.cos(angle) * maxDist, y: cy + Math.sin(angle) * maxDist };
  }
  return { x: pos.x, y: pos.y };
}

// ==================== 摇杆绑定 ====================

// 共享麦轮运动状态（平移摇杆 + 偏航摇杆合并写入）
const motionState = reactive({ v_x: 0, v_y: 0, v_z: 0 });

function speedFromStick(state: JoystickState, axis: "x" | "y"): number {
  const raw = axis === "y" ? -((state.y - cy) / (cy - knobR)) : (state.x - cx) / (cx - knobR);
  const deadzone = 0.03;
  if (Math.abs(raw) < deadzone) return 0;
  // 用 raw^0.7 代替 sqrt，中心更灵敏：0.2→0.32, 0.5→0.62, 1.0→1.0
  return Math.sign(raw) * Math.pow(Math.abs(raw), 0.7);
}

function sendMergedMotion() {
  const vx = Math.round(motionState.v_x * 1000) / 1000;
  const vy = Math.round(motionState.v_y * 1000) / 1000;
  const vz = Math.round(motionState.v_z * 1000) / 1000;
  sendMotion(vx, vy, vz);
}

function setupJoystick(canvasRef: HTMLCanvasElement, key: string) {
  const canvas = canvasRef;
  const state = joystickStates[key];
  let updateTimer: ReturnType<typeof setInterval> | null = null;

  function gimbalSpeedFromState(): { pan: number; tilt: number } {
    // 摇杆偏移 → 速度 (-1.0 ~ +1.0), 中心=0, 上/右=正
    // sqrt 曲线: 中心附近依然有区分度但不至于过慢，边缘更快
    const rawTilt = -((state.y - cy) / (cy - knobR));
    const rawPan = (state.x - cx) / (cx - knobR);
    const deadzone = 0.05;
    const p = Math.abs(rawPan) < deadzone ? 0 : Math.sign(rawPan) * Math.sqrt(Math.abs(rawPan));
    const t = Math.abs(rawTilt) < deadzone ? 0 : Math.sign(rawTilt) * Math.sqrt(Math.abs(rawTilt));
    return {
      pan: Math.round(p * 1000) / 1000,
      tilt: Math.round(t * 1000) / 1000,
    };
  }

  function onStart(e: MouseEvent | Touch) {
    state.dragging = true;
    const pos = getCanvasPos(canvas, e);
    const clamped = clampJoystick(pos);
    state.x = clamped.x;
    state.y = clamped.y;
    drawJoystick(canvas, state);

    if (key === "move" || key === "yaw") {
      // Rosmaster 需要持续发包维持运动（约 50ms 间隔），否则固件看门狗超时会停机
      if (key === "move") {
        motionState.v_x = speedFromStick(state, "y");
        motionState.v_y = speedFromStick(state, "x");
      } else {
        motionState.v_z = -speedFromStick(state, "x") * 5.0;
      }
      sendMergedMotion();
      updateTimer = setInterval(() => {
        if (!joystickStates[key].dragging) return;
        sendMergedMotion();
      }, 50);
    } else if (key === "camLeft" || key === "camRight") {
      // 云台速度控制
      const spd = gimbalSpeedFromState();
      sendGimbalMoveBegin(spd.pan, spd.tilt);
      updateTimer = setInterval(() => {
        const cur = gimbalSpeedFromState();
        sendGimbalMoveUpdate(cur.pan, cur.tilt);
      }, 50);
    }
  }

  function onMove(e: MouseEvent | Touch) {
    if (!state.dragging) return;
    const pos = getCanvasPos(canvas, e);
    const clamped = clampJoystick(pos);
    state.x = clamped.x;
    state.y = clamped.y;
    drawJoystick(canvas, state);

    if (key === "move") {
      // 平移摇杆: Y→v_x(前后), X→-v_y(左右平移, X3麦轮vy正=左移)
      motionState.v_x = speedFromStick(state, "y");
      motionState.v_y = -speedFromStick(state, "x");
    } else if (key === "yaw") {
      // 偏航摇杆: X→v_z(旋转), Rosmaster v_z 范围 [-5, 5]
      motionState.v_z = -speedFromStick(state, "x") * 5.0;
    }
  }

  function onEnd() {
    state.dragging = false;
    state.x = cx;
    state.y = cy;
    drawJoystick(canvas, state);

    if (key === "move") {
      motionState.v_x = 0;
      motionState.v_y = 0;
      if (motionState.v_z === 0) {
        sendMotionStop();
      } else {
        sendMergedMotion();
      }
    } else if (key === "yaw") {
      motionState.v_z = 0;
      if (motionState.v_x === 0 && motionState.v_y === 0) {
        sendMotionStop();
      } else {
        sendMergedMotion();
      }
    }
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
    }
    // 速度控制: end → 服务端停止移动循环
    if (key === "camLeft" || key === "camRight") {
      sendGimbalMoveEnd();
    }
  }

  canvas.addEventListener("mousedown", (e: MouseEvent) => onStart(e));
  canvas.addEventListener("touchstart", (e: TouchEvent) => {
    e.preventDefault();
    onStart(e.touches[0]);
  });
  window.addEventListener("mousemove", (e: MouseEvent) => {
    if (state.dragging) onMove(e);
  });
  window.addEventListener("touchmove", (e: TouchEvent) => {
    if (state.dragging) {
      e.preventDefault();
      onMove(e.touches[0]);
    }
  });
  window.addEventListener("mouseup", () => onEnd());
  window.addEventListener("touchend", () => onEnd());

  drawJoystick(canvas, state);
}

// ==================== 摄像头操作 ====================

function toggleLeftCamera() {
  const camId = leftCameraId.value;
  if (camId === null || camId === undefined) return;
  cameraLeftOn.value = !cameraLeftOn.value;
  if (cameraLeftOn.value) {
    const v = videoLeftRef.value;
    if (v && videoStream0.value) {
      v.srcObject = null;
      v.srcObject = videoStream0.value;
      v.play().catch((e) => console.error("[Video] cam0 toggle play() 失败:", e));
    }
    sendCamera("start", camId);
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "camera", data: `左摄像头(${camId}) → start` });
    startDebugLoop(0);
  } else {
    sendCamera("stop", camId);
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "camera", data: `左摄像头(${camId}) → stop` });
  }
}

function toggleRightCamera() {
  const camId = rightCameraId.value;
  if (camId === null || camId === undefined) return;
  cameraRightOn.value = !cameraRightOn.value;
  if (cameraRightOn.value) {
    const v = videoRightRef.value;
    if (v && videoStream1.value) {
      v.srcObject = null;
      v.srcObject = videoStream1.value;
      v.play().catch((e) => console.error("[Video] cam1 toggle play() 失败:", e));
    }
    sendCamera("start", camId);
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "camera", data: `右摄像头(${camId}) → start` });
    startDebugLoop(1);
  } else {
    sendCamera("stop", camId);
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "camera", data: `右摄像头(${camId}) → stop` });
  }
}

// ==================== 键盘控制 ====================

const keyboardPressed = new Set<string>();
let keyboardTimer: ReturnType<typeof setInterval> | null = null;

function keyboardSendLoop() {
  const k = keyboardPressed;
  // 平移
  let vx = 0,
    vy = 0;
  if (k.has("w")) vx = k.has("s") ? 0 : 0.6;
  else if (k.has("s")) vx = -0.6;
  if (k.has("a")) vy = k.has("d") ? 0 : 0.6;
  else if (k.has("d")) vy = -0.6;
  motionState.v_x = vx;
  motionState.v_y = vy;

  // 偏航
  let vz = 0;
  if (k.has("q")) vz = k.has("e") ? 0 : 2.5;
  else if (k.has("e")) vz = -2.5;
  motionState.v_z = vz;

  // 可视化: 更新摇杆位置
  const moveSt = joystickStates.move;
  const yawSt = joystickStates.yaw;
  const maxR = 55 - knobR;
  // move: Y→v_x(前后, 上为正), X→-v_y(左右)
  moveSt.y = cy - (vx / 1.0) * maxR;
  moveSt.x = cx + (-vy / 1.0) * maxR;
  moveSt.dragging = vx !== 0 || vy !== 0;
  // yaw: X→v_z(旋转), v_z>0 左转→摇杆左移
  yawSt.x = cx - (vz / 5.0) * maxR;
  yawSt.y = cy;
  yawSt.dragging = vz !== 0;

  if (joystickMoveRef.value) drawJoystick(joystickMoveRef.value, moveSt);
  if (joystickYawRef.value) drawJoystick(joystickYawRef.value, yawSt);

  sendMergedMotion();
}

function startKeyboardLoop() {
  if (keyboardTimer) return;
  keyboardTimer = setInterval(keyboardSendLoop, 50);
}

function stopKeyboardLoop() {
  if (keyboardTimer) {
    clearInterval(keyboardTimer);
    keyboardTimer = null;
  }
  motionState.v_x = 0;
  motionState.v_y = 0;
  motionState.v_z = 0;
  // 复位摇杆可视化
  const moveSt = joystickStates.move;
  moveSt.x = cx;
  moveSt.y = cy;
  moveSt.dragging = false;
  const yawSt = joystickStates.yaw;
  yawSt.x = cx;
  yawSt.y = cy;
  yawSt.dragging = false;
  if (joystickMoveRef.value) drawJoystick(joystickMoveRef.value, moveSt);
  if (joystickYawRef.value) drawJoystick(joystickYawRef.value, yawSt);
  sendMotionStop();
}

function handleKeydown(e: KeyboardEvent) {
  if (!appStore.keyboardEnabled) return;
  const key = e.key.toLowerCase();
  const validKeys = ["w", "a", "s", "d", "q", "e", "r", "f", "z", "x", " "];
  if (!validKeys.includes(key)) return;
  // 云台键盘键（R/F/Z/X）不处理，云台走摇杆
  if (["r", "f", "z", "x"].includes(key)) return;
  e.preventDefault();

  if (key === " ") {
    sendEmergencyStop();
    return;
  }
  if (keyboardPressed.has(key)) return; // 防止按住重复触发
  keyboardPressed.add(key);
  startKeyboardLoop();
}

function handleKeyup(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  keyboardPressed.delete(key);
  // 如果所有运动键都已松开，停止循环
  const motionKeys = ["w", "a", "s", "d", "q", "e"];
  if (motionKeys.every((k) => !keyboardPressed.has(k))) {
    stopKeyboardLoop();
  }
}

// ==================== 通用操作 ====================

function handleAction(action: string) {
  if (action === "emergency") {
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "emergency", data: "急停触发" });
    sendEmergencyStop();
    return;
  }
  if (action === "emergency_release") {
    robotStore.addCmdLog({ time: textTime(), direction: "send", type: "emergency_release", data: "释放急停" });
    sendEmergencyRelease();
    return;
  }
  appStore.toggleAction(action as any);
}

// ==================== 初始化 ====================

/** 浏览器切后台再切回来时，video 元素可能解绑，重新绑定 */
function rebindVideoStreams(): void {
  // 仅当用户之前已开启摄像头时才重新绑定，保留用户的开关状态
  if (videoStream0.value && videoLeftRef.value && cameraLeftOn.value) {
    videoLeftRef.value.muted = true;
    videoLeftRef.value.srcObject = videoStream0.value;
    videoLeftRef.value.play().catch((e) => console.error("[Video] cam0 rebind play() 失败:", e));
    bindVideoEvents(videoLeftRef.value, 0, videoStream0.value);
  }
  if (videoStream1.value && videoRightRef.value && cameraRightOn.value) {
    videoRightRef.value.muted = true;
    videoRightRef.value.srcObject = videoStream1.value;
    videoRightRef.value.play().catch((e) => console.error("[Video] cam1 rebind play() 失败:", e));
    bindVideoEvents(videoRightRef.value, 1, videoStream1.value);
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") {
    rebindVideoStreams();
  } else {
    // 网页切后台时自动停止录像
    autoStopRecording();
  }
}

// 云台摇杆: gimbalAvailable 可能异步到达，用 watch 延迟绑定
// 重连时 _remoteFeatures 被清空再重新填充，需要重置状态重新绑定
let _gimbalJoystickSetup = false;
watch(
  gimbalAvailable,
  (available) => {
    if (available && !_gimbalJoystickSetup && joystickCamLeftRef.value) {
      _gimbalJoystickSetup = true;
      setupJoystick(joystickCamLeftRef.value, "camLeft");
    } else if (!available) {
      _gimbalJoystickSetup = false;
    }
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("keyup", handleKeyup);
  // 绑定平移和偏航摇杆（不需要服务端功能支持）
  if (joystickMoveRef.value) setupJoystick(joystickMoveRef.value, "move");
  if (joystickYawRef.value) setupJoystick(joystickYawRef.value, "yaw");
  // 绑定云台摇杆（gimbalAvailable 可能在此前已变为 true，但 watch immediate 时 ref 还未挂载）
  if (gimbalAvailable.value && !_gimbalJoystickSetup && joystickCamLeftRef.value) {
    _gimbalJoystickSetup = true;
    setupJoystick(joystickCamLeftRef.value, "camLeft");
  }
  // 确保视频流绑定到 video 元素（切换页面回来时可能丢失）
  rebindVideoStreams();
  // 立即启动视频调试信息（每 500ms 刷新）
  startDebugLoop(0);
  startDebugLoop(1);
  // 延迟等待 WebSocket 连接就绪后请求摄像头列表
  setTimeout(() => requestCameraStatus(), 1000);
  // 浏览器切后台再切回来时，video.srcObject 可能断开，重新绑定
  document.addEventListener("visibilitychange", onVisibilityChange);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("keyup", handleKeyup);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  stopKeyboardLoop();
  // 离开页面时断开录音/通话
  stopBroadcastRecord();
  stopBroadcastPhone();
  if (_debugTimer0) {
    clearInterval(_debugTimer0);
    _debugTimer0 = null;
  }
  if (_debugTimer1) {
    clearInterval(_debugTimer1);
    _debugTimer1 = null;
  }
});

// KeepAlive 缓存场景：切换面板时自动挂断录音/通话、停止录像
onDeactivated(() => {
  stopBroadcastRecord();
  stopBroadcastPhone();
  autoStopRecording();
});
</script>

<template>
  <div class="view active">
    <div class="remote-layout">
      <div class="remote-controls">
        <!-- Dual Camera Row -->
        <div class="camera-dual">
          <!-- 左摄像头 -->
          <div class="camera-dual-item">
            <div class="camera-dual-container" :class="{ disabled: !cameraLeftOn, recording: mainCameraRecording }">
              <video ref="videoLeftRef" class="camera-feed" autoplay muted playsinline width="640" height="480"></video>
              <div class="video-debug">{{ videoDebug0 || "等待流..." }}</div>
              <div v-if="!cameraLeftOn" class="camera-placeholder">
                <p>📷 {{ robotStore.cameras[0]?.name || "左摄像头" }}</p>
                <p class="hint">点击开启摄像头</p>
              </div>
              <div v-else-if="!videoStream0" class="camera-placeholder">
                <p>📷 {{ robotStore.cameras[0]?.name || "左摄像头" }}</p>
                <p class="hint" style="color: var(--success)">等待视频流...</p>
              </div>
            </div>
            <div class="camera-controls">
              <button :disabled="leftCameraId === null" @click="toggleLeftCamera">
                {{ cameraLeftOn ? "关闭" : "开启" }}摄像头
              </button>
            </div>
          </div>

          <!-- 右摄像头 -->
          <div class="camera-dual-item">
            <div class="camera-dual-container" :class="{ disabled: !cameraRightOn }">
              <video
                ref="videoRightRef"
                class="camera-feed"
                autoplay
                muted
                playsinline
                width="640"
                height="480"
              ></video>
              <div class="video-debug">{{ videoDebug1 || "等待流..." }}</div>
              <div v-if="rightCameraId === null" class="camera-placeholder">
                <p>📷 右摄像头</p>
                <p class="hint">未检测到摄像头</p>
              </div>
              <div v-else-if="!cameraRightOn" class="camera-placeholder">
                <p>📷 {{ robotStore.cameras[1]?.name || "右摄像头" }}</p>
                <p class="hint">点击开启摄像头</p>
              </div>
              <div v-else-if="!videoStream1" class="camera-placeholder">
                <p>📷 {{ robotStore.cameras[1]?.name || "右摄像头" }}</p>
                <p class="hint" style="color: var(--success)">等待视频流...</p>
              </div>
            </div>
            <div class="camera-controls">
              <button :disabled="rightCameraId === null" @click="toggleRightCamera">
                {{ cameraRightOn ? "关闭" : "开启" }}摄像头
              </button>
            </div>
          </div>
        </div>

        <!-- Controls Row -->
        <div class="control-section">
          <div class="control-mode-selector">
            <label class="keyboard-toggle">
              <input v-model="appStore.keyboardEnabled" type="checkbox" /> 键盘控制
            </label>
          </div>

          <!-- 4 Joysticks -->
          <div class="joystick-container">
            <div class="joystick-group">
              <div class="joystick-wrapper">
                <span class="joystick-label">平移控制</span>
                <canvas ref="joystickMoveRef" class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">W/A/S/D</span>
              </div>
              <div class="joystick-wrapper" :class="{ disabled: !gimbalAvailable }">
                <span class="joystick-label">左云台</span>
                <canvas ref="joystickCamLeftRef" class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">R/F</span>
                <span v-if="!gimbalAvailable" class="joystick-disabled-label">不可用</span>
              </div>
            </div>
            <div class="joystick-group">
              <div class="joystick-wrapper">
                <span class="joystick-label">偏航控制</span>
                <canvas ref="joystickYawRef" class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">Q/E</span>
              </div>
              <div class="joystick-wrapper disabled">
                <span class="joystick-label">右云台</span>
                <canvas class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">Z/X</span>
                <span class="joystick-disabled-label">不可用</span>
              </div>
            </div>
          </div>

          <div class="quick-actions">
            <button
              class="action-btn toggle"
              :class="{ active: appStore.toggleStates.flashlight }"
              @click="handleAction('flashlight')"
            >
              🔦 手电
            </button>
            <button v-if="gimbalAvailable" class="action-btn center" @click="sendGimbalCenter()">🎯 回中</button>
            <button class="action-btn danger" @click="handleAction('emergency')">🛑 急停</button>
            <button class="action-btn center" @click="handleAction('emergency_release')">✅ 释放</button>
            <button
              v-if="cameraCaptureAvailable"
              class="action-btn capture"
              title="拍照（所有已注册摄像头）"
              @click="handleCapture"
            >
              📷 拍照
            </button>
            <button
              v-if="cameraCaptureAvailable"
              class="action-btn record"
              :class="{ recording: isRecording }"
              :title="isRecording ? '停止录像' : '开始录像（主摄）'"
              @click="handleRecordToggle"
            >
              {{ isRecording ? "⏹ 停止" : "⏺ 录像" }}
            </button>
            <select
              class="action-btn quality-select"
              :value="robotStore.streamQuality"
              title="摄像头直播画质"
              @change="handleQualityChange(($event.target as HTMLSelectElement).value as any)"
            >
              <option v-for="opt in qualityOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
          <div v-if="isRecording" class="record-status-row">
            <span class="record-dot"></span>
            REC {{ formatRecordTime(recordElapsed) }} · {{ formatRecordSize(recordFileSize) }}
          </div>
          <div v-if="gimbalAvailable" class="gimbal-status">
            <span class="gimbal-angle">水平: {{ robotStore.gimbal.pan }}°</span>
            <span class="gimbal-angle">俯仰: {{ robotStore.gimbal.tilt }}°</span>
          </div>
          <div class="keyboard-hint">
            <small>W=前进 S=后退 A=左移 D=右移 QE=偏航 RF=左云台 ZX=右云台 空格=急停</small>
          </div>
        </div>

        <!-- 喊话 -->
        <div v-if="voiceBroadcastAvailable" class="broadcast-row">
          <div class="broadcast-row-inner">
            <button
              :class="['broadcast-btn', { recording: broadcastRecording }]"
              @mousedown="startBroadcastRecord"
              @mouseup="stopBroadcastRecord"
              @mouseleave="stopBroadcastRecord"
              @touchstart.prevent="startBroadcastRecord"
              @touchend.prevent="stopBroadcastRecord"
            >
              {{ broadcastRecording ? `🎤 录音中... ${broadcastCountdown}s` : "🎤 录音" }}
            </button>
            <button
              v-if="broadcastAudioUrl"
              :class="['broadcast-btn', 'preview', { playing: previewPlaying }]"
              :disabled="previewPlaying"
              @click="previewBroadcast"
            >
              {{ previewPlaying ? "▶ 播放中" : "🔊 试听" }}
            </button>
            <button :class="['broadcast-btn', 'send']" :disabled="!broadcastAudioBlob" @click="sendBroadcast">
              📤 发送
            </button>
            <button :class="['broadcast-btn', 'phone', { active: broadcastPhoneActive }]" @click="toggleBroadcastPhone">
              {{ broadcastPhoneActive ? "📞 挂断" : "📞 通话" }}
            </button>
            <span v-if="broadcastStatus" class="broadcast-status">{{ broadcastStatus }}</span>
          </div>
        </div>

        <!-- WebRTC 监控面板 -->
        <div class="webrtc-info-panel">
          <div class="webrtc-info-header" @click="showWebRTCInfo = !showWebRTCInfo">
            <span class="webrtc-info-title">WebRTC 连接监控</span>
            <span class="webrtc-info-toggle">{{ showWebRTCInfo ? "▼" : "▶" }}</span>
          </div>
          <div v-if="showWebRTCInfo" class="webrtc-info-body">
            <div class="webrtc-info-grid">
              <div class="webrtc-info-item">
                <span class="info-label">整体状态</span>
                <span class="info-value" :class="stateClass(webrtcState)">{{ webrtcState }}</span>
              </div>
              <div class="webrtc-info-item">
                <span class="info-label">Connection</span>
                <span class="info-value" :class="stateClass(connectionState)">{{ connectionState }}</span>
              </div>
              <div class="webrtc-info-item">
                <span class="info-label">ICE 连接</span>
                <span class="info-value" :class="stateClass(iceConnectionState)">{{ iceConnectionState }}</span>
              </div>
              <div class="webrtc-info-item">
                <span class="info-label">ICE 收集</span>
                <span class="info-value" :class="stateClass(iceGatheringState)">{{ iceGatheringState }}</span>
              </div>
              <div class="webrtc-info-item">
                <span class="info-label">信令状态</span>
                <span class="info-value">{{ signalingState }}</span>
              </div>
              <div class="webrtc-info-item">
                <span class="info-label">DataChannel</span>
                <span class="info-value" :class="stateClass(dcReadyState)">{{ dcReadyState }}</span>
              </div>
            </div>
            <!-- ICE Candidates -->
            <div class="webrtc-candidates">
              <div class="candidates-section">
                <div class="candidates-title">本地 Candidates ({{ localCandidates.length }})</div>
                <div v-if="localCandidates.length" class="candidates-list">
                  <div v-for="(c, i) in localCandidates" :key="'l' + i" class="candidate-item">
                    <span class="cand-idx">#{{ i }}</span>
                    <span class="cand-text">{{ shortCandidate(c) }}</span>
                  </div>
                </div>
                <div v-else class="candidates-empty">等待收集中...</div>
              </div>
              <div class="candidates-section">
                <div class="candidates-title">远端 Candidates ({{ remoteCandidates.length }})</div>
                <div v-if="remoteCandidates.length" class="candidates-list">
                  <div v-for="(c, i) in remoteCandidates" :key="'r' + i" class="candidate-item">
                    <span class="cand-idx">#{{ i }}</span>
                    <span class="cand-text">{{ shortCandidate(c) }}</span>
                  </div>
                </div>
                <div v-else class="candidates-empty">等待中...</div>
              </div>
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
.remote-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}
.remote-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  overflow-y: auto;
}
.camera-dual {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
  min-height: 200px;
}
.camera-dual-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.camera-dual-container {
  flex: 1;
  min-height: 180px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}
.camera-dual-container.disabled {
  opacity: 0.5;
}
.camera-dual-container.disabled .camera-placeholder {
  color: var(--text-muted);
}
.camera-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  background: var(--bg-secondary);
  z-index: 1;
}
.camera-feed {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.video-debug {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 99;
  font-size: 10px;
  font-family: monospace;
  color: #ff0;
  line-height: 1.3;
  background: rgba(0, 0, 0, 0.85);
  padding: 2px 5px;
  border-radius: 2px;
  pointer-events: none;
  white-space: nowrap;
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.camera-placeholder .hint {
  font-size: 12px;
  margin-top: 8px;
}
.camera-controls {
  display: flex;
  gap: 8px;
}
.camera-controls button {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}
.camera-controls button:hover {
  background: var(--bg-hover);
}
.camera-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.capture {
  border-color: var(--accent);
  color: var(--accent);
}
.action-btn.capture:hover {
  background: var(--accent);
  color: var(--bg-primary);
}
.action-btn.record {
  border-color: var(--danger);
  color: var(--danger);
}
.action-btn.record:hover {
  background: var(--danger);
  color: #fff;
}
.action-btn.record.recording {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
  animation: record-pulse 1.5s ease-in-out infinite;
}
/* 画质选择器 */
select.action-btn.quality-select {
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
  padding-right: 24px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 6px center;
  color: var(--accent);
  border-color: var(--accent);
}
select.action-btn.quality-select:hover {
  background-color: var(--accent);
  color: var(--bg-primary);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23000'/%3E%3C/svg%3E");
}
select.action-btn.quality-select option {
  background: var(--bg-card);
  color: var(--text-primary);
}
@keyframes record-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
.record-status-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--danger);
  font-variant-numeric: tabular-nums;
  font-family: "SF Mono", "Fira Code", monospace;
  padding: 4px 0;
}
.record-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  animation: record-blink 1s ease-in-out infinite;
}
@keyframes record-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}
/* 主摄录制时红色边框 */
.camera-dual-container.recording {
  border: 2px solid var(--danger);
  box-shadow:
    0 0 0 2px rgba(255, 60, 60, 0.3),
    0 0 12px rgba(255, 60, 60, 0.4);
  animation: recording-border 1.5s ease-in-out infinite;
}
@keyframes recording-border {
  0%,
  100% {
    box-shadow:
      0 0 0 2px rgba(255, 60, 60, 0.3),
      0 0 12px rgba(255, 60, 60, 0.4);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(255, 60, 60, 0.6),
      0 0 18px rgba(255, 60, 60, 0.6);
  }
}
.joystick-container {
  display: flex;
  gap: 24px;
  justify-content: center;
  align-items: flex-start;
}
.joystick-group {
  display: flex;
  gap: 24px;
}
.joystick-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.joystick-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.joystick-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-family: monospace;
}
.joystick-canvas {
  border-radius: 50%;
  background: var(--bg-tertiary);
  border: 2px solid var(--border);
  cursor: pointer;
  touch-action: none;
}
.joystick-canvas:active {
  border-color: var(--accent);
}
.joystick-wrapper.disabled {
  opacity: 0.35;
  pointer-events: none;
}
.joystick-disabled-label {
  font-size: 9px;
  color: var(--text-muted);
  margin-top: 2px;
}
.control-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 16px;
}
.control-mode-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}
.control-mode-selector select {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
}
.keyboard-toggle {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.quick-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 8px;
  width: 100%;
}
.action-btn {
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.action-btn.toggle.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}
.action-btn.center {
  background: var(--bg-card);
  border-color: var(--accent);
  color: var(--accent);
}
.action-btn.center:hover {
  background: var(--accent);
  color: var(--bg-primary);
}
.action-btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: white;
}
.action-btn.danger:hover {
  background: #ff3344;
}
.gimbal-status {
  display: flex;
  gap: 16px;
  justify-content: center;
  font-size: 12px;
  color: var(--text-secondary);
}
.gimbal-angle {
  font-variant-numeric: tabular-nums;
}
.keyboard-hint {
  font-size: 11px;
  color: var(--text-muted);
}

/* ===== WebRTC 监控面板 ===== */
.webrtc-info-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: 11px;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
}
.webrtc-info-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  cursor: pointer;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  user-select: none;
}
.webrtc-info-header:hover {
  background: var(--bg-hover);
}
.webrtc-info-title {
  font-weight: 600;
  font-size: 12px;
  color: var(--text-primary);
}
.webrtc-info-toggle {
  color: var(--text-muted);
  font-size: 10px;
}
.webrtc-info-body {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.webrtc-info-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 12px;
}
.webrtc-info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}
.info-label {
  color: var(--text-muted);
  font-size: 10px;
}
.info-value {
  color: var(--text-primary);
  font-weight: 500;
  font-size: 11px;
}
.info-value.state-ok {
  color: #4ade80;
}
.info-value.state-warn {
  color: #facc15;
}
.info-value.state-err {
  color: #f87171;
}

.webrtc-candidates {
  display: flex;
  gap: 8px;
}
.candidates-section {
  flex: 1;
  min-width: 0;
}
.candidates-title {
  font-size: 10px;
  color: var(--text-muted);
  margin-bottom: 4px;
  font-weight: 600;
}
.candidates-list {
  max-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.candidate-item {
  display: flex;
  gap: 4px;
  padding: 1px 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
}
.cand-idx {
  color: var(--text-muted);
  font-size: 9px;
  flex-shrink: 0;
}
.cand-text {
  color: var(--text-secondary);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.candidates-empty {
  color: var(--text-muted);
  font-size: 10px;
  font-style: italic;
  padding: 4px;
}

/* ===== 喊话按钮行 ===== */
.broadcast-row {
  padding: 0 16px;
}
.broadcast-row-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.broadcast-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.broadcast-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.broadcast-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.broadcast-btn.recording {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.broadcast-btn.phone.active {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
.broadcast-btn.send {
  border-color: var(--accent);
  color: var(--accent);
}
.broadcast-btn.send:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg-primary);
}
.broadcast-btn.preview {
  border-color: var(--accent);
  color: var(--accent);
}
.broadcast-btn.preview:hover:not(:disabled) {
  background: var(--accent);
  color: var(--bg-primary);
}
.broadcast-btn.preview.playing {
  opacity: 0.6;
}
.broadcast-btn .countdown {
  font-variant-numeric: tabular-nums;
  color: #fff;
  margin-left: 4px;
}
.broadcast-status {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}
</style>
