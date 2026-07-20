/* ============================================================
 * wo-bot-vue - TypeScript 类型定义
 * 合并自 旧项目 types + Vue 3 迁移新增类型
 * ============================================================ */

/* ---- 设备与连接 ---- */

/** 设备信息 */
export interface Device {
  id: string;
  name: string;
  ip: string;
  port: number;
  online: boolean;
  robotInfo?: RobotInfo;
  /** 机器人真实 ID（由 mDNS 发现或连接后获取），用于与云端设备匹配 */
  robotId?: string;
}

/** 机器人基本信息（连接后获取） */
export interface RobotInfo {
  robot_id: string;
  name: string;
  model: string;
  version: string;
  features: string[];
  /** 扩展字段（兼容旧版） */
  serialNumber?: string;
  firmwareVersion?: string;
  sdkVersion?: string;
  os?: string;
  kernel?: string;
  arch?: string;
}

/** 设备详情（展示用） */
export interface DeviceDetails {
  label: string;
  value: string;
  copyable?: boolean;
  icon?: string;
}

/* ---- 功能模块 ---- */

export interface Module {
  id: string;
  name: string;
  version: string;
  status: "online" | "offline" | "disabled";
  enabled: boolean;
  description?: string;
}

/* ---- 消息 ---- */

export interface Message {
  id: string;
  subject: string;
  time: number;
  summary: string;
  body: string;
  read: boolean;
  source?: string;
  severity?: "info" | "warning" | "error";
}

/* ---- 软件 ---- */

export interface Software {
  name: string;
  display_name: string;
  description: string;
  version?: string;
  category: string;
  critical: boolean;
  icon: string;
  installed: boolean;
  upgradable?: boolean;
}

/** 软件操作任务（安装/卸载/升级） */
export interface SoftwareTask {
  id: string;
  package: string;
  action: "install" | "uninstall" | "upgrade";
  progress: number;
  stage: string;
  output: string;
  status: "running" | "success" | "failed";
  startedAt: number;
  completedAt?: number;
  /** 操作前版本（卸载/升级时有值） */
  fromVersion?: string;
  /** 操作后版本（安装/升级成功时有值） */
  toVersion?: string;
}

/* ---- 日志 ---- */

export interface LogEntry {
  id: string;
  lineNo: number;
  time: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
}

export interface CommandLogEntry {
  time: string;
  direction: "send" | "recv";
  type: string;
  data: string;
}

export interface SSHOutputEntry {
  id: string;
  type: "cmd" | "out" | "err";
  text: string;
}

/* ---- 图库 ---- */

export interface GalleryItem {
  id: string;
  name: string;
  url: string;
  thumbnail?: string;
  date: string;
  size: string;
}

/* ---- 系统状态 ---- */

export interface SubsystemStatus {
  name: string;
  status: "online" | "offline";
  icon: string;
}

export interface SystemStatus {
  battery: { level: number; state: string; temp: number };
  cpu: { usage: number; temp: number };
  memory: { usage: number };
  disk: { usage: number };
  wifi: { ssid: string; signal: string; ip: string };
  cellular: { signal: string; carrier: string };
  uptime: string;
  hostname: string;
  environment: {
    temperature: number;
    humidity: number;
    gas: string;
    light: number;
  };
}

/* ---- 联合类型 / 字面量类型 ---- */

/** 连接状态 */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "binding" | "error";

/** 控制模式 */
export type ControlMode = "manual" | "semi" | "auto";

/** 服务状态 */
export interface ServiceInfo {
  service_id: string;
  name: string;
  status: "stopped" | "starting" | "running" | "failed";
  pid: number | null;
  restart_count: number;
  last_error: string;
  uptime: number;
}

/** 舞蹈曲目 */
export interface DanceInfo {
  id: string;
  name: string;
  icon: string;
  duration_sec: number;
}

/** 主题 */
export type Theme = "dark" | "light" | "auto";

/** 音乐曲目 */
export interface MusicTrack {
  name: string;
  filename: string;
  path: string;
  size: number;
  format: string;
  /** ffprobe 检测的实际时长（秒），0 表示未检测 */
  duration?: number;
}

/** 音乐播放状态 */
export interface MusicStatus {
  status: "stopped" | "playing" | "paused";
  volume: number;
  position: number;
  current_track: MusicTrack | null;
  playlist: MusicTrack[];
  streaming: boolean;
  stream_type: string | null;
  /** 当前活跃的推流服务列表: "dlna" | "airplay" | "rtmp" */
  active_services: string[];
  /** 当前活跃播放源: "local" | "dlna" | "airplay" | null */
  active_source: string | null;
}

/** 视图名称 */
export type ViewName =
  | "quickActions"
  | "logs"
  | "messages"
  | "status"
  | "software"
  | "remote"
  | "dance"
  | "map"
  | "gallery"
  | "music"
  | "settings"
  | "processManager"
  | "config";

/** 底部面板 tab */
export type BottomTab = "modules" | "cmdLog" | "ssh";

/** 切换状态 key */
export type ToggleKey = "flashlight" | "mute" | "eco" | "find" | "charge";

/** 日志等级 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/* ---- 兼容别名 ---- */
export type ThemeMode = Theme;
export type ConnectionState = ConnectionStatus;

/* ---- 应用全局状态 ---- */

export interface AppState {
  connection: ConnectionStatus;
  mockMode: boolean;
  theme: Theme;
  currentView: ViewName;
  sidebarCollapsed: boolean;
  controlMode: ControlMode;
  keyboardEnabled: boolean;
  toggleStates: Record<ToggleKey, boolean>;
  sshConnected: boolean;
  _lastPing: number;
}

/* ---- WebSocket 消息帧 ---- */

export interface WsFrame {
  type: string;
  [key: string]: unknown;
}

/** 连接信息（用于 tooltip 展示） */
export interface ConnectionInfo {
  status: ConnectionStatus;
  ip: string;
  port: number;
  ping: number;
  robotId: string;
  version: string;
  features: string[];
}

/* ---- 客户端绑定认证 (R00035) ---- */

/** 绑定认证方式 */
export type BindingMethod = "display" | "qr_scan" | "tts" | "gimbal" | "share_code" | "password";

/** auth_required 消息数据 */
export interface AuthRequiredData {
  methods: BindingMethod[];
  message: string;
}

/** bind_request 消息数据（客户端发起绑定请求） */
export interface BindRequestData {
  requestToken: string;
  clientId: string;
  clientName: string;
  method: BindingMethod;
}

/** bind_request_ack 消息数据 */
export interface BindRequestAckData {
  requestToken: string;
  method: BindingMethod;
  /** gimbal 方式：4 个方向选项 */
  options?: string[][];
}

/** bind_verify 消息数据（客户端提交验证码） */
export interface BindVerifyData {
  requestToken: string;
  randomCode: string;
}

/** bind_success 消息数据 */
export interface BindSuccessData {
  clientToken: string;
  clientId: string;
}

/** bind_failed 消息数据 */
export interface BindFailedData {
  error: string;
  attempts: number;
}

/** 已绑定客户端信息（bind_list 返回） */
export interface BindingInfo {
  clientId: string;
  clientName: string;
  boundAt: string;
  lastSeen: string;
}

/** 本地存储的绑定凭据 */
export interface StoredBinding {
  robotId: string;
  deviceIp: string;
  devicePort: number;
  clientId: string;
  clientToken: string;
  clientName: string;
  boundAt: string;
}

/* ---- 机器人详细配置 (R00033) ---- */

/** 运动驱动类型 */
export type DriveType =
  | "mecanum"
  | "ackermann"
  | "differential"
  | "tracked"
  | "biped"
  | "self_balancing"
  | "spider"
  | "custom";

/** 机器人功能配置 */
export interface FeaturesConfig {
  websocket: boolean;
  exec: boolean;
  system: boolean;
  motion: boolean;
  camera: boolean;
  gimbal: boolean;
  dance: boolean;
  music: boolean;
  voice_broadcast: boolean;
}

/** 运动配置 */
export interface MotionConfig {
  drive_type: DriveType;
  max_linear_speed: number;
  max_angular_speed: number;
  default_mode: string;
  hardware_type: string;
  serial_port: string;
  serial_baudrate: number;
}

/** 摄像头配置 */
export interface CameraConfig {
  enabled: boolean;
  default_camera: number;
  resolution: { width: number; height: number };
  fps: number;
  stream_type: string;
  /** 摄像头名称: {0: "前方摄像头", 1: "后方摄像头"} */
  camera_names?: Record<number, string>;
  /** 云台水平绑定 */
  gimbal_pan_bind?: boolean;
  /** 云台俯仰绑定 */
  gimbal_tilt_bind?: boolean;
  /** 画面水平翻转（镜像） */
  flip_horizontal?: boolean;
  /** 画面垂直翻转（倒置） */
  flip_vertical?: boolean;
}

/** 云台配置 */
export interface GimbalConfig {
  enabled: boolean;
  gimbal_type: string;
  com: string;
  car_type: number;
  pan_channel: number;
  tilt_channel: number;
  pan_min: number;
  pan_max: number;
  pan_center: number;
  tilt_min: number;
  tilt_max: number;
  tilt_center: number;
  pan_invert: boolean;
  tilt_invert: boolean;
  step: number;
}

/** 服务器/网络配置 */
export interface ServerConfig {
  host: string;
  port: number;
  http_port: number;
  advertised_ip: string;
}

/** 机器人完整配置（config_get/config_set 使用） */
export interface RobotConfig {
  robot: { id: string; name: string; model: string; version: string };
  server: ServerConfig;
  motion: MotionConfig;
  camera: CameraConfig;
  gimbal: GimbalConfig;
  features: FeaturesConfig;
  binding: {
    enabled: boolean;
    max_clients: number;
    max_failures: number;
    cooldown_seconds: number;
    session_timeout: number;
    password_enabled: boolean;
    password?: string;
    methods: Record<string, boolean>;
  };
  power_policy: { threshold: number };
  [key: string]: unknown;
}
