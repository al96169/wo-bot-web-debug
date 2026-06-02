<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRobotStore } from '@/stores/robot'

const appStore = useAppStore()
const robotStore = useRobotStore()

// Refs
const joystickMoveRef = ref<HTMLCanvasElement | null>(null)
const joystickCamLeftRef = ref<HTMLCanvasElement | null>(null)
const joystickYawRef = ref<HTMLCanvasElement | null>(null)
const joystickCamRightRef = ref<HTMLCanvasElement | null>(null)

// Camera states
const cameraLeftOn = ref(false)
const cameraRightOn = ref(false)
const cameraRecording = ref(false)

// Joystick state
interface JoystickState {
  x: number
  y: number
  dragging: boolean
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

function drawJoystick(canvas: HTMLCanvasElement, state: JoystickState) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, size, size)

  // Grid lines
  ctx.strokeStyle = 'var(--border)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(size, cy)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, 0)
  ctx.lineTo(cx, size)
  ctx.stroke()

  // Outer ring
  ctx.beginPath()
  ctx.arc(cx, cy, 55, 0, Math.PI * 2)
  ctx.strokeStyle = 'var(--border-light)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Inner ring
  ctx.beginPath()
  ctx.arc(cx, cy, 30, 0, Math.PI * 2)
  ctx.strokeStyle = 'var(--border)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.stroke()
  ctx.setLineDash([])

  // Knob
  ctx.beginPath()
  ctx.arc(state.x, state.y, knobR, 0, Math.PI * 2)
  ctx.fillStyle = state.dragging ? 'var(--accent)' : 'rgba(0, 212, 255, 0.6)'
  ctx.fill()
  ctx.strokeStyle = 'var(--accent)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Center crosshair
  ctx.beginPath()
  ctx.moveTo(state.x - 8, state.y)
  ctx.lineTo(state.x + 8, state.y)
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(state.x, state.y - 8)
  ctx.lineTo(state.x, state.y + 8)
  ctx.stroke()
}

function getCanvasPos(canvas: HTMLCanvasElement, e: MouseEvent | Touch) {
  const rect = canvas.getBoundingClientRect()
  const scaleX = size / rect.width
  const scaleY = size / rect.height
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  }
}

function clampJoystick(pos: { x: number; y: number }) {
  const dx = pos.x - cx
  const dy = pos.y - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  const maxDist = 55 - knobR
  if (dist > maxDist) {
    const angle = Math.atan2(dy, dx)
    return { x: cx + Math.cos(angle) * maxDist, y: cy + Math.sin(angle) * maxDist }
  }
  return { x: pos.x, y: pos.y }
}

function setupJoystick(canvasRef: HTMLCanvasElement, key: string) {
  const canvas = canvasRef
  const state = joystickStates[key]

  function onStart(e: MouseEvent | Touch) {
    state.dragging = true
    const pos = getCanvasPos(canvas, e)
    const clamped = clampJoystick(pos)
    state.x = clamped.x
    state.y = clamped.y
    drawJoystick(canvas, state)
  }

  function onMove(e: MouseEvent | Touch) {
    if (!state.dragging) return
    const pos = getCanvasPos(canvas, e)
    const clamped = clampJoystick(pos)
    state.x = clamped.x
    state.y = clamped.y
    drawJoystick(canvas, state)
  }

  function onEnd() {
    state.dragging = false
    state.x = cx
    state.y = cy
    drawJoystick(canvas, state)
  }

  canvas.addEventListener('mousedown', (e: MouseEvent) => onStart(e))
  canvas.addEventListener('touchstart', (e: TouchEvent) => { e.preventDefault(); onStart(e.touches[0]) })
  window.addEventListener('mousemove', (e: MouseEvent) => { if (state.dragging) onMove(e) })
  window.addEventListener('touchmove', (e: TouchEvent) => { if (state.dragging) { e.preventDefault(); onMove(e.touches[0]) } })
  window.addEventListener('mouseup', () => onEnd())
  window.addEventListener('touchend', () => onEnd())

  // Initial draw
  drawJoystick(canvas, state)
}

function toggleLeftCamera() {
  cameraLeftOn.value = !cameraLeftOn.value
}

function toggleRightCamera() {
  cameraRightOn.value = !cameraRightOn.value
}

function toggleCameraRecording() {
  cameraRecording.value = !cameraRecording.value
}

function handleAction(action: string) {
  if (action === 'emergency') return
  appStore.toggleAction(action)
}

onMounted(() => {
  if (joystickMoveRef.value) setupJoystick(joystickMoveRef.value, 'move')
  if (joystickCamLeftRef.value) setupJoystick(joystickCamLeftRef.value, 'camLeft')
  if (joystickYawRef.value) setupJoystick(joystickYawRef.value, 'yaw')
  if (joystickCamRightRef.value) setupJoystick(joystickCamRightRef.value, 'camRight')
})

// Keyboard control
function handleKeydown(e: KeyboardEvent) {
  if (!appStore.keyboardEnabled) return
  // Prevent default for game keys
  const keys = new Set(['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', 'z', 'x', ' '])
  if (!keys.has(e.key.toLowerCase())) return
  e.preventDefault()
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="view active">
    <div class="remote-layout">
      <div class="remote-controls">
        <!-- Dual Camera Row -->
        <div class="camera-dual">
          <div class="camera-dual-item">
            <div class="camera-dual-container" :class="{ disabled: !cameraLeftOn }">
              <div class="camera-placeholder" v-if="!cameraLeftOn">
                <p>📷 左摄像头</p>
                <p class="hint">点击开启摄像头</p>
              </div>
              <div class="camera-placeholder" v-else>
                <p>📷 左摄像头</p>
                <p class="hint" style="color: var(--success);">摄像头已开启</p>
              </div>
            </div>
            <div class="camera-controls">
              <button @click="toggleLeftCamera">{{ cameraLeftOn ? '关闭摄像头' : '开启摄像头' }}</button>
              <button :disabled="!cameraLeftOn">📷 截图</button>
              <button
                :disabled="!cameraLeftOn"
                :class="{ recording: cameraRecording }"
                @click="toggleCameraRecording"
              >⏺️ {{ cameraRecording ? '停止录像' : '录像' }}</button>
              <button @click="appStore.setView('gallery')">🖼️ 图库</button>
            </div>
          </div>
          <div class="camera-dual-item">
            <div class="camera-dual-container disabled">
              <div class="camera-placeholder">
                <p>📷 右摄像头</p>
                <p class="hint">未检测到摄像头</p>
              </div>
            </div>
            <div class="camera-controls">
              <button disabled @click="toggleRightCamera">开启摄像头</button>
              <button disabled>📷 截图</button>
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
              <div class="joystick-wrapper">
                <span class="joystick-label">左摄像头</span>
                <canvas ref="joystickCamLeftRef" class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">R/F</span>
              </div>
            </div>
            <div class="joystick-group">
              <div class="joystick-wrapper">
                <span class="joystick-label">偏航控制</span>
                <canvas ref="joystickYawRef" class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">Q/E</span>
              </div>
              <div class="joystick-wrapper">
                <span class="joystick-label">右摄像头</span>
                <canvas ref="joystickCamRightRef" class="joystick-canvas" width="140" height="140"></canvas>
                <span class="joystick-hint">Z/X</span>
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
            <small>W=前进 S=后退 A=左移 D=右移 QE=偏航 RF=左摄像头 ZX=右摄像头 空格=急停</small>
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
.camera-placeholder .hint { font-size: 12px; margin-top: 8px; }
.camera-feed { width: 100%; height: 100%; object-fit: contain; }
.camera-controls { display: flex; gap: 8px; }
.camera-controls button {
  flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-card); color: var(--text-primary); font-size: 12px; cursor: pointer;
}
.camera-controls button:hover { background: var(--bg-hover); }
.camera-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
.camera-controls button.recording { background: var(--danger); border-color: var(--danger); color: white; }
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
