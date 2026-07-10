import { defineStore } from "pinia";
import type {
  DanceInfo,
  GalleryItem,
  LogEntry,
  Message,
  Module,
  MusicStatus,
  MusicTrack,
  ServiceInfo,
  Software,
  SoftwareTask,
} from "../types";

/* ============================================================
 * wo-bot-vue - 机器人数据 (Pinia Store)
 * ============================================================ */

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

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

    /** 白名单内未安装的软件列表 */
    softwareAvailable: [] as Software[],

    /** 软件操作任务（安装/卸载/升级） */
    softwareTasks: [] as SoftwareTask[],

    /** 日志 */
    logs: [] as LogEntry[],
    /** 日志增量同步游标：已收到的最大行号+1（下次 since 请求的起始行） */
    logCursor: 0,
    /** 服务端日志文件总行数（最近一次响应） */
    logTotalLines: 0,
    /** 是否还有更多历史日志可向上加载 */
    logHasMore: false,
    /** 日志面板是否已清空（清空后只接收清空点之后的新日志） */
    logCleared: false,

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
      battery: { level: 0, status: "discharging", state: "放电中", temp: 0, estimatedMinutes: null as number | null },
      cpu: { usage: 0, temp: 0 },
      memory: { usage: 0 },
      disk: { usage: 0 },
      wifi: { ssid: "--", signal: "--", ip: "--" },
      cellular: { signal: "--", carrier: "--" },
      environment: { temperature: "--" as string, humidity: "--" as string, gas: "--", light: "--" },
      uptime: 0,
      hostname: "--",
    } as {
      battery: { level: number; status: string; state: string; temp: number; estimatedMinutes: number | null };
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

    /** 子服务列表 */
    services: [] as ServiceInfo[],

    /** 舞蹈曲目列表 */
    dances: [] as DanceInfo[],
    /** 舞蹈播放状态 */
    danceStatus: "stopped" as "stopped" | "playing" | "paused",
    /** 当前播放的舞蹈 ID */
    danceCurrentId: null as string | null,
    /** 播放进度 0~1 */
    danceProgress: 0 as number,
    /** 循环播放 */
    danceLoop: false as boolean,

    /** 音乐播放状态 */
    musicStatus: {
      status: "stopped",
      volume: 75,
      position: 0,
      current_track: null,
      playlist: [],
      streaming: false,
      stream_type: null,
      active_services: [],
      active_source: null,
    } as MusicStatus,

    /** 音乐歌曲列表 */
    musicSongs: [] as MusicTrack[],

    /** 省电策略状态 */
    powerPolicy: {
      mode: "normal" as "normal" | "eco",
      threshold: 30,
      manual_override: false,
      simulated_battery: null as number | null,
    },
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

    addLog() {},

    /** 替换整个日志数组（tail 模式：首次加载最新 N 条） */
    setLogs(logs: LogEntry[], meta?: { totalLines: number; nextSince: number }): void {
      this.logs = logs;
      if (meta) {
        this.logTotalLines = meta.totalLines;
        this.logCursor = meta.nextSince;
        this.logHasMore = logs.length > 0 && logs[0].lineNo > 0;
        this.logCleared = false;
      }
    },

    /** 追加新日志到末尾（since 模式：增量同步） */
    appendLogs(logs: LogEntry[], meta?: { totalLines: number; nextSince: number; hasMore: boolean }): void {
      if (logs.length === 0) {
        if (meta) {
          this.logTotalLines = meta.totalLines;
          // 没有新日志但 cursor 仍需同步
          if (meta.nextSince > this.logCursor) {
            this.logCursor = meta.nextSince;
          }
        }
        return;
      }
      // 去重：过滤掉已存在的 lineNo
      const existingMax = this.logs.length > 0 ? this.logs[this.logs.length - 1].lineNo : -1;
      const newLogs = logs.filter((l) => l.lineNo > existingMax);
      if (newLogs.length > 0) {
        this.logs.push(...newLogs);
      }
      if (meta) {
        this.logTotalLines = meta.totalLines;
        this.logCursor = meta.nextSince;
      }
    },

    /** 向前插入历史日志（向上加载更多） */
    prependLogs(logs: LogEntry[]): void {
      if (logs.length === 0) return;
      // 去重：过滤掉已存在的 lineNo
      const existingMin = this.logs.length > 0 ? this.logs[0].lineNo : Number.MAX_SAFE_INTEGER;
      const oldLogs = logs.filter((l) => l.lineNo < existingMin);
      if (oldLogs.length > 0) {
        this.logs.unshift(...oldLogs);
      }
      // hasMore 由调用方（case "logs"）从后端响应设置
    },

    clearLogs(): void {
      this.logs = [];
      this.logCleared = true;
      // 清空后游标设为当前服务端总行数，下次 since 只拉清空后的新日志
      this.logCursor = this.logTotalLines;
      this.logHasMore = false;
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

    /** 创建一个新的软件操作任务 */
    addSoftwareTask(task: SoftwareTask): void {
      this.softwareTasks.push(task);
    },

    /** 按包名更新进行中的任务（可选按 action 精确匹配） */
    updateSoftwareTaskByPackage(
      pkg: string,
      updates: Partial<SoftwareTask>,
      action?: SoftwareTask["action"],
    ): void {
      for (let i = this.softwareTasks.length - 1; i >= 0; i--) {
        const t = this.softwareTasks[i];
        if (t.package === pkg && t.status === "running" && (action === undefined || t.action === action)) {
          Object.assign(t, updates);
          return;
        }
      }
    },

    /** 追加进行中任务的日志输出 */
    appendSoftwareTaskOutput(pkg: string, line: string): void {
      for (let i = this.softwareTasks.length - 1; i >= 0; i--) {
        const t = this.softwareTasks[i];
        if (t.package === pkg && t.status === "running") {
          t.output = t.output ? t.output + "\n" + line : line;
          return;
        }
      }
    },

    /** 清空所有软件任务 */
    clearSoftwareTasks(): void {
      this.softwareTasks = [];
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

    /* ---- 服务 ---- */

    setServices(svcs: ServiceInfo[]): void {
      this.services = svcs;
    },

    /* ---- 舞蹈 ---- */

    setDances(list: DanceInfo[]): void {
      this.dances = list;
    },

    setDanceStatus(
      status: "stopped" | "playing" | "paused",
      danceId?: string | null,
      progress?: number,
      loop?: boolean,
    ): void {
      this.danceStatus = status;
      if (danceId !== undefined) this.danceCurrentId = danceId;
      if (progress !== undefined) this.danceProgress = progress;
      if (loop !== undefined) this.danceLoop = loop;
    },

    /* ---- 音乐 ---- */

    setMusicStatus(status: MusicStatus): void {
      this.musicStatus = status;
    },

    setMusicSongs(songs: MusicTrack[]): void {
      this.musicSongs = songs;
    },

    /* ---- 省电策略 ---- */

    setPowerPolicy(data: {
      mode: "normal" | "eco";
      threshold: number;
      manual_override: boolean;
      simulated_battery?: number | null;
    }): void {
      this.powerPolicy = { ...this.powerPolicy, ...data };
    },
  },
});
