import { ref, type Ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useDevicesStore } from '../stores/devices'
import { useRobotStore, type CameraInfo } from '../stores/robot'
import { resolveWebRTCAnswer, handleWebRTCIceCandidate } from './useWebRTC'
import type { Module, Software } from '../types'

/* ============================================================
 * wo-bot-web-debug - WebSocket + WebRTC 通信层
 *
 * WebSocket 承载: 设备发现握手 + WebRTC 信令 + 所有业务消息
 * WebRTC DataChannel: 优先级更高，就绪时使用；未就绪时 WebSocket 降级
 * ============================================================ */

const CONNECT_TIMEOUT = 5000
const RECONNECT_DELAY = 3000
const MAX_RECONNECT = 30  // WiFi 切换后可能需要更长时间恢复

// ---- 模块级单例 ----
let _ws: WebSocket | null = null
let _connectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _connectedIp = ''
let _connectedPort = 0
let _token = ''

/** 重连时触发 WebRTC 握手（由 App.vue 设置） */
let _onReconnect: (() => void) | null = null
export function setOnReconnect(fn: (() => void) | null): void {
  _onReconnect = fn
}

interface WsMsg { type: string; data?: Record<string, unknown> }

// ---- 模块级 DataChannel 引用（由 useWebRTC 设置） ----
let _dc: RTCDataChannel | null = null
let _pendingQueue: string[] = []
/** 服务端支持的功能列表（从 connected 消息解析） */
let _remoteFeatures: string[] = []
export function getRemoteFeatures(): string[] { return _remoteFeatures }

/** 响应式 DataChannel 就绪状态（供 Vue computed 使用） */
export const dcReady = ref(false)

export function setDataChannel(dc: RTCDataChannel | null): void {
  _dc = dc
  dcReady.value = dc !== null && dc.readyState === 'open'
  // DC 就绪时，清空待发送队列
  if (dc) {
    dc.addEventListener('open', () => {
      dcReady.value = true
      const q = _pendingQueue
      _pendingQueue = []
      for (const p of q) dc.send(p)
    })
    dc.addEventListener('close', () => { dcReady.value = false })
    // 如果已经打开，立即清空
    if (dc.readyState === 'open') {
      dcReady.value = true
      const q = _pendingQueue
      _pendingQueue = []
      for (const p of q) dc.send(p)
    }
  }
}

export function getSignalingWs(): WebSocket | null {
  return _ws
}

export function getConnectedEndpoint(): { ip: string; port: number } {
  return { ip: _connectedIp, port: _connectedPort }
}

/** 检查 DataChannel 是否就绪 */
export function isDataChannelReady(): boolean {
  return dcReady.value
}

/** 获取当前排队的消息数量 */
export function getPendingQueueSize(): number {
  return _pendingQueue.length
}

/** 设置认证 token（在 connect 前调用） */
export function setAuthToken(token: string): void {
  _token = token
}

// 通用发送：优先 DataChannel；DC 未就绪时用 WebSocket；都不行则暂存队列
function _send(frame: WsMsg): void {
  const payload = JSON.stringify(frame)
  if (_dc && _dc.readyState === 'open') {
    _dc.send(payload)
  } else if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(payload)
  } else {
    _pendingQueue.push(payload)
  }
}

export function useWebSocket() {
  const reconnectCount = ref(0)
  const lastMessage = ref<WsMsg | null>(null)
  const ws = ref<WebSocket | null>(null)

  const appStore = useAppStore()
  const devicesStore = useDevicesStore()
  const robotStore = useRobotStore()

  function connect(ip: string, port: number): void {
    if (_ws) disconnect()
    appStore.connection = 'connecting'
    reconnectCount.value = 0
    _connectedIp = ip
    _connectedPort = port
    let url = `ws://${ip}:${port}`
    if (_token) {
      url += `?token=${encodeURIComponent(_token)}`
    }
    const socket = new WebSocket(url)
    _ws = socket
    ws.value = socket

    _connectTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        socket.close()
        appStore.connection = 'error'
        appStore.showToast(`连接超时: ${ip}:${port}`, 'error')
        robotStore.addLog('error', 'Signaling', `连接超时: ${ip}:${port}`)
        maybeReconnect(ip, port)
      }
    }, CONNECT_TIMEOUT)

    socket.onopen = () => {
      if (_connectTimer) { clearTimeout(_connectTimer); _connectTimer = null }
      appStore.connection = 'connected'
      appStore.showToast('信令通道已建立', 'success')
      reconnectCount.value = 0
      robotStore.addLog('info', 'Signaling', `信令已连接到 ${ip}:${port}`)
      // 清空 WebSocket 待发送队列
      if (_pendingQueue.length > 0) {
        const q = _pendingQueue
        _pendingQueue = []
        for (const p of q) socket.send(p)
      }
      // 自动重连时也触发 WebRTC 握手
      if (_onReconnect) _onReconnect()
    }

    socket.onmessage = (event: MessageEvent) => {
      // 文本消息 = JSON 协议
      try {
        const frame: WsMsg = JSON.parse(event.data as string)
        lastMessage.value = frame
        handleSignalingMessage(frame)
      } catch { robotStore.addLog('warn', 'Signaling', '收到非 JSON 消息') }
    }

    socket.onerror = () => {
      appStore.connection = 'error'
      appStore.showToast(`连接失败: ${ip}:${port}`, 'error')
      robotStore.addLog('error', 'Signaling', `连接错误: ${ip}:${port}`)
    }

    socket.onclose = () => {
      appStore.connection = 'disconnected'
      appStore.setSSHConnected(false)
      robotStore.addLog('warn', 'Signaling', `信令已断开: ${ip}:${port}`)
      maybeReconnect(ip, port)
    }
  }

  function disconnect(): void {
    _clearTimers()
    reconnectCount.value = MAX_RECONNECT
    if (_ws) { _ws.close(); _ws = null }
    ws.value = null
    appStore.connection = 'disconnected'
    appStore.setSSHConnected(false)
    robotStore.addLog('info', 'Signaling', '主动断开信令')
  }

  function maybeReconnect(ip: string, port: number): void {
    if (reconnectCount.value >= MAX_RECONNECT) return
    if (appStore.mockMode) return
    reconnectCount.value++
    robotStore.addLog('info', 'Signaling', `正在尝试重连 (${reconnectCount.value}/${MAX_RECONNECT})...`)
    _reconnectTimer = setTimeout(() => connect(ip, port), RECONNECT_DELAY * reconnectCount.value)
  }

  function _clearTimers(): void {
    if (_connectTimer) { clearTimeout(_connectTimer); _connectTimer = null }
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  }

  /** 处理所有消息（信令 + 业务响应，统一通过 WebSocket） */
  function handleSignalingMessage(msg: WsMsg): void {
    const data = msg.data ?? {}
    switch (msg.type) {
      // ---- 信令层 ----
      case 'connected':
        devicesStore.setRobotInfo({
          robot_id: String(data.robot_id ?? ''), name: String(data.name ?? ''),
          model: String(data.model ?? ''), version: String(data.version ?? ''),
          features: Array.isArray(data.features) ? (data.features as string[]) : [],
        })
        _remoteFeatures = Array.isArray(data.features) ? (data.features as string[]) : []
        // 连接成功后自动订阅状态 + 获取摄像头列表
        _send({ type: 'subscribe', data: { events: ['status'] } })
        requestCameraStatus()
        break
      case 'webrtc_answer':
        resolveWebRTCAnswer(String(data.sdp ?? ''))
        break
      case 'webrtc_ice_candidate':
        handleWebRTCIceCandidate(
          String(data.candidate ?? ''),
          data.sdpMid != null ? String(data.sdpMid) : null,
          data.sdpMLineIndex != null ? Number(data.sdpMLineIndex) : null,
        )
        break

      // ---- 业务响应 ----
      case 'status': {
        const batt = (data.battery ?? {}) as Record<string, unknown>
        const sys = (data.system ?? {}) as Record<string, unknown>
        const net = (data.network ?? {}) as Record<string, unknown>
        robotStore.setSystemStatus({
          battery: { level: Number(batt.level ?? 0), status: String(batt.status ?? 'discharging'), state: batt.level ? `${batt.level}%` : '--', temp: Number(batt.temperature ?? 0) },
          cpu: { usage: Number(sys.cpu_percent ?? 0), temp: Number(sys.temperature ?? 0) },
          memory: { usage: Number(sys.memory_percent ?? 0) },
          disk: { usage: Number(sys.disk_percent ?? 0) },
          wifi: { ssid: String(net.ssid ?? '--'), signal: net.signal_strength != null ? `${net.signal_strength} dBm` : '--', ip: String(net.ip ?? '--') },
          cellular: { signal: '--', carrier: '--' },
          environment: { temperature: '--', humidity: '--', gas: '--', light: '--' },
          uptime: Number(sys.uptime ?? 0), hostname: String(sys.hostname ?? '--'),
        })
        break
      }
      case 'exec_result': {
        const stdout = String(data.stdout ?? ''), stderr = String(data.stderr ?? '')
        if (stdout) robotStore.addSSHOutput({ type: 'out', text: stdout.trim() })
        if (stderr) robotStore.addSSHOutput({ type: 'err', text: stderr.trim() })
        if (data.return_code !== undefined) robotStore.addSSHOutput({ type: 'cmd', text: `[exit: ${data.return_code}]` })
        if (data.cwd !== undefined) robotStore.setShellCwd(String(data.cwd))
        break
      }
      case 'pong':
        appStore._lastPing = Date.now()
        break
      case 'logs': {
        const logs = Array.isArray(data.logs) ? (data.logs as Array<Record<string, unknown>>) : []
        for (const l of logs) {
          const level = (['debug', 'info', 'warn', 'error'].includes(String(l.level)) ? l.level : 'info') as 'debug' | 'info' | 'warn' | 'error'
          robotStore.addLog(level, String(l.source ?? 'remote'), String(l.message ?? ''))
        }
        break
      }
      case 'motion_ack':
        robotStore.addCmdLog({ time: new Date().toLocaleTimeString(), direction: 'recv', type: 'motion', data: `v=${data.linear} ω=${data.angular}` })
        break
      case 'emergency_stop_ack':
        robotStore.addCmdLog({ time: new Date().toLocaleTimeString(), direction: 'recv', type: 'emergency', data: '急停已确认' })
        appStore.showToast('急停已触发', 'error')
        break
      case 'system_ack':
        robotStore.addLog('info', 'System', `${data.action} → ${data.status}`)
        break
      case 'module_list': {
        robotStore.setModules(Array.isArray(data.modules) ? (data.modules as Module[]) : [])
        break
      }
      case 'module_control_ack':
        robotStore.addLog('info', 'Module', `${data.module_id} → ${data.action} (${data.status})`)
        break
      case 'device_control_ack':
        robotStore.addLog('info', 'Device', `${data.action} → ${data.enabled ? 'ON' : 'OFF'}`)
        break
      case 'software_install_ack': case 'software_uninstall_ack': case 'software_upgrade_ack':
        robotStore.addLog('info', 'Software', `${data.package} → ${data.status}`)
        break
      case 'gimbal_status':
        robotStore.addLog('info', 'Gimbal', `云台状态: ${JSON.stringify(data).slice(0, 100)}`)
        break
      case 'camera_status': {
        if (Array.isArray((data as Record<string, unknown>).cameras)) {
          robotStore.setCameras((data as Record<string, unknown>).cameras as CameraInfo[])
        } else if (typeof (data as Record<string, unknown>).id === 'number') {
          robotStore.updateCameraStatus(
            (data as Record<string, unknown>).id as number,
            String((data as Record<string, unknown>).status || 'stopped'),
            (data as Record<string, unknown>).stream_url as string | undefined,
          )
        }
        break
      }
      case 'software_list': {
        if (Array.isArray(data.packages)) {
          robotStore.setInstalledSoftware(data.packages as Software[])
        }
        break
      }
      case 'software_search_result': {
        if (Array.isArray(data.packages)) {
          robotStore.setAvailableSoftware(data.packages as Software[])
        }
        break
      }
      case 'error':
        appStore.showToast(`错误: ${String(data.message ?? '未知错误')}`, 'error')
        robotStore.addLog('error', 'Signaling', String(data.message ?? ''))
        break

      // ---- WiFi 管理 ----
      case 'wifi_scan_result': {
        robotStore.setWifiNetworks({
          currentSsid: String(data.current_ssid ?? ''),
          currentDevice: String(data.current_device ?? ''),
          networks: Array.isArray(data.networks) ? (data.networks as Array<{ssid: string; signal: number; security: string; connected: boolean}>) : [],
        })
        break
      }
      case 'wifi_connect_result': {
        const wifiStatus = String(data.status ?? '')
        if (wifiStatus === 'connected') {
          appStore.showToast(`已连接到 ${data.ssid}`, 'success')
          robotStore.addLog('info', 'WiFi', `已连接到 ${data.ssid}`)
        } else {
          appStore.showToast(`WiFi 连接失败: ${data.ssid}`, 'error')
          robotStore.addLog('error', 'WiFi', `连接 ${data.ssid} 失败: ${data.error || data.output || ''}`)
        }
        break
      }
      case 'wifi_disconnect_result':
        appStore.showToast('WiFi 已断开', 'info')
        robotStore.addLog('info', 'WiFi', 'WiFi 已断开')
        break
    }
  }

  /* ---- 便捷发送（走 DataChannel） ---- */
  function sendMotion(linear: number, angular: number, mode = 'manual'): void { _send({ type: 'motion', data: { linear, angular, mode } }) }
  function sendMotionStop(): void { _send({ type: 'motion_stop', data: {} }) }
  function sendEmergencyStop(): void { _send({ type: 'emergency_stop', data: {} }) }
  function sendSystemAction(action: string): void { _send({ type: 'system', data: { action } }) }
  function sendExec(command: string, timeout = 5000): void { _send({ type: 'exec', data: { command, timeout } }) }
  function sendCamera(action: string, cameraId = 0): void { _send({ type: 'camera', data: { action, camera_id: cameraId } }) }
  function requestCameraStatus(): void { _send({ type: 'camera', data: { action: 'list' } }) }
  function sendGimbal(axis: string, angle: number): void { _send({ type: 'gimbal', data: { axis, angle } }) }
  function requestSoftwareList(): void { _send({ type: 'software_list', data: {} }) }
  function requestSoftwareSearch(keyword: string): void { _send({ type: 'software_search', data: { keyword } }) }
  function requestModuleList(): void { _send({ type: 'module_list', data: {} }) }
  function sendDeviceControl(action: string, enabled: boolean): void { _send({ type: 'device_control', data: { action, enabled } }) }
  function sendSoftwareAction(action: string, pkg: string): void { _send({ type: `software_${action}`, data: { package: pkg } }) }
  function sendWifiScan(): void { _send({ type: 'wifi_scan', data: {} }) }
  function sendWifiConnect(ssid: string, password: string): void { _send({ type: 'wifi_connect', data: { ssid, password } }) }
  function sendWifiDisconnect(device: string): void { _send({ type: 'wifi_disconnect', data: { device } }) }

  function cleanup(): void { disconnect() }

  return {
    ws, reconnectCount, lastMessage,
    connect, disconnect, send: _send, cleanup,
    sendMotion, sendMotionStop, sendEmergencyStop, sendSystemAction, sendExec, sendCamera,
    requestCameraStatus, sendGimbal,
    requestSoftwareList, requestSoftwareSearch, requestModuleList, sendDeviceControl, sendSoftwareAction,
    sendWifiScan, sendWifiConnect, sendWifiDisconnect,
  }
}
