<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRobotStore } from '@/stores/robot'
import { useWebSocket, getRemoteFeatures } from '@/composables/useWebSocket'
import { useWebRTC } from '@/composables/useWebRTC'

const appStore = useAppStore()
const robotStore = useRobotStore()
const { sendMotion, sendMotionStop, sendEmergencyStop, sendCamera, sendGimbal, sendGimbalMove, sendGimbalMoveBegin, sendGimbalMoveUpdate, sendGimbalMoveEnd, sendGimbalCenter, requestCameraStatus } = useWebSocket()
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

// 共享麦轮运动状态（平移摇杆 + 偏航摇杆合并写入）
const motionState = reactive({ v_x: 0, v_y: 0, v_z: 0 })

function speedFromStick(state: JoystickState, axis: 'x' | 'y'): number {
  const raw = axis === 'y'
    ? -((state.y - cy) / (cy - knobR))
    : ((state.x - cx) / (cx - knobR))
  const deadzone = 0.03
  if (Math.abs(raw) < deadzone) return 0
  // 用 raw^0.7 代替 sqrt，中心更灵敏：0.2→0.32, 0.5→0.62, 1.0→1.0
  return Math.sign(raw) * Math.pow(Math.abs(raw), 0.7)
}

function sendMergedMotion() {
  const vx = Math.round(motionState.v_x * 1000) / 1000
  const vy = Math.round(motionState.v_y * 1000) / 1000
  const vz = Math.round(motionState.v_z * 1000) / 1000
  sendMotion(vx, vy, vz)
}

function setupJoystick(canvasRef: HTMLCanvasElement, key: string) {
  const canvas = canvasRef
  const state = joystickStates[key]
  let updateTimer: ReturnType<typeof setInterval> | null = null

  function gimbalSpeedFromState(): { pan: number; tilt: number } {
    // 摇杆偏移 → 速度 (-1.0 ~ +1.0), 中心=0, 上/右=正
    // sqrt 曲线: 中心附近依然有区分度但不至于过慢，边缘更快
    const rawTilt = -((state.y - cy) / (cy - knobR))
    const rawPan = (state.x - cx) / (cx - knobR)
    const deadzone = 0.05
    const p = Math.abs(rawPan) < deadzone ? 0 : Math.sign(rawPan) * Math.sqrt(Math.abs(rawPan))
    const t = Math.abs(rawTilt) < deadzone ? 0 : Math.sign(rawTilt) * Math.sqrt(Math.abs(rawTilt))
    return {
      pan: Math.round(p * 1000) / 1000,
      tilt: Math.round(t * 1000) / 1000,
    }
  }

  function onStart(e: MouseEvent | Touch) {
    state.dragging = true
    const pos = getCanvasPos(canvas, e)
    const clamped = clampJoystick(pos)
    state.x = clamped.x; state.y = clamped.y
    drawJoystick(canvas, state)

    if (key === 'move' || key === 'yaw') {
      // Rosmaster 需要持续发包维持运动（约 50ms 间隔），否则固件看门狗超时会停机
      if (key === 'move') {
        motionState.v_x = speedFromStick(state, 'y')
        motionState.v_y = speedFromStick(state, 'x')
      } else {
        motionState.v_z = -speedFromStick(state, 'x') * 5.0
      }
      sendMergedMotion()
      updateTimer = setInterval(() => {
        if (!joystickStates[key].dragging) return
        sendMergedMotion()
      }, 50)
    } else if (key === 'camLeft' || key === 'camRight') {
      // 云台速度控制
      const spd = gimbalSpeedFromState()
      sendGimbalMoveBegin(spd.pan, spd.tilt)
      updateTimer = setInterval(() => {
        const cur = gimbalSpeedFromState()
        sendGimbalMoveUpdate(cur.pan, cur.tilt)
      }, 50)
    }
  }

  function onMove(e: MouseEvent | Touch) {
    if (!state.dragging) return
    const pos = getCanvasPos(canvas, e)
    const clamped = clampJoystick(pos)
    state.x = clamped.x; state.y = clamped.y
    drawJoystick(canvas, state)

    if (key === 'move') {
      // 平移摇杆: Y→v_x(前后), X→-v_y(左右平移, X3麦轮vy正=左移)
      motionState.v_x = speedFromStick(state, 'y')
      motionState.v_y = -speedFromStick(state, 'x')
    } else if (key === 'yaw') {
      // 偏航摇杆: X→v_z(旋转), Rosmaster v_z 范围 [-5, 5]
      motionState.v_z = -speedFromStick(state, 'x') * 5.0
    }
  }

  function onEnd() {
    state.dragging = false
    state.x = cx; state.y = cy
    drawJoystick(canvas, state)

    if (key === 'move') {
      motionState.v_x = 0
      motionState.v_y = 0
      if (motionState.v_z === 0) {
        sendMotionStop()
      } else {
        sendMergedMotion()
      }
    } else if (key === 'yaw') {
      motionState.v_z = 0
      if (motionState.v_x === 0 && motionState.v_y === 0) {
        sendMotionStop()
      } else {
        sendMergedMotion()
      }
    }
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null }
    // 速度控制: end → 服务端停止移动循环
    if (key === 'camLeft' || key === 'camRight') {
      sendGimbalMoveEnd()
    }
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
            <button
              v-if="gimbalAvailable"
              class="action-btn center"
              @click="sendGimbalCenter()"
            >🎯 回中</button>
            <button class="action-btn danger" @click="handleAction('emergency')">🛑 急停</button>
          </div>
          <div v-if="gimbalAvailable" class="gimbal-status">
            <span class="gimbal-angle">水平: {{ robotStore.gimbal.pan }}°</span>
            <span class="gimbal-angle">俯仰: {{ robotStore.gimbal.tilt }}°</span>
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
.quick-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); gap: 8px; width: 100%; }
.action-btn {
  padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 12px; cursor: pointer; transition: all 0.15s;
}
.action-btn:hover { background: var(--bg-hover); border-color: var(--accent); }
.action-btn.toggle.active { background: var(--accent); border-color: var(--accent); color: var(--bg-primary); }
.action-btn.center { background: var(--bg-card); border-color: var(--accent); color: var(--accent); }
.action-btn.center:hover { background: var(--accent); color: var(--bg-primary); }
.action-btn.danger { background: var(--danger); border-color: var(--danger); color: white; }
.action-btn.danger:hover { background: #ff3344; }
.gimbal-status {
  display: flex; gap: 16px; justify-content: center;
  font-size: 12px; color: var(--text-secondary);
}
.gimbal-angle { font-variant-numeric: tabular-nums; }
.keyboard-hint { font-size: 11px; color: var(--text-muted); }
</style>
