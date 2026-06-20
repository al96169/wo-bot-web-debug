import { defineStore } from "pinia";
import type { GalleryItem, LogEntry, Message, Module, Software } from "../types";

/* ============================================================
 * wo-bot-vue - 机器人数据 (Pinia Store)
 * ============================================================ */

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface CmdLogEntry {
  time: string;
  direction: string;
  type: string;
  data: string;
}
export interface SSHOutputEntry {
  type: "cmd" | "out" | "err" | "hint";
  text: string;
}
export interface DeviceDetail {
  label: string;
  value: string;
  icon?: string;
  copyable?: boolean;
}
export interface SubsystemItem {
  name: string;
  status: "online" | "offline" | "warning";
  icon: string;
}
export interface CameraInfo {
  id: number;
  name: string;
  status: string;
  resolution: string;
  stream_url?: string;
}
export interface GimbalState {
  pan: number;
  tilt: number;
}
export interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  connected: boolean;
}
export interface WifiScanResult {
  currentSsid: string;
  currentDevice: string;
  networks: WifiNetwork[];
}

export const useRobotStore = defineStore("robot", {
  state: () => ({
    /** 功能模块列表 */
    modules: [] as Module[],

    /** 消息列表 */
    messages: [] as Message[],

    /** 本地安装的软件列表（mock / 实际） */
    _mockInstalled: [] as Software[],

    /** 软件搜索可用结果 */
    softwareAvailable: [] as Software[],

    /** 日志 */
    logs: [] as LogEntry[],

    /** 控制指令日志 */
    cmdLogs: [] as CmdLogEntry[],

    /** SSH 终端输出 */
    sshOutput: [] as SSHOutputEntry[],
    /** SSH 会话当前工作目录 */
    shellCwd: "/",

    /** 图库 */
    gallery: [] as GalleryItem[],

    /** 设备详情 */
    deviceDetails: [] as DeviceDetail[],

    /** 子系统状态 */
    subsystemStatus: [] as SubsystemItem[],

    /** 当前选中的消息 ID */
    selectedMessageId: null as string | null,

    /** 日志排序：true = 最新在上 */
    logSortDesc: true,

    /** 系统运行状态（仪表盘/header 共用） */
    systemStatus: {
      battery: { level: 0, status: "discharging", state: "放电中", temp: 0 },
      cpu: { usage: 0, temp: 0 },
      memory: { usage: 0 },
      disk: { usage: 0 },
      wifi: { ssid: "--", signal: "--", ip: "--" },
      cellular: { signal: "--", carrier: "--" },
      environment: { temperature: "--" as string, humidity: "--" as string, gas: "--", light: "--" },
      uptime: 0,
      hostname: "--",
    } as {
      battery: { level: number; status: string; state: string; temp: number };
      cpu: { usage: number; temp: number };
      memory: { usage: number };
      disk: { usage: number };
      wifi: { ssid: string; signal: string; ip: string };
      cellular: { signal: string; carrier: string };
      environment: { temperature: string; humidity: string; gas: string; light: string };
      uptime: number;
      hostname: string;
    },

    /** 摄像头列表 */
    cameras: [] as CameraInfo[],

    /** 云台状态 */
    gimbal: { pan: 90, tilt: 90 } as GimbalState,

    /** WiFi 扫描结果 */
    wifiScanResult: { currentSsid: "", currentDevice: "", networks: [] } as WifiScanResult,
  }),

  getters: {
    /** 获取排序后的日志 */
    sortedLogs(state): LogEntry[] {
      const copy = [...state.logs];
      copy.sort((a, b) => {
        const cmp = a.time.localeCompare(b.time);
        return state.logSortDesc ? -cmp : cmp;
      });
      return copy;
    },

    /** 获取已安装软件 */
    softwareInstalled(state): Software[] {
      return state._mockInstalled;
    },

    /** 未读消息数量 */
    unreadCount(state): number {
      return state.messages.filter((m) => !m.read).length;
    },
  },

  actions: {
    /* ---- 日志 ---- */

    addLog(level: LogEntry["level"], source: string, message: string): void {
      this.logs.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        time: formatTime(new Date()),
        level,
        source,
        message,
      });
      if (this.logs.length > 1000) this.logs = this.logs.slice(-1000);
    },

    clearLogs(): void {
      this.logs = [];
    },

    /** 导出日志为文本 */
    exportLogs(): string {
      const lines = this.sortedLogs.map((l) => `[${l.time}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`);
      return lines.join("\n");
    },

    toggleLogSort(): void {
      this.logSortDesc = !this.logSortDesc;
    },

    /* ---- 控制指令日志 ---- */

    addCmdLog(entry: CmdLogEntry): void {
      this.cmdLogs.push(entry);
    },

    clearCmdLogs(): void {
      this.cmdLogs = [];
    },

    /* ---- SSH ---- */

    addSSHOutput(entry: SSHOutputEntry): void {
      this.sshOutput.push(entry);
    },

    clearSSHOutput(): void {
      this.sshOutput = [];
    },

    /** 更新 SSH 会话当前工作目录 */
    setShellCwd(cwd: string): void {
      this.shellCwd = cwd;
    },

    /* ---- 模块 ---- */

    setModules(mods: Module[]): void {
      this.modules = mods;
    },

    updateModuleStatus(id: string, status: Module["status"]): void {
      const m = this.modules.find((mo) => mo.id === id);
      if (m) m.status = status;
    },

    toggleModule(id: string): void {
      const m = this.modules.find((mo) => mo.id === id);
      if (m) m.enabled = !m.enabled;
    },

    /* ---- 消息 ---- */

    setMessages(msgs: Message[]): void {
      this.messages = msgs;
    },

    addMessage(msg: Message): void {
      this.messages.push(msg);
    },

    markRead(id: string): void {
      const m = this.messages.find((msg) => msg.id === id);
      if (m) m.read = true;
    },

    /** markMessageRead(id, read) - 支持双向标记 */
    markMessageRead(id: string, read: boolean): void {
      const m = this.messages.find((msg) => msg.id === id);
      if (m) m.read = read;
    },

    selectMessage(id: string | null): void {
      this.selectedMessageId = id;
      if (id) this.markRead(id);
    },

    /* ---- 软件 ---- */

    setInstalledSoftware(list: Software[]): void {
      this._mockInstalled = list;
    },

    setAvailableSoftware(list: Software[]): void {
      this.softwareAvailable = list;
    },

    /* ---- 图库 ---- */

    setGallery(items: GalleryItem[]): void {
      this.gallery = items;
    },

    /* ---- 系统状态 ---- */

    setSystemStatus(status: DeepPartial<typeof this.systemStatus>): void {
      Object.assign(this.systemStatus, status);
    },

    setDeviceDetails(details: DeviceDetail[]): void {
      this.deviceDetails = details;
    },

    setSubsystemStatus(subsystems: SubsystemItem[]): void {
      this.subsystemStatus = subsystems;
    },

    /* ---- 摄像头 ---- */

    setCameras(cameras: CameraInfo[]): void {
      this.cameras = cameras;
    },

    updateCameraStatus(cameraId: number, status: string, streamUrl?: string): void {
      const cam = this.cameras.find((c) => c.id === cameraId);
      if (cam) {
        cam.status = status;
        if (streamUrl !== undefined) cam.stream_url = streamUrl;
      }
    },

    /* ---- 云台 ---- */

    setGimbal(pan: number, tilt: number): void {
      this.gimbal.pan = Math.max(0, Math.min(180, pan));
      this.gimbal.tilt = Math.max(0, Math.min(180, tilt));
    },

    /* ---- WiFi ---- */

    setWifiNetworks(result: WifiScanResult): void {
      this.wifiScanResult = result;
    },
  },
});
