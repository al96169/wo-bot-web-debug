import { ref, type Ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useDevicesStore } from '../stores/devices'
import { useRobotStore } from '../stores/robot'
import type { WsFrame, Module, Message, Software, RobotInfo } from '../types'

/* ============================================================
 * wo-bot-vue - WebSocket 组合式函数
 *
 * 负责 WebSocket 的连接/断开/收发/心跳与自动重连。
 * 触发时机到了以后会与对应的 Pinia store 交互。
 * ============================================================ */

const CONNECT_TIMEOUT = 5000 // 5 秒连接超时
const PING_INTERVAL = 10000 // 10 秒心跳间隔
const RECONNECT_DELAY = 3000 // 重连延迟
const MAX_RECONNECT = 5 // 最大重连次数

export function useWebSocket() {
  const ws = ref<WebSocket | null>(null)
  const reconnectCount = ref(0)
  const lastMessage = ref<WsFrame | null>(null)

  let pingTimer: ReturnType<typeof setInterval> | null = null
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingSentAt = 0

  const appStore = useAppStore()
  const devicesStore = useDevicesStore()
  const robotStore = useRobotStore()

  /* ---- 连接管理 ---- */

  function connect(ip: string, port: number): void {
    if (ws.value) {
      disconnect()
    }

    appStore.connection = 'connecting'
    reconnectCount.value = 0

    const url = `ws://${ip}:${port}`
    const socket = new WebSocket(url)
    ws.value = socket

    // 连接超时
    connectTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        socket.close()
        appStore.connection = 'error'
        appStore.showToast(`连接超时: ${ip}:${port}`, 'error')
        robotStore.addLog('error', 'WebSocket', `连接超时: ${ip}:${port}`)
        maybeReconnect(ip, port)
      }
    }, CONNECT_TIMEOUT)

    socket.onopen = () => {
      if (connectTimer) {
        clearTimeout(connectTimer)
        connectTimer = null
      }
      appStore.connection = 'connected'
      appStore.showToast('设备连接成功', 'success')
      reconnectCount.value = 0
      robotStore.addLog('info', 'WebSocket', `已连接到 ${ip}:${port}`)

      // 启动心跳
      startPing()

      // 发送握手请求
      send({ type: 'hello' })
    }

    socket.onmessage = (event: MessageEvent) => {
      try {
        const frame: WsFrame = JSON.parse(event.data as string)
        lastMessage.value = frame
        dispatchMessage(frame)
      } catch {
        robotStore.addLog('warn', 'WebSocket', '收到非 JSON 消息')
      }
    }

    socket.onerror = () => {
      appStore.connection = 'error'
      appStore.showToast(`连接失败: ${ip}:${port}`, 'error')
      robotStore.addLog('error', 'WebSocket', `连接错误: ${ip}:${port}`)
    }

    socket.onclose = () => {
      appStore.connection = 'disconnected'
      stopPing()
      robotStore.addLog('warn', 'WebSocket', `连接已断开: ${ip}:${port}`)
      maybeReconnect(ip, port)
    }
  }

  function disconnect(): void {
    stopPing()
    clearAllTimers()
    reconnectCount.value = MAX_RECONNECT // 阻止重连

    if (ws.value) {
      ws.value.close()
      ws.value = null
    }

    appStore.connection = 'disconnected'
    robotStore.addLog('info', 'WebSocket', '主动断开连接')
  }

  function send(data: WsFrame): void {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(data))
    }
  }

  /* ---- 心跳 ---- */

  function startPing(): void {
    stopPing()
    pingTimer = setInterval(() => {
      if (ws.value?.readyState === WebSocket.OPEN) {
        pingSentAt = Date.now()
        send({ type: 'ping', ts: pingSentAt })
      } else {
        stopPing()
      }
    }, PING_INTERVAL)
  }

  function stopPing(): void {
    if (pingTimer) {
      clearInterval(pingTimer)
      pingTimer = null
    }
  }

  /* ---- 重连 ---- */

  function maybeReconnect(ip: string, port: number): void {
    if (reconnectCount.value >= MAX_RECONNECT) return
    if (appStore.mockMode) return

    reconnectCount.value++
    robotStore.addLog(
      'info',
      'WebSocket',
      `正在尝试重连 (${reconnectCount.value}/${MAX_RECONNECT})...`,
    )

    reconnectTimer = setTimeout(() => {
      connect(ip, port)
    }, RECONNECT_DELAY * reconnectCount.value)
  }

  /* ---- 清理 ---- */

  function clearAllTimers(): void {
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  /* ---- 消息分发 ---- */

  function dispatchMessage(frame: WsFrame): void {
    switch (frame.type) {
      case 'pong': {
        appStore._lastPing = Date.now() - pingSentAt
        break
      }

      case 'robot_info': {
        const info: RobotInfo = {
          robot_id: String(frame.robot_id ?? ''),
          name: String(frame.name ?? ''),
          model: String(frame.model ?? ''),
          version: String(frame.version ?? ''),
          features: Array.isArray(frame.features) ? (frame.features as string[]) : [],
        }
        devicesStore.setRobotInfo(info)
        break
      }

      case 'modules': {
        const list = Array.isArray(frame.modules)
          ? (frame.modules as Module[])
          : []
        robotStore.setModules(list)
        break
      }

      case 'messages': {
        const list = Array.isArray(frame.messages)
          ? (frame.messages as Message[])
          : []
        robotStore.setMessages(list)
        break
      }

      case 'software': {
        const list = Array.isArray(frame.software)
          ? (frame.software as Software[])
          : []
        robotStore.setInstalledSoftware(list)
        break
      }

      case 'log': {
        robotStore.addLog(
          (frame.level as 'info') ?? 'info',
          String(frame.source ?? 'remote'),
          String(frame.message ?? ''),
        )
        break
      }

      default: {
        robotStore.addLog('debug', 'WebSocket', `收到未知消息类型: ${frame.type}`)
        break
      }
    }
  }

  /* ---- 挂载/卸载 ---- */

  function cleanup(): void {
    disconnect()
  }

  return {
    ws: ws as Ref<WebSocket | null>,
    reconnectCount,
    lastMessage,
    connect,
    disconnect,
    send,
    cleanup,
  }
}
