import { defineStore } from "pinia";
import type { Device, RobotInfo } from "../types";
import { useAppStore } from "../stores/app";

/* ============================================================
 * wo-bot-vue - 设备管理 (Pinia Store)
 * ============================================================ */

/** 生成短 ID */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  },

  actions: {
    /* ---- 持久化 ---- */

    loadDevices(): void {
      try {
        const raw = localStorage.getItem("wobot_debug_devices");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (Array.isArray(data.devices)) this.devices = data.devices;
        if (data.currentDevice) this.currentDevice = data.currentDevice;
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

    /** 直接设置当前设备（App.vue 连接流程使用） */
    setCurrentDevice(device: Device | null): void {
      console.log("[DevicesStore] setCurrentDevice:", device?.name, device?.id, device?.ip);
      this.currentDevice = device;
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

    /** 将发现的设备添加到临时列表 */
    addDiscovered(device: Device): void {
      const exists = this.discovered.some((d) => d.ip === device.ip && d.port === device.port);
      if (!exists) {
        this.discovered.push(device);
      }
    },

    clearDiscovered(): void {
      this.discovered = [];
    },

    /** 从已发现列表导入到设备列表 */
    importDiscovered(id: string): void {
      const idx = this.discovered.findIndex((d) => d.id === id);
      if (idx === -1) return;
      const [dev] = this.discovered.splice(idx, 1);
      this.devices.push({ ...dev, id: genId() });
      this.saveDevices();
    },
  },
});
