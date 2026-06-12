/* ============================================================
 * wo-bot-vue - TypeScript 类型定义
 * 合并自 旧项目 types + Vue 3 迁移新增类型
 * ============================================================ */

/* ---- 设备与连接 ---- */

/** 设备信息 */
export interface Device {
  id: string
  name: string
  ip: string
  port: number
  online: boolean
  robotInfo?: RobotInfo
}

/** 机器人基本信息（连接后获取） */
export interface RobotInfo {
  robot_id: string
  name: string
  model: string
  version: string
  features: string[]
  /** 扩展字段（兼容旧版） */
  serialNumber?: string
  firmwareVersion?: string
  sdkVersion?: string
  os?: string
  kernel?: string
  arch?: string
}

/** 设备详情（展示用） */
export interface DeviceDetails {
  label: string
  value: string
  copyable?: boolean
  icon?: string
}

/* ---- 功能模块 ---- */

export interface Module {
  id: string
  name: string
  version: string
  status: 'online' | 'offline' | 'disabled'
  enabled: boolean
  description?: string
}

/* ---- 消息 ---- */

export interface Message {
  id: string
  subject: string
  time: number
  summary: string
  body: string
  read: boolean
  source?: string
  severity?: 'info' | 'warning' | 'error'
}

/* ---- 软件 ---- */

export interface Software {
  name: string
  version: string
  size: string
  installDate: string
  icon: string
  source: string
  description?: string
  installed?: boolean
  category?: string
}

/* ---- 日志 ---- */

export interface LogEntry {
  id: string
  time: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
}

export interface CommandLogEntry {
  time: string
  direction: 'send' | 'recv'
  type: string
  data: string
}

export interface SSHOutputEntry {
  id: string
  type: 'cmd' | 'out' | 'err'
  text: string
}

/* ---- 图库 ---- */

export interface GalleryItem {
  id: string
  name: string
  url: string
  thumbnail?: string
  date: string
  size: string
}

/* ---- 系统状态 ---- */

export interface SubsystemStatus {
  name: string
  status: 'online' | 'offline'
  icon: string
}

export interface SystemStatus {
  battery: { level: number; state: string; temp: number }
  cpu: { usage: number; temp: number }
  memory: { usage: number }
  disk: { usage: number }
  wifi: { ssid: string; signal: string; ip: string }
  cellular: { signal: string; carrier: string }
  uptime: string
  hostname: string
  environment: {
    temperature: number
    humidity: number
    gas: string
    light: number
  }
}

/* ---- 联合类型 / 字面量类型 ---- */

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** 控制模式 */
export type ControlMode = 'manual' | 'semi' | 'auto'

/** 主题 */
export type Theme = 'dark' | 'light' | 'auto'

/** 视图名称 */
export type ViewName =
  | 'quickActions'
  | 'logs'
  | 'messages'
  | 'status'
  | 'software'
  | 'remote'
  | 'map'
  | 'gallery'
  | 'settings'

/** 底部面板 tab */
export type BottomTab = 'modules' | 'cmdLog' | 'ssh'

/** 切换状态 key */
export type ToggleKey = 'flashlight' | 'mute' | 'eco' | 'find' | 'charge'

/** 日志等级 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/* ---- 兼容别名 ---- */
export type ThemeMode = Theme
export type ConnectionState = ConnectionStatus

/* ---- 应用全局状态 ---- */

export interface AppState {
  connection: ConnectionStatus
  mockMode: boolean
  theme: Theme
  currentView: ViewName
  sidebarCollapsed: boolean
  controlMode: ControlMode
  keyboardEnabled: boolean
  toggleStates: Record<ToggleKey, boolean>
  sshConnected: boolean
  _lastPing: number
}

/* ---- WebSocket 消息帧 ---- */

export interface WsFrame {
  type: string
  [key: string]: unknown
}

/** 连接信息（用于 tooltip 展示） */
export interface ConnectionInfo {
  status: ConnectionStatus
  ip: string
  port: number
  ping: number
  robotId: string
  version: string
  features: string[]
}
