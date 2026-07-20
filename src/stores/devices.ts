import { defineStore } from "pinia";
import type { Device, RobotInfo } from "../types";
import { useAppStore } from "../stores/app";
import type { CloudDevice } from "../services/account";

/* ============================================================
 * wo-bot-vue - 设备管理 (Pinia Store)
 * ============================================================ */

/** 生成设备唯一标识符（UUID v4） */
function genId(): string {
  // 优先使用浏览器原生 crypto.randomUUID()
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // 降级方案：手动生成 UUID v4 格式
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ---- 连接状态 tooltip HTML 生成 ---- */
export function buildConnectionTooltipHTML(info: {
  status: string;
  ip: string;
  port: number;
  ping: number;
  robotId: string;
  version: string;
  features: string[];
}): string {
  const statusMap: Record<string, string> = {
    connected: "已连接",
    connecting: "连接中",
    disconnected: "未连接",
    error: "连接错误",
  };
  const statusText = statusMap[info.status] ?? info.status;

  let html = "";
  html += `<div class="tip-row"><span class="tip-label">状态</span><span class="tip-value">${statusText}</span></div>`;
  html += `<div class="tip-row"><span class="tip-label">地址</span><span class="tip-value">${info.ip}:${info.port}</span></div>`;
  html += `<div class="tip-row"><span class="tip-label">延迟</span><span class="tip-value">${info.ping}ms</span></div>`;
  html += `<hr class="tip-divider">`;
  html += `<div class="tip-row"><span class="tip-label">ID</span><span class="tip-value">${info.robotId}</span></div>`;
  html += `<div class="tip-row"><span class="tip-label">版本</span><span class="tip-value">${info.version}</span></div>`;

  if (info.features.length > 0) {
    const tags = info.features.map((f) => `<span class="tip-tag">${f}</span>`).join("");
    html += `<div class="tip-row" style="margin-top:4px"><span class="tip-label">特性</span><span class="tip-value tip-features">${tags}</span></div>`;
  }

  return html;
}

export const useDevicesStore = defineStore("devices", {
  state: () => ({
    /** 已保存的设备列表 */
    devices: [] as Device[],

    /** 当前选中的设备 */
    currentDevice: null as Device | null,

    /** 当前连接机器人的详细信息 */
    robotInfo: null as RobotInfo | null,

    /** 扫描发现的设备 */
    discovered: [] as Device[],

    /** 云端绑定的设备（当前帐号下） */
    cloudDevices: [] as CloudDevice[],

    /** 是否正在加载云端设备 */
    loadingCloud: false,

    /** 是否正在扫描 */
    scanning: false,
  }),

  getters: {
    /** 当前设备是否在线 */
    isCurrentOnline(state): boolean {
      return state.currentDevice?.online ?? false;
    },

    /** 根据当前状态生成 tooltip HTML */
    connectionTooltipHTML(): string {
      const appStore = useAppStore();
      const dev = this.currentDevice;
      const info = this.robotInfo;
      return buildConnectionTooltipHTML({
        status: appStore.connection,
        ip: dev?.ip ?? "--",
        port: dev?.port ?? 0,
        ping: appStore._lastPing,
        robotId: info?.robot_id ?? "--",
        version: info?.version ?? "--",
        features: info?.features ?? [],
      });
    },

    /** 云端设备中尚未出现在本地列表和发现列表的部分（按 robotId 去重） */
    cloudDevicesFiltered(state): CloudDevice[] {
      const localRobotIds = new Set(state.devices.map((d) => d.robotId || d.id).filter(Boolean));
      const discoveredRobotIds = new Set(state.discovered.map((d) => d.robotId).filter(Boolean));
      return state.cloudDevices.filter((c) => {
        if (localRobotIds.has(c.robotId) || discoveredRobotIds.has(c.robotId)) return false;
        return true;
      });
    },
  },

  actions: {
    /* ---- 持久化 ---- */

    loadDevices(): void {
      try {
        const raw = localStorage.getItem("wobot_debug_devices");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (Array.isArray(data.devices)) this.devices = data.devices;
        // 不恢复 currentDevice：连接是运行时状态，刷新页面后必定断开
      } catch {
        // 忽略格式错误
      }
    },

    saveDevices(): void {
      const payload = {
        devices: this.devices,
        currentDevice: this.currentDevice,
      };
      localStorage.setItem("wobot_debug_devices", JSON.stringify(payload));
    },

    /* ---- CRUD ---- */

    addDevice(device: Omit<Device, "id" | "online">): Device {
      const d: Device = { ...device, id: genId(), online: false };
      this.devices.push(d);
      this.saveDevices();
      return d;
    },

    removeDevice(id: string): void {
      this.devices = this.devices.filter((d) => d.id !== id);
      if (this.currentDevice?.id === id) {
        this.currentDevice = this.devices.length > 0 ? this.devices[0] : null;
      }
      this.saveDevices();
    },

    /** 选中设备 */
    selectDevice(id: string): void {
      const found = this.devices.find((d) => d.id === id) ?? null;
      this.currentDevice = found;
      this.saveDevices();
    },

    /** 直接设置当前设备（App.vue 连接流程使用），自动补入设备列表 */
    setCurrentDevice(device: Device | null): void {
      console.log("[DevicesStore] setCurrentDevice:", device?.name, device?.id, device?.ip);
      // 如果设备不在列表中，自动添加
      if (device) {
        const exists = this.devices.some((d) => d.id === device.id || (d.ip === device.ip && d.port === device.port));
        if (!exists) {
          console.log("[DevicesStore] setCurrentDevice: 设备不在列表中，自动添加");
          this.devices.push(device);
        }
      }
      this.currentDevice = device;
      this.saveDevices();
    },

    /** 连接成功后用后端 robot_id 更新当前设备 ID（后端为准，保证全局一致） */
    updateCurrentDeviceId(robotId: string): void {
      if (!robotId || !this.currentDevice) return;
      const oldId = this.currentDevice.id;
      // ID 已一致，无需更新
      if (oldId === robotId) return;
      // 更新设备列表中的 ID
      const dev = this.devices.find((d) => d.id === oldId);
      if (dev) {
        dev.id = robotId;
        dev.robotId = robotId;
      }
      // 更新当前设备引用
      this.currentDevice.id = robotId;
      this.currentDevice.robotId = robotId;
      console.log("[DevicesStore] updateCurrentDeviceId:", oldId, "->", robotId);
      this.saveDevices();
    },

    /* ---- 连接状态 UI ---- */

    /** 更新当前设备在线状态 */
    setDeviceOnline(id: string, online: boolean): void {
      const dev = this.devices.find((d) => d.id === id);
      if (dev) dev.online = online;
      if (this.currentDevice?.id === id) {
        this.currentDevice.online = online;
      }
    },

    /** 设置机器人信息（连接成功后回调） */
    setRobotInfo(info: RobotInfo): void {
      this.robotInfo = info;
    },

    /** 更新连接 tooltip 中使用的延迟数据 */
    updatePing(ping: number): void {
      // ping 值由 app store 维护，此处预留接口用于将来扩展
      void ping;
    },

    /** 将发现的设备添加到临时列表（过滤已保存的设备） */
    addDiscovered(device: Device): void {
      // 排除已保存设备列表中的重复项
      const alreadySaved = this.devices.some((d) => d.ip === device.ip && d.port === device.port);
      if (alreadySaved) return;
      const exists = this.discovered.some((d) => d.ip === device.ip && d.port === device.port);
      if (!exists) {
        this.discovered.push(device);
      }
    },

    clearDiscovered(): void {
      this.discovered = [];
    },

    /** 从已发现列表导入到设备列表，返回新设备 */
    importDiscovered(id: string): Device | null {
      const idx = this.discovered.findIndex((d) => d.id === id);
      if (idx === -1) return null;
      const [dev] = this.discovered.splice(idx, 1);
      const newDevice: Device = { ...dev, id: genId() };
      this.devices.push(newDevice);
      this.saveDevices();
      return newDevice;
    },

    /** 加载云端设备列表（当前帐号绑定的设备） */
    async loadCloudDevices(): Promise<void> {
      this.loadingCloud = true;
      try {
        const { getDevices } = await import("../services/account");
        const devices = await getDevices();
        this.cloudDevices = devices;
        console.log("[DevicesStore] cloud devices loaded:", devices.length);
      } catch (e) {
        console.warn("[DevicesStore] loadCloudDevices failed:", e);
        this.cloudDevices = [];
      } finally {
        this.loadingCloud = false;
      }
    },

    /** 清空云端设备（登出时调用） */
    clearCloudDevices(): void {
      this.cloudDevices = [];
    },
  },
});
