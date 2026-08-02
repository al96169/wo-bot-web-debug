import { ref } from "vue";
import { onMessage } from "./useWebSocket";
import { useAppStore } from "../stores/app";

/* ============================================================
 * wo-bot-web-debug - 红外遥控状态管理与 WebSocket 通信
 *
 * 接收外部 send 函数发送 WebSocket 消息，消息格式: { type, data }
 * 内部通过 onMessage 监听服务端推送的 ir_* 消息并更新状态
 * ============================================================ */

/* ---- 接口定义 ---- */

export interface IRDevice {
  device_id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  state: string; // "on" | "off"
  buttons: IRButton[];
}

export interface IRButton {
  id: string;
  name: string;
  index: number;
  code_length: number;
  type: string; // "toggle" | "stateless"
}

export type LearnState = "idle" | "learning" | "success" | "timeout";

/* ---- 发送函数类型 ---- */

type SendFn = (frame: { type: string; data: Record<string, unknown> }) => void;

/* ---- 模块级单例状态（多次调用 useIRRemote 共享同一状态） ---- */

const devices = ref<IRDevice[]>([]);
const currentDevice = ref<IRDevice | null>(null);
const learnState = ref<LearnState>("idle");
const loading = ref(false);

/** 学习成功后接收到的按键数据（供视图弹出命名弹窗） */
const learnedButton = ref<{
  device_id: string;
  button_id: string;
  index: number;
  code_length: number;
} | null>(null);

/** 学习倒计时剩余秒数 */
const learnCountdown = ref(0);

/** 按键发射状态记录：buttonId -> "success" | "fail" | null */
const sendStatusMap = ref<Record<string, "success" | "fail" | null>>({});

/* ---- 模块级内部变量 ---- */

let _learnTimer: ReturnType<typeof setTimeout> | null = null;
let _learnCountdownTimer: ReturnType<typeof setInterval> | null = null;
let _listenerRegistered = false;

/** 清理学习定时器 */
function _clearLearnTimers(): void {
  if (_learnTimer) {
    clearTimeout(_learnTimer);
    _learnTimer = null;
  }
  if (_learnCountdownTimer) {
    clearInterval(_learnCountdownTimer);
    _learnCountdownTimer = null;
  }
}

export function useIRRemote(send: SendFn) {
  const appStore = useAppStore();

  /* ---- 注册消息监听器（仅注册一次） ---- */
  if (!_listenerRegistered) {
    _listenerRegistered = true;
    onMessage((msg: { type: string; data?: any }) => {
      if (!msg.type || !msg.type.startsWith("ir_")) return;
      _handleMessage(msg.type, msg.data ?? {});
    });
  }

  /* ---- 消息处理器 ---- */
  function _handleMessage(type: string, data: Record<string, unknown>): void {
    switch (type) {
      /* 设备列表 */
      case "ir_device_list_result": {
        const list = Array.isArray(data.devices) ? (data.devices as any[]) : [];
        devices.value = list.map(_normalizeDevice);
        loading.value = false;
        break;
      }

      /* 新增设备 */
      case "ir_device_add_result": {
        loading.value = false;
        if (data.success !== false && data.device) {
          const dev = _normalizeDevice(data.device);
          devices.value = [...devices.value, dev];
          currentDevice.value = dev;
          appStore.showToast("设备添加成功", "success");
        } else {
          appStore.showToast(`添加设备失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 删除设备 */
      case "ir_device_delete_result": {
        loading.value = false;
        if (data.success !== false) {
          const devId = String(data.device_id ?? "");
          devices.value = devices.value.filter((d) => d.device_id !== devId);
          if (currentDevice.value?.device_id === devId) {
            currentDevice.value = null;
          }
          appStore.showToast("设备已删除", "success");
        } else {
          appStore.showToast(`删除设备失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 更新设备 */
      case "ir_device_update_result": {
        loading.value = false;
        if (data.success !== false && data.device) {
          const updated = _normalizeDevice(data.device);
          const idx = devices.value.findIndex((d) => d.device_id === updated.device_id);
          if (idx !== -1) {
            devices.value[idx] = updated;
            if (currentDevice.value?.device_id === updated.device_id) {
              currentDevice.value = updated;
            }
          }
          appStore.showToast("设备信息已更新", "success");
        } else {
          appStore.showToast(`更新设备失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 学习结果 */
      case "ir_learn_result": {
        _clearLearnTimers();
        const success = data.success !== false;
        if (success && data.button) {
          const btn = data.button as Record<string, unknown>;
          learnState.value = "success";
          learnedButton.value = {
            device_id: String(data.device_id ?? ""),
            button_id: String(btn.id ?? `btn-${Date.now()}`),
            index: typeof btn.index === "number" ? btn.index : 0,
            code_length: typeof btn.code_length === "number" ? btn.code_length : 0,
          };
          // 立即将新按键添加到本地设备列表，确保命名和显示同步
          const devId = String(data.device_id ?? "");
          const idx = devices.value.findIndex((d) => d.device_id === devId);
          if (idx !== -1) {
            const dev = { ...devices.value[idx] };
            const newButton: IRButton = {
              id: String(btn.id ?? `btn-${Date.now()}`),
              name: String(btn.name ?? `按键${btn.index ?? 0}`),
              index: typeof btn.index === "number" ? btn.index : 0,
              code_length: typeof btn.code_length === "number" ? btn.code_length : 0,
              type: String(btn.type ?? "stateless"),
            };
            dev.buttons = [...dev.buttons, newButton];
            devices.value[idx] = dev;
            if (currentDevice.value?.device_id === devId) {
              currentDevice.value = dev;
            }
          }
          appStore.showToast("学习成功，请为按键命名", "success");
        } else {
          learnState.value = "timeout";
          appStore.showToast(`学习失败: ${String(data.message ?? "超时或读取失败")}`, "error");
        }
        break;
      }

      /* 发射结果 */
      case "ir_send_result": {
        const buttonId = String(data.button_id ?? "");
        const success = data.success !== false;
        if (buttonId) {
          sendStatusMap.value = { ...sendStatusMap.value, [buttonId]: success ? "success" : "fail" };
          // 短暂闪烁后清除状态
          setTimeout(() => {
            sendStatusMap.value = { ...sendStatusMap.value, [buttonId]: null };
          }, 1200);
        }
        // toggle 按键更新设备状态
        if (success && data.device_id && data.new_state) {
          const devId = String(data.device_id);
          const idx = devices.value.findIndex((d) => d.device_id === devId);
          if (idx !== -1) {
            const dev = { ...devices.value[idx] };
            dev.state = String(data.new_state);
            devices.value[idx] = dev;
            if (currentDevice.value?.device_id === devId) {
              currentDevice.value = dev;
            }
          }
        }
        if (!success) {
          appStore.showToast(`发射失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 按键重命名 */
      case "ir_button_rename_result": {
        if (data.success !== false && data.button) {
          const btn = data.button as Record<string, unknown>;
          const devId = String(data.device_id ?? "");
          const btnId = String(btn.id ?? "");
          const newName = String(btn.name ?? "");
          const idx = devices.value.findIndex((d) => d.device_id === devId);
          if (idx !== -1) {
            const dev = { ...devices.value[idx] };
            dev.buttons = dev.buttons.map((b) =>
              b.id === btnId ? { ...b, name: newName || b.name } : b,
            );
            devices.value[idx] = dev;
            if (currentDevice.value?.device_id === devId) {
              currentDevice.value = dev;
            }
          }
          appStore.showToast("按键已重命名", "success");
        } else {
          appStore.showToast(`重命名失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 按键删除 */
      case "ir_button_delete_result": {
        if (data.success !== false && data.device_id && data.button_id) {
          const devId = String(data.device_id);
          const btnId = String(data.button_id);
          const idx = devices.value.findIndex((d) => d.device_id === devId);
          if (idx !== -1) {
            const dev = { ...devices.value[idx] };
            dev.buttons = dev.buttons.filter((b) => b.id !== btnId);
            devices.value[idx] = dev;
            if (currentDevice.value?.device_id === devId) {
              currentDevice.value = dev;
            }
          }
          appStore.showToast("按键已删除", "success");
        } else {
          appStore.showToast(`删除按键失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 导出码库 */
      case "ir_export_result": {
        loading.value = false;
        if (data.success !== false && data.devices != null) {
          _downloadJSON(data, `ir_codes_${Date.now()}.json`);
          appStore.showToast("码库已导出", "success");
        } else {
          appStore.showToast(`导出失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }

      /* 导入码库 */
      case "ir_import_result": {
        loading.value = false;
        if (data.success !== false) {
          const count = typeof data.imported_count === "number" ? data.imported_count : 0;
          appStore.showToast(`导入完成，共 ${count} 个设备`, "success");
          // 重新加载设备列表以获取最新数据
          loadDevices();
        } else {
          const detail = data.detail as Record<string, unknown> | undefined;
          const errors = detail?.errors;
          const errMsg = Array.isArray(errors) && errors.length > 0
            ? String(errors[0])
            : String(data.error ?? data.message ?? "未知错误");
          appStore.showToast(`导入失败: ${errMsg}`, "error");
        }
        break;
      }

      default:
        break;
    }
  }

  /* ---- 辅助函数 ---- */

  function _normalizeDevice(raw: any): IRDevice {
    return {
      device_id: String(raw.device_id ?? raw.id ?? ""),
      name: String(raw.name ?? "未命名设备"),
      brand: String(raw.brand ?? ""),
      model: String(raw.model ?? ""),
      category: String(raw.category ?? "other"),
      state: String(raw.state ?? "off"),
      buttons: Array.isArray(raw.buttons)
        ? raw.buttons.map((b: any) => ({
            id: String(b.id ?? `btn-${b.index ?? 0}`),
            name: String(b.name ?? `按键${b.index ?? 0}`),
            index: typeof b.index === "number" ? b.index : 0,
            code_length: typeof b.code_length === "number" ? b.code_length : 0,
            type: String(b.type ?? "stateless"),
          }))
        : [],
    };
  }

  function _downloadJSON(data: unknown, filename: string): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ---- 业务方法 ---- */

  /** 获取设备列表 */
  function loadDevices(): void {
    loading.value = true;
    send({ type: "ir_device_list", data: {} });
  }

  /** 新增设备 */
  function addDevice(data: {
    name: string;
    brand?: string;
    model?: string;
    category?: string;
  }): void {
    loading.value = true;
    send({
      type: "ir_device_add",
      data: {
        name: data.name,
        brand: data.brand ?? "",
        model: data.model ?? "",
        category: data.category ?? "other",
      },
    });
  }

  /** 删除设备 */
  function deleteDevice(deviceId: string): void {
    loading.value = true;
    send({ type: "ir_device_delete", data: { device_id: deviceId } });
  }

  /** 更新设备 */
  function updateDevice(
    deviceId: string,
    data: { name?: string; brand?: string; model?: string; category?: string },
  ): void {
    loading.value = true;
    const payload: Record<string, unknown> = { device_id: deviceId };
    if (data.name !== undefined) payload.name = data.name;
    if (data.brand !== undefined) payload.brand = data.brand;
    if (data.model !== undefined) payload.model = data.model;
    if (data.category !== undefined) payload.category = data.category;
    send({ type: "ir_device_update", data: payload });
  }

  /** 开始学习 */
  function startLearn(deviceId: string): void {
    _clearLearnTimers();
    learnState.value = "learning";
    learnedButton.value = null;
    learnCountdown.value = 30;
    send({ type: "ir_learn_start", data: { device_id: deviceId } });

    // 倒计时动画
    _learnCountdownTimer = setInterval(() => {
      learnCountdown.value = Math.max(0, learnCountdown.value - 1);
    }, 1000);

    // 30 秒超时
    _learnTimer = setTimeout(() => {
      _clearLearnTimers();
      if (learnState.value === "learning") {
        learnState.value = "timeout";
        appStore.showToast("学习超时，请重试", "error");
      }
    }, 30000);
  }

  /** 取消学习（仅前端取消等待，后端学习超时会自动退出） */
  function cancelLearn(): void {
    _clearLearnTimers();
    learnState.value = "idle";
    learnCountdown.value = 0;
  }

  /** 重命名按键 */
  function renameButton(deviceId: string, buttonId: string, name: string): void {
    send({
      type: "ir_button_rename",
      data: { device_id: deviceId, button_id: buttonId, name },
    });
  }

  /** 删除按键 */
  function deleteButton(deviceId: string, buttonId: string): void {
    send({
      type: "ir_button_delete",
      data: { device_id: deviceId, button_id: buttonId },
    });
  }

  /** 发射红外信号 */
  function sendIR(deviceId: string, buttonId: string): void {
    send({
      type: "ir_send",
      data: { device_id: deviceId, button_id: buttonId },
    });
  }

  /** 导出码库（不传 deviceId 则导出全部） */
  function exportCodes(deviceId?: string): void {
    loading.value = true;
    const payload: Record<string, unknown> = {};
    if (deviceId) payload.device_id = deviceId;
    send({ type: "ir_codes_export", data: payload });
  }

  /** 导入码库 */
  function importCodes(
    data: unknown,
    conflictPolicy: "skip" | "overwrite" = "skip",
  ): void {
    loading.value = true;
    send({
      type: "ir_codes_import",
      data: {
        data: data,
        conflict_policy: conflictPolicy,
      },
    });
  }

  /** 选中设备 */
  function selectDevice(device: IRDevice | null): void {
    currentDevice.value = device;
  }

  /** 重置学习状态 */
  function resetLearnState(): void {
    _clearLearnTimers();
    learnState.value = "idle";
    learnCountdown.value = 0;
    learnedButton.value = null;
  }

  return {
    // 状态
    devices,
    currentDevice,
    learnState,
    loading,
    learnedButton,
    learnCountdown,
    sendStatusMap,
    // 方法
    loadDevices,
    addDevice,
    deleteDevice,
    updateDevice,
    startLearn,
    cancelLearn,
    renameButton,
    deleteButton,
    sendIR,
    exportCodes,
    importCodes,
    selectDevice,
    resetLearnState,
  };
}
