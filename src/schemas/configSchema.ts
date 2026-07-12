/* ============================================================
 * 机器人配置 JSON Schema 定义 (R00033)
 * 驱动表单渲染和 JSON 校验
 * ============================================================ */

import type { RobotConfig } from "@/types";

/** 默认配置（用于初始化） */
export const DEFAULT_CONFIG: RobotConfig = {
  robot: { id: "wobot-001", name: "My Robot", model: "jetson-nano", version: "1.0.0" },
  server: { host: "0.0.0.0", port: 8765, http_port: 8000, advertised_ip: "" },
  motion: {
    drive_type: "mecanum",
    max_linear_speed: 1.0,
    max_angular_speed: 1.0,
    default_mode: "manual",
    hardware_type: "rosmaster",
    serial_port: "/dev/ttyUSB0",
    serial_baudrate: 115200,
  },
  camera: {
    enabled: true,
    default_camera: 0,
    resolution: { width: 640, height: 480 },
    fps: 30,
    stream_type: "mjpeg",
    camera_names: { 0: "摄像头 0", 1: "摄像头 1" },
    gimbal_pan_bind: false,
    gimbal_tilt_bind: false,
    flip_horizontal: false,
    flip_vertical: false,
  },
  gimbal: {
    enabled: false,
    gimbal_type: "rosmaster",
    com: "/dev/ttyUSB0",
    car_type: 1,
    pan_channel: 4,
    tilt_channel: 3,
    pan_min: 0,
    pan_max: 180,
    pan_center: 90,
    tilt_min: 30,
    tilt_max: 150,
    tilt_center: 90,
    pan_invert: false,
    tilt_invert: false,
    step: 3.0,
  },
  features: {
    websocket: true,
    exec: true,
    system: true,
    motion: true,
    camera: true,
    gimbal: true,
    dance: true,
    music: true,
    voice_broadcast: true,
  },
  binding: {
    enabled: true,
    max_clients: 10,
    max_failures: 5,
    cooldown_seconds: 300,
    session_timeout: 120,
    password_enabled: true,
    password: "",
    methods: {
      display: true,
      tts: true,
      qr_scan: false,
      gimbal: true,
      password: true,
      share_code: true,
    },
  },
  power_policy: {
    threshold: 30,
  },
};

/** 核心功能（不可关闭，开关置灰） */
export const CORE_FEATURES = ["websocket", "exec", "system"] as const;

/** 功能列表中文名 */
export const FEATURE_LABELS: Record<string, string> = {
  websocket: "WebSocket 通信",
  exec: "远程命令执行",
  system: "系统管理",
  motion: "运动控制",
  camera: "摄像头",
  gimbal: "云台控制",
  dance: "跳舞",
  music: "音乐播放",
  voice_broadcast: "语音喊话",
};

/** 驱动类型选项 */
export const DRIVE_TYPE_OPTIONS: { value: string; label: string; available: boolean }[] = [
  { value: "mecanum", label: "麦克纳姆轮", available: true },
  { value: "ackermann", label: "阿克曼转向", available: true },
  { value: "differential", label: "差速驱动", available: true },
  { value: "tracked", label: "履带式", available: false },
  { value: "biped", label: "双腿式", available: false },
  { value: "self_balancing", label: "自平衡式", available: false },
  { value: "spider", label: "蜘腿式", available: false },
  { value: "custom", label: "自定义", available: false },
];

/** JSON Schema 用于校验 */
export const CONFIG_JSON_SCHEMA = {
  type: "object",
  required: ["robot", "server", "motion", "camera", "features"],
  properties: {
    robot: {
      type: "object",
      required: ["id", "name", "model", "version"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        model: { type: "string" },
        version: { type: "string" },
      },
    },
    server: {
      type: "object",
      required: ["host", "port", "http_port"],
      properties: {
        host: { type: "string" },
        port: { type: "number", minimum: 1, maximum: 65535 },
        http_port: { type: "number", minimum: 1, maximum: 65535 },
        advertised_ip: { type: "string" },
      },
    },
    motion: {
      type: "object",
      required: ["drive_type"],
      properties: {
        drive_type: { type: "string", enum: ["mecanum", "ackermann", "differential", "tracked", "biped", "self_balancing", "spider", "custom"] },
        max_linear_speed: { type: "number", minimum: 0, maximum: 10 },
        max_angular_speed: { type: "number", minimum: 0, maximum: 10 },
        default_mode: { type: "string", enum: ["manual", "semi", "auto"] },
        hardware_type: { type: "string" },
        serial_port: { type: "string" },
        serial_baudrate: { type: "number" },
      },
    },
    camera: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        default_camera: { type: "number", enum: [0, 1] },
        resolution: {
          type: "object",
          properties: {
            width: { type: "number", minimum: 160, maximum: 3840 },
            height: { type: "number", minimum: 120, maximum: 2160 },
          },
        },
        fps: { type: "number", minimum: 1, maximum: 120 },
        stream_type: { type: "string", enum: ["mjpeg", "webrtc"] },
        gimbal_pan_bind: { type: "boolean" },
        gimbal_tilt_bind: { type: "boolean" },
        flip_horizontal: { type: "boolean" },
        flip_vertical: { type: "boolean" },
      },
    },
    gimbal: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        gimbal_type: { type: "string" },
        pan_invert: { type: "boolean" },
        tilt_invert: { type: "boolean" },
        pan_min: { type: "number", minimum: 0, maximum: 180 },
        pan_max: { type: "number", minimum: 0, maximum: 180 },
        pan_center: { type: "number", minimum: 0, maximum: 180 },
        tilt_min: { type: "number", minimum: 0, maximum: 180 },
        tilt_max: { type: "number", minimum: 0, maximum: 180 },
        tilt_center: { type: "number", minimum: 0, maximum: 180 },
        step: { type: "number", minimum: 0.1, maximum: 30 },
      },
    },
    features: {
      type: "object",
      properties: {
        websocket: { type: "boolean" },
        exec: { type: "boolean" },
        system: { type: "boolean" },
        motion: { type: "boolean" },
        camera: { type: "boolean" },
        gimbal: { type: "boolean" },
        dance: { type: "boolean" },
        music: { type: "boolean" },
        voice_broadcast: { type: "boolean" },
      },
    },
  },
};