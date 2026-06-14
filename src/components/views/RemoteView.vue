<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRobotStore } from '@/stores/robot'
import { useWebSocket, getRemoteFeatures } from '@/composables/useWebSocket'
import { useWebRTC } from '@/composables/useWebRTC'

const appStore = useAppStore()
const robotStore = useRobotStore()
const { sendMotion, sendMotionStop, sendEmergencyStop, sendCamera, sendGimbal, sendGimbalMove, requestCameraStatus } = useWebSocket()
const { videoStream0, videoStream1, reconnect: reconnectWebRTC } = useWebRTC()

// 云台功能是否可用（服务端 features 包含 "gimbal"）
const gimbalAvailable = computed(() => getRemoteFeatures().includes('gimbal'))

// Refs
const joystickMoveRef = ref<HTMLCanvasElement | null>(null)
const joystickCamLeftRef = ref<HTMLCanvasElement | null>(null)
const joystickYawRef = ref<HTMLCanvasElement | null>(null)
const videoLeftRef = ref<HTMLVideoElement | null>(null)
const videoRightRef = ref<HTMLVideoElement | null>(null)

// Camera states
const cameraLeftOn = ref(false)
const cameraRightOn = ref(false)
const leftCameraId = computed(() => robotStore.cameras.length > 0 ? 0 : null)
const rightCameraId = computed(() => robotStore.cameras.length > 1 ? 1 : null)

// 绑定 WebRTC 视频流到 <video> 元素（双摄像头独立流）
// 视频元素始终在 DOM 中（通过 CSS 显隐），避免 v-if 销毁重建导致 ref 时序问题
watch(videoStream0, (stream) => {
  if (stream && videoLeftRef.value) {
    videoLeftRef.value.srcObject = stream
    videoLeftRef.value.play().catch(() => {})
  }
}, { immediate: true, flush: 'post' })
watch(videoStream1, (stream) => {
  if (stream && videoRightRef.value) {
    videoRightRef.value.srcObject = stream
    videoRightRef.value.play().catch(() => {})
  }
}, { immediate: true, flush: 'post' })

// Joystick state
interface JoystickState {
  x: number; y: number; dragging: boolean
}

const joystickStates: Record<string, JoystickState> = {
  move: { x: 70, y: 70, dragging: false },
  camLeft: { x: 70, y: 70, dragging: false },
  yaw: { x: 70, y: 70, dragging: false },
  camRight: { x: 70, y: 70, dragging: false },
}

const size = 140
const cx = size / 2
const cy = size / 2
const knobR = 22

function textTime() { return new Date().toLocaleTimeString() }

function drawJoystick(canvas: HTMLCanvasElement, state: JoystickState) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, size, size)

  ctx.strokeStyle = 'var(--border)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(size, cy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, size); ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, 55, 0, Math.PI * 2)
  ctx.strokeStyle = 'var(--border-light)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, 30, 0, Math.PI * 2)
  ctx.strokeStyle = 'var(--border)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([])

  ctx.beginPath()
  ctx.arc(state.x, state.y, knobR, 0, Math.PI * 2)
  ctx.fillStyle = state.dragging ? 'var(--accent)' : 'rgba(0, 212, 255, 0.6)'
  ctx.fill()
  ctx.strokeStyle = 'var(--accent)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(state.x - 8, state.y); ctx.lineTo(state.x + 8, state.y)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(state.x, state.y - 8); ctx.lineTo(state.x, state.y + 8)
  ctx.stroke()
}

function getCanvasPos(canvas: HTMLCanvasElement, e: MouseEvent | Touch) {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (e.clientX - rect.left) * (size / rect.width),
    y: (e.clientY - rect.top) * (size / rect.height),
  }
}

function clampJoystick(pos: { x: number; y: number }) {
  const dx = pos.x - cx, dy = pos.y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  const maxDist = 55 - knobR
  if (dist > maxDist) {
    const angle = Math.atan2(dy, dx)
    return { x: cx + Math.cos(angle) * maxDist, y: cy + Math.sin(angle) * maxDist }
  }
  return { x: pos.x, y: pos.y }
}

// ==================== 摇杆绑定 ====================

function setupJoystick(canvasRef: HTMLCanvasElement, key: string) {
  const canvas = canvasRef
  const state = joystickStates[key]
  let lastPan = 90, lastTilt = 90
  let moveTimer: ReturnType<typeof setInterval> | null = null

  function onStart(e: MouseEvent | Touch) {
    state.dragging = true
    const pos = getCanvasPos(canvas, e)
    const clamped = clampJoystick(pos)
    state.x = clamped.x; state.y = clamped.y
    drawJoystick(canvas, state)

    // 云台摇杆：增量模式 - 根据摇杆位置计算方向增量
    if (key === 'camLeft' || key === 'camRight') {
      moveTimer = setInterval(() => sendGimbalDelta(state), 100)
    }
  }

  function onMove(e: MouseEvent | Touch) {
    if (!state.dragging) return
    const pos = getCanvasPos(canvas, e)
    const clamped = clampJoystick(pos)
    state.x = clamped.x; state.y = clamped.y
    drawJoystick(canvas, state)

    if (key === 'move' || key === 'yaw') {
      const linear = -((clamped.y - cy) / (cy - knobR))
      const angular = ((clamped.x - cx) / (cx - knobR))
      sendMotion(Math.round(linear * 100) / 100, Math.round(angular * 100) / 100)
    }
  }

  function onEnd() {
    state.dragging = false
    state.x = cx; state.y = cy
    drawJoystick(canvas, state)

    if (key === 'move' || key === 'yaw') {
      sendMotionStop()
    }
    if (moveTimer) { clearInterval(moveTimer); moveTimer = null }
  }

  function sendGimbalDelta(js: JoystickState) {
    // 增量模式: 摇杆偏移量 → delta值 (-1.0 ~ +1.0)
    // 摇杆中心=0, 上/右=+1, 下/左=-1
    const tiltDelta = -((js.y - cy) / (cy - knobR))  // 上=正(抬头)
    const panDelta = (js.x - cx) / (cx - knobR)       // 右=正(右转)
    // 死区
    const deadzone = 0.05
    const p = Math.abs(panDelta) < deadzone ? 0 : panDelta
    const t = Math.abs(tiltDelta) < deadzone ? 0 : tiltDelta
    if (p === 0 && t === 0) return
    sendGimbalMove(Math.round(p * 100) / 100, Math.round(t * 100) / 100)
  }

  function sendGimbalAbsolute(pos: { x: number; y: number }) {
    // x=左右=pan(水平), y=上下=tilt(俯仰)
    // 摇杆中心=90°, 向上减少tilt(抬头), 向下增加tilt(低头)
    // 向左减少pan, 向右增加pan
    const tilt = Math.round(90 - ((pos.y - cy) / (cy - knobR)) * 90)
    const pan = Math.round(90 + ((pos.x - cx) / (cx - knobR)) * 90)
    if (pan !== lastPan) { sendGimbal('pan', pan); lastPan = pan }
    if (tilt !== lastTilt) { sendGimbal('tilt', tilt); lastTilt = tilt }
  }

  canvas.addEventListener('mousedown', (e: MouseEvent) => onStart(e))
  canvas.addEventListener('touchstart', (e: TouchEvent) => { e.preventDefault(); onStart(e.touches[0]) })
  window.addEventListener('mousemove', (e: MouseEvent) => { if (state.dragging) onMove(e) })
  window.addEventListener('touchmove', (e: TouchEvent) => { if (state.dragging) { e.preventDefault(); onMove(e.touches[0]) } })
  window.addEventListener('mouseup', () => onEnd())
  window.addEventListener('touchend', () => onEnd())

  drawJoystick(canvas, state)
}

// ==================== 摄像头操作 ====================

function toggleLeftCamera() {
  const camId = leftCameraId.value
  if (camId === null || camId === undefined) return
  cameraLeftOn.value = !cameraLeftOn.value
  const action = cameraLeftOn.value ? 'start' : 'stop'
  robotStore.addCmdLog({ time: textTime(), direction: 'send', type: 'camera', data: `左摄像头(${camId}) → ${action}` })
  // 开启时先重建 WebRTC 连接（新 ontrack → 新 MediaStream），再发 start 命令
  if (cameraLeftOn.value) {
    reconnectWebRTC().then(() => sendCamera(action, camId))
  } else {
    sendCamera(action, camId)
  }
}

function toggleRightCamera() {
  const camId = rightCameraId.value
  if (camId === null || camId === undefined) return
  cameraRightOn.value = !cameraRightOn.value
  const action = cameraRightOn.value ? 'start' : 'stop'
  robotStore.addCmdLog({ time: textTime(), direction: 'send', type: 'camera', data: `右摄像头(${camId}) → ${action}` })
  if (cameraRightOn.value) {
    reconnectWebRTC().then(() => sendCamera(action, camId))
  } else {
    sendCamera(action, camId)
  }
}

// ==================== 键盘 ====================

function handleKeydown(e: KeyboardEvent) {
  if (!appStore.keyboardEnabled) return
  const keys = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'z', 'x', ' '])
  if (!keys.has(e.key.toLowerCase())) return
  e.preventDefault()
}

// ==================== 通用操作 ====================

function handleAction(action: string) {
  if (action === 'emergency') {
    robotStore.addCmdLog({ time: textTime(), direction: 'send', type: 'emergency', data: '急停触发' })
    sendEmergencyStop()
    return
  }
  appStore.toggleAction(action)
}

// ==================== 初始化 ====================

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  // 绑定所有摇杆
  if (joystickMoveRef.value) setupJoystick(joystickMoveRef.value, 'move')
  // 云台仅在服务端支持时绑定左摇杆，右侧摇杆保持不可用
  if (joystickCamLeftRef.value && gimbalAvailable.value) setupJoystick(joystickCamLeftRef.value, 'camLeft')
  if (joystickYawRef.value) setupJoystick(joystickYawRef.value, 'yaw')
  // 右云台摇杆不绑定，保持不可用
  // 延迟等待 WebSocket 连接就绪后请求摄像头列表
  setTimeout(() => requestCameraStatus(), 1000)
})

onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="view active">
    <div class="remote-layout">
      <div class="remote-controls">
        <!-- Dual Camera Row -->
        <div class="camera-dual">
          <!-- 左摄像头 -->
          <div class="camera-dual-item">
            <div class="camera-dual-container" :class="{ disabled: !cameraLeftOn }">
              <video
                ref="videoLeftRef"
                class="camera-feed"
                :class="{ hidden: !cameraLeftOn || !videoStream0 }"
                autoplay playsinline muted
              ></video>
              <div class="camera-placeholder" v-if="!cameraLeftOn">
                <p>📷 {{ robotStore.cameras[0]?.name || '左摄像头' }}</p>
                <p class="hint">点击开启摄像头</p>
              </div>
              <div class="camera-placeholder" v-else-if="!videoStream0">
                <p>📷 {{ robotStore.cameras[0]?.name || '左摄像头' }}</p>
                <p class="hint" style="color: var(--success);">等待视频流...</p>
              </div>
            </div>
            <div class="camera-controls">
              <button @click="toggleLeftCamera" :disabled="leftCameraId === null">
                {{ cameraLeftOn ? '关闭' : '开启' }}摄像头
              </button>
            </div>
          </div>

          <!-- 右摄像头 -->
          <div class="camera-dual-item">
            <div class="camera-dual-container" :class="{ disabled: !cameraRightOn }">
              <video
                ref="videoRightRef"
                class="camera-feed"
                :class="{ hidden: !cameraRightOn || !videoStream1 }"
                autoplay playsinline muted
              ></video>
              <div class="camera-placeholder" v-if="rightCameraId === null">
                <p>📷 右摄像头</p>
                <p class="hint">未检测到摄像头</p>
              </div>
              <div class="camera-placeholder" v-else-if="!cameraRightOn">
                <p>📷 {{ robotStore.cameras[1]?.name || '右摄像头' }}</p>
                <p class="hint">点击开启摄像头</p>
              </div>
              <div class="camera-placeholder" v-else-if="!videoStream1">
                <p>📷 {{ robotStore.cameras[1]?.name || '右摄像头' }}</p>
                <p class="hint" style="color: var(--success);">等待视频流...</p>
              </div>
            </div>
            <div class="camera-controls">
              <button @click="toggleRightCamera" :disabled="rightCameraId === null">
                {{ cameraRightOn ? '关闭' : '开启' }}摄像头
              </button>
            </div>
          </div>
        </div>

        <!-- Controls Row -->
        <div class="control-section">
          <div class="control-mode-selector">
            <label class="keyboard-toggle">
              <input type="checkbox" v-model="appStore.keyboardEnabled" /> 键盘控制
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
            >🔦 手电</button>
            <button class="action-btn danger" @click="handleAction('emergency')">🛑 急停</button>
          </div>
          <div class="keyboard-hint">
            <small>W=前进 S=后退 A=左移 D=右移 QE=偏航 RF=左云台 ZX=右云台 空格=急停</small>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { display: none; }
.view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
.remote-layout { display: flex; flex-direction: column; gap: 16px; height: 100%; }
.remote-controls { display: flex; flex-direction: column; gap: 16px; min-width: 0; overflow-y: auto; }
.camera-dual { display: flex; gap: 12px; flex-shrink: 0; min-height: 200px; }
.camera-dual-item { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.camera-dual-container {
  flex: 1; min-height: 180px; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.camera-dual-container.disabled { opacity: 0.5; }
.camera-dual-container.disabled .camera-placeholder { color: var(--text-muted); }
.camera-placeholder { text-align: center; color: var(--text-muted); }
.camera-feed { width: 100%; height: 100%; object-fit: cover; }
.camera-feed.hidden { display: none; }
.camera-placeholder .hint { font-size: 12px; margin-top: 8px; }
.camera-controls { display: flex; gap: 8px; }
.camera-controls button {
  flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 12px; cursor: pointer;
}
.camera-controls button:hover { background: var(--bg-hover); }
.camera-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
.joystick-container { display: flex; gap: 24px; justify-content: center; align-items: flex-start; }
.joystick-group { display: flex; gap: 24px; }
.joystick-wrapper { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.joystick-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.joystick-hint { font-size: 10px; color: var(--text-muted); font-family: monospace; }
.joystick-canvas {
  border-radius: 50%;
  background: var(--bg-tertiary);
  border: 2px solid var(--border);
  cursor: pointer;
  touch-action: none;
}
.joystick-canvas:active { border-color: var(--accent); }
.joystick-wrapper.disabled { opacity: 0.35; pointer-events: none; }
.joystick-disabled-label { font-size: 9px; color: var(--text-muted); margin-top: 2px; }
.control-section { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; }
.control-mode-selector { display: flex; align-items: center; gap: 12px; width: 100%; flex-wrap: wrap; }
.control-mode-selector select {
  background: var(--bg-card); border: 1px solid var(--border);
  color: var(--text-primary); padding: 6px 12px; border-radius: var(--radius-md); font-size: 13px;
}
.keyboard-toggle { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.quick-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; }
.action-btn {
  padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.action-btn:hover { background: var(--bg-hover); border-color: var(--accent); }
.action-btn.toggle.active { background: var(--accent); border-color: var(--accent); color: var(--bg-primary); }
.action-btn.danger { background: var(--danger); border-color: var(--danger); color: white; }
.action-btn.danger:hover { background: #ff3344; }
.keyboard-hint { font-size: 11px; color: var(--text-muted); }
</style>
