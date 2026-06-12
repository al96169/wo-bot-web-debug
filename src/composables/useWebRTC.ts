import { ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useRobotStore, type CameraInfo } from '../stores/robot'
import { getSignalingWs, setDataChannel, getRemoteFeatures } from './useWebSocket'

/* ============================================================
 * wo-bot-web-debug - WebRTC 连接管理
 *
 * 在 WebSocket 信令建立后，自动发起 WebRTC 连接：
 * 1. 创建 RTCPeerConnection + DataChannel
 * 2. 通过 WebSocket 发送 SDP offer
 * 3. 接收 SDP answer → 完成连接
 * 4. DataChannel 承载所有业务消息
 * 5. MediaStream 承载视频流
 * ============================================================ */

const STUN_SERVER = 'stun:stun.l.google.com:19302'

// ---- 模块级 answer resolver + pending timer ----
let _answerResolver: ((sdp: string) => void) | null = null
let _pendingTimer: ReturnType<typeof setTimeout> | null = null

/** 清理 pending timer + answer resolver */
function _clearPending(): void {
  if (_pendingTimer) { clearTimeout(_pendingTimer); _pendingTimer = null }
  _answerResolver = null
}

/** 由外部（WebSocket 信令层收到 webrtc_answer 时）调用 */
export function resolveWebRTCAnswer(sdp: string): void {
  if (_answerResolver) {
    _answerResolver(sdp)
    _answerResolver = null
  }
}

/** 由外部（WebSocket 信令层收到 webrtc_ice_candidate 时）调用 */
export async function handleWebRTCIceCandidate(candidate: string, sdpMid: string | null, sdpMLineIndex: number | null): Promise<void> {
  if (_pc && candidate) {
    try {
      await _pc.addIceCandidate(new RTCIceCandidate({
        candidate,
        sdpMid: sdpMid ?? undefined,
        sdpMLineIndex: sdpMLineIndex ?? undefined,
      }))
    } catch (e) {
      // ICE candidate 添加失败不阻塞（非致命）
    }
  }
}

// ---- 模块级 pc 引用（供 ICE candidate 中继使用） ----
let _pc: RTCPeerConnection | null = null

// ---- 模块级单例 refs（useWebRTC() 多次调用共享同一状态） ----
const pc = ref<RTCPeerConnection | null>(null)
const dc = ref<RTCDataChannel | null>(null)
const videoStream0 = ref<MediaStream | null>(null)
const videoStream1 = ref<MediaStream | null>(null)
const webrtcState = ref<'idle' | 'connecting' | 'connected' | 'failed'>('idle')

export function useWebRTC() {
  const appStore = useAppStore()
  const robotStore = useRobotStore()

  /** 建立 WebRTC 连接（在 WebSocket 信令连通后调用） */
  async function establishConnection(): Promise<void> {
    // 检查服务端是否支持 WebRTC
    const features = getRemoteFeatures()
    if (!features.includes('webrtc')) {
      robotStore.addLog('info', 'WebRTC', '服务端不支持 WebRTC，使用 WebSocket 降级模式')
      webrtcState.value = 'idle'
      return
    }

    // 清理旧状态，防止多次调用导致的竞态
    _clearPending()
    if (pc.value) { pc.value.close(); pc.value = null }
    if (dc.value) { dc.value.close(); dc.value = null }

    const ws = getSignalingWs()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      robotStore.addLog('warn', 'WebRTC', '信令通道未就绪，无法建立 WebRTC')
      return
    }

    webrtcState.value = 'connecting'
    robotStore.addLog('info', 'WebRTC', '正在建立 WebRTC 连接...')

    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: STUN_SERVER }],
      })
      pc.value = peerConnection
      _pc = peerConnection  // 模块级引用供 ICE 中继

      // 创建 DataChannel
      const channel = peerConnection.createDataChannel('wobot-control', {
        ordered: true,
      })
      dc.value = channel
      setDataChannel(channel)

      channel.onopen = () => {
        robotStore.addLog('info', 'WebRTC', 'DataChannel 已建立 — 业务通道就绪')
        webrtcState.value = 'connected'
        appStore.setSSHConnected(true)
        appStore.showToast('WebRTC 业务通道已建立', 'success')
        channel.send(JSON.stringify({ type: 'subscribe', data: { events: ['status'] } }))
      }

      channel.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string)
          dispatchDataChannelMessage(msg)
        } catch {
          robotStore.addLog('warn', 'WebRTC', 'DataChannel 收到非 JSON 消息')
        }
      }

      channel.onclose = () => {
        robotStore.addLog('warn', 'WebRTC', 'DataChannel 已关闭')
        webrtcState.value = 'idle'
        appStore.setSSHConnected(false)
        setDataChannel(null)
      }

      channel.onerror = (event: Event) => {
        const err = (event as RTCErrorEvent).error
        const detail = err ? `${err.message ?? err.errorDetail ?? 'unknown'}` : '无详情'
        robotStore.addLog('error', 'WebRTC', `DataChannel 错误: ${detail}`)
      }

      // 接收远端视频流（双摄像头：两个独立 MediaStream）
      let _trackSeq = 0
      peerConnection.ontrack = (event: RTCTrackEvent) => {
        const stream = new MediaStream([event.track])
        const idx = _trackSeq++
        if (idx === 0) {
          robotStore.addLog('info', 'WebRTC', '收到摄像头 0 视频流')
          videoStream0.value = stream
        } else if (idx === 1) {
          robotStore.addLog('info', 'WebRTC', '收到摄像头 1 视频流')
          videoStream1.value = stream
        }
      }

      // ICE candidate → 通过信令发送
      peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'webrtc_ice_candidate',
            data: {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            },
          }))
        }
      }

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState
        robotStore.addLog('info', 'WebRTC', `连接状态: ${state}`)
        if (state === 'connected') {
          webrtcState.value = 'connected'
          appStore.setSSHConnected(true)
        } else if (state === 'failed' || state === 'disconnected') {
          webrtcState.value = 'failed'
          appStore.setSSHConnected(false)
        }
      }

      // 创建双 Video Transceiver（服务端为两个摄像头添加独立视频轨）
      peerConnection.addTransceiver('video', { direction: 'recvonly' })
      peerConnection.addTransceiver('video', { direction: 'recvonly' })

      // 创建 SDP offer
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      ws.send(JSON.stringify({ type: 'webrtc_offer', data: { sdp: offer.sdp } }))

      // 等待 answer
      const answer = await new Promise<string>((resolve) => {
        _answerResolver = resolve
        _pendingTimer = setTimeout(() => { _clearPending(); resolve('') }, 10000)
      })

      if (!answer) {
        robotStore.addLog('error', 'WebRTC', '等待 SDP answer 超时')
        webrtcState.value = 'failed'
        return
      }

      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer }))
      robotStore.addLog('info', 'WebRTC', 'WebRTC 连接建立完成')

    } catch (e) {
      robotStore.addLog('error', 'WebRTC', `WebRTC 连接失败: ${e}`)
      webrtcState.value = 'failed'
    }
  }

  /** DataChannel 消息分发 */
  function dispatchDataChannelMessage(msg: { type: string; data?: Record<string, unknown> }): void {
    // 收到任何 DataChannel 消息，说明通道已通
    if (!appStore.sshConnected) appStore.setSSHConnected(true)

    const data = msg.data ?? {}
    switch (msg.type) {
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
      case 'software_list': {
        const pkgs = Array.isArray(data.packages) ? (data.packages as Array<Record<string, unknown>>) : []
        robotStore.setInstalledSoftware(pkgs.map(p => ({
          name: String(p.name ?? ''), version: String(p.version ?? ''),
          size: String(p.size ?? '--'), installDate: String(p.install_date ?? '--'),
          source: String(p.source ?? 'apt'), icon: '',
        })))
        break
      }
      case 'software_search_result': {
        const pkgs = Array.isArray(data.packages) ? (data.packages as Array<Record<string, unknown>>) : []
        robotStore.setAvailableSoftware(pkgs.map(p => ({
          name: String(p.name ?? ''), description: String(p.description ?? ''),
          version: '--', size: '--', installDate: '--', source: 'apt', icon: '',
        })))
        break
      }
      case 'software_install_ack': case 'software_uninstall_ack': case 'software_upgrade_ack':
        robotStore.addLog('info', 'Software', `${data.package} → ${data.status}`)
        break
      case 'module_list': {
        robotStore.setModules(Array.isArray(data.modules) ? (data.modules as any) : [])
        break
      }
      case 'module_control_ack':
        robotStore.addLog('info', 'Module', `${data.module_id} → ${data.action} (${data.status})`)
        break
      case 'motion_ack':
        robotStore.addCmdLog({ time: new Date().toLocaleTimeString(), direction: 'recv', type: 'motion', data: `v=${data.linear} ω=${data.angular}` })
        break
      case 'emergency_stop_ack':
        robotStore.addCmdLog({ time: new Date().toLocaleTimeString(), direction: 'recv', type: 'emergency', data: '急停已确认' })
        appStore.showToast('急停已触发', 'error')
        break
      case 'camera_status':
        robotStore.addLog('info', 'Camera', `摄像头状态: ${JSON.stringify(data).slice(0, 100)}`)
        break
      case 'device_control_ack':
        robotStore.addLog('info', 'Device', `${data.action} → ${data.enabled ? 'ON' : 'OFF'}`)
        break
      case 'system_ack':
        robotStore.addLog('info', 'System', `${data.action} → ${data.status}`)
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
      case 'exec_result': {
        const stdout = String(data.stdout ?? ''), stderr = String(data.stderr ?? '')
        if (stdout) robotStore.addSSHOutput({ type: 'out', text: stdout.trim() })
        if (stderr) robotStore.addSSHOutput({ type: 'err', text: stderr.trim() })
        if (data.return_code !== undefined) robotStore.addSSHOutput({ type: 'cmd', text: `[exit: ${data.return_code}]` })
        if (data.cwd !== undefined) robotStore.setShellCwd(String(data.cwd))
        break
      }
      case 'error':
        appStore.showToast(`错误: ${String(data.message ?? '未知错误')}`, 'error')
        robotStore.addLog('error', 'Remote', String(data.message ?? ''))
        break
      default:
        robotStore.addLog('debug', 'DataChannel', `收到消息: ${msg.type}`)
        break
    }
  }

  /** 关闭连接 */
  function close(): void {
    _clearPending()
    if (dc.value) { dc.value.close(); dc.value = null }
    if (pc.value) { pc.value.close(); pc.value = null }
    _pc = null
    videoStream0.value = null
    videoStream1.value = null
    setDataChannel(null)
    webrtcState.value = 'idle'
    robotStore.addLog('info', 'WebRTC', 'WebRTC 连接已关闭')
  }

  return { pc, dc, videoStream0, videoStream1, webrtcState, establishConnection, close }
}
