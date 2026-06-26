import { ref } from "vue";
import { useAppStore } from "../stores/app";
import { useDevicesStore } from "../stores/devices";
import { useRobotStore, type CameraInfo } from "../stores/robot";
import { resolveWebRTCAnswer, handleWebRTCIceCandidate } from "./useWebRTC";
import type { DanceInfo, Module, MusicStatus, MusicTrack, ServiceInfo, Software } from "../types";

/* ============================================================
 * wo-bot-web-debug - WebSocket + WebRTC 通信层
 *
 * WebSocket 承载: 设备发现握手 + 协议版本协商 + WebRTC 信令 + 所有业务消息
 * WebRTC DataChannel: 优先级更高，就绪时使用；未就绪时 WebSocket 降级
 * ============================================================ */

/** 当前客户端协议版本，与服务端兼容性检查中的 min_protocol_version 对应 */
export const PROTOCOL_VERSION = 1;

const CONNECT_TIMEOUT = 5000;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT = 30; // WiFi 切换后可能需要更长时间恢复
const MAX_INITIAL_RETRIES = 3; // 首次连接失败最多重试 3 次
const HEARTBEAT_INTERVAL = 15000; // 心跳间隔 15s
const HEARTBEAT_TIMEOUT = 5000; // 心跳超时 5s（无 pong 则认为断开）

// ---- 模块级单例 ----
let _ws: WebSocket | null = null;
let _connectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const _connectedIp = ref("");
const _connectedPort = ref(0);
let _token = "";
/** 标记是否为主动断开，防止 onclose 触发无意义重连 */
let _intentionalDisconnect = false;

// ---- 心跳 ----
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _lastPongTime = 0; // 最后收到 pong 的时间戳

/** 重连时触发 WebRTC 握手（由 App.vue 设置） */
let _onReconnect: (() => void) | null = null;
export function setOnReconnect(fn: (() => void) | null): void {
  _onReconnect = fn;
}

/** 版本不匹配回调（由 App.vue 设置，在收到 4001 关闭码时触发） */
let _onVersionMismatch: (() => void) | null = null;
export function setOnVersionMismatch(fn: (() => void) | null): void {
  _onVersionMismatch = fn;
}

/** 握手是否已通过（收到 connected 消息为 true） */
let _handshakeAccepted = false;

/** 调试用：覆盖发送的协议版本（-1 = 使用 PROTOCOL_VERSION，>= 0 强制使用该值） */
let _debugProtocolVersion = -1;

// 从 URL 参数读取调试协议版本: ?debug_pv=N
try {
  const urlParams = new URLSearchParams(window.location.search);
  const debugPv = urlParams.get("debug_pv");
  if (debugPv !== null) {
    const pv = parseInt(debugPv, 10);
    if (!isNaN(pv)) {
      _debugProtocolVersion = pv;
      console.log("[WS] 调试模式: 协议版本覆盖为", pv);
    }
  }
} catch {
  // SSR / 无 window 环境忽略
}

export function setDebugProtocolVersion(v: number): void {
  _debugProtocolVersion = v;
}
export function getDebugProtocolVersion(): number {
  return _debugProtocolVersion;
}

/** 消息监听器（供组件订阅特定消息类型） */
type MessageListener = (msg: { type: string; data?: any }) => void;
const _messageListeners: Set<MessageListener> = new Set();

export function onMessage(fn: MessageListener): () => void {
  _messageListeners.add(fn);
  return () => {
    _messageListeners.delete(fn);
  };
}

interface WsMsg {
  type: string;
  data?: Record<string, unknown>;
}

// ---- 模块级 DataChannel 引用（由 useWebRTC 设置） ----
let _dc: RTCDataChannel | null = null;
let _pendingQueue: string[] = [];
/** 服务端支持的功能列表（从 connected 消息解析） */
const _remoteFeatures = ref<string[]>([]);
export function getRemoteFeatures(): string[] {
  return _remoteFeatures.value;
}

/** 响应式 DataChannel 就绪状态（供 Vue computed 使用） */
export const dcReady = ref(false);

export function setDataChannel(dc: RTCDataChannel | null): void {
  _dc = dc;
  dcReady.value = dc !== null && dc.readyState === "open";
  // DC 就绪时，清空待发送队列
  if (dc) {
    dc.addEventListener("open", () => {
      dcReady.value = true;
      const q = _pendingQueue;
      _pendingQueue = [];
      for (const p of q) dc.send(p);
    });
    dc.addEventListener("close", () => {
      dcReady.value = false;
    });
    // 如果已经打开，立即清空
    if (dc.readyState === "open") {
      dcReady.value = true;
      const q = _pendingQueue;
      _pendingQueue = [];
      for (const p of q) dc.send(p);
    }
  }
}

/** 由 DataChannel pong 路径调用来同步更新心跳时间戳 */
export function refreshHeartbeatPongTime(): void {
  _lastPongTime = Date.now();
}

export function getSignalingWs(): WebSocket | null {
  return _ws;
}

export function getConnectedEndpoint(): { ip: string; port: number } {
  return { ip: _connectedIp.value, port: _connectedPort.value };
}

/** 检查 DataChannel 是否就绪 */
export function isDataChannelReady(): boolean {
  return dcReady.value;
}

/** 获取当前排队的消息数量 */
export function getPendingQueueSize(): number {
  return _pendingQueue.length;
}

/** 设置认证 token（在 connect 前调用） */
export function setAuthToken(token: string): void {
  _token = token;
}

/** 最大排队消息数量，防止断连时内存泄漏 */
const MAX_PENDING_QUEUE = 50;

// 通用发送：优先 DataChannel；DC 未就绪时用 WebSocket；都不行则暂存队列
function _send(frame: WsMsg, forceWs = false): void {
  const payload = JSON.stringify(frame);
  if (!forceWs && _dc && _dc.readyState === "open") {
    console.log("[WS.send] via DataChannel:", frame.type, frame.data);
    _dc.send(payload);
  } else if (_ws && _ws.readyState === WebSocket.OPEN) {
    console.log("[WS.send] via WebSocket:", frame.type, frame.data);
    _ws.send(payload);
  } else {
    if (_pendingQueue.length >= MAX_PENDING_QUEUE) {
      // 队列过长，丢弃最旧的消息
      _pendingQueue.shift();
    }
    console.warn(
      "[WS.send] queued (pending):",
      frame.type,
      frame.data,
      "| dc:",
      !!_dc,
      _dc?.readyState,
      "ws:",
      !!_ws,
      _ws?.readyState,
    );
    _pendingQueue.push(payload);
  }
}

export function useWebSocket() {
  const reconnectCount = ref(0);
  const lastMessage = ref<WsMsg | null>(null);
  const ws = ref<WebSocket | null>(null);

  const appStore = useAppStore();
  const devicesStore = useDevicesStore();
  const robotStore = useRobotStore();

  function connect(ip: string, port: number): void {
    console.log("[WS] connect() 调用:", {
      ip,
      port,
      currentIp: _connectedIp.value,
      currentPort: _connectedPort.value,
      hasWs: !!_ws,
      readyState: _ws?.readyState,
      intentionalDisconnect: _intentionalDisconnect,
    });

    // 清理旧连接（如果有的话）
    if (_ws) {
      console.log("[WS] connect() 断开旧连接, readyState:", _ws.readyState);
      // 先标记然后断开，旧 socket 的异步 onclose 不会触发重连
      _intentionalDisconnect = true;
      disconnect();
    }
    _intentionalDisconnect = false;
    _handshakeAccepted = false;
    appStore.connection = "connecting";
    _connectedIp.value = ip;
    _connectedPort.value = port;
    // 开发模式通过 Vite WebSocket 代理连接，绕过浏览器跨域/IP 限制
    const pv = _debugProtocolVersion >= 0 ? _debugProtocolVersion : PROTOCOL_VERSION;
    let url: string;
    if (import.meta.env.DEV) {
      url = `ws://${window.location.host}/api/device-ws?host=${encodeURIComponent(ip)}&port=${port}&protocol_version=${pv}`;
    } else {
      url = `ws://${ip}:${port}?protocol_version=${pv}`;
    }
    if (_token) {
      url += `&token=${encodeURIComponent(_token)}`;
    }
    console.log("[WS] connect() 创建 WebSocket:", url);
    const socket = new WebSocket(url);
    _ws = socket;
    ws.value = socket;

    _connectTimer = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        console.warn("[WS] 连接超时:", { ip, port, readyState: socket.readyState });
        socket.close();
        appStore.connection = "error";
        appStore.showToast(`连接超时: ${ip}:${port}`, "error");
        robotStore.addLog("error", "Signaling", `连接超时: ${ip}:${port}`);
        maybeReconnect(ip, port);
      }
    }, CONNECT_TIMEOUT);

    socket.onopen = () => {
      console.log("[WS] onopen: 已连接", { ip, port });
      if (_connectTimer) {
        clearTimeout(_connectTimer);
        _connectTimer = null;
      }
      // 版本协商已通过 URL query 参数完成，等待服务端 connected 消息确认
      // 不在此处设置 connected 状态，避免服务端因版本问题立即断开时的误报
      // 清空 WebSocket 待发送队列
      if (_pendingQueue.length > 0) {
        const q = _pendingQueue;
        _pendingQueue = [];
        for (const p of q) socket.send(p);
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      // 文本消息 = JSON 协议
      try {
        const frame: WsMsg = JSON.parse(event.data as string);
        lastMessage.value = frame;
        handleSignalingMessage(frame);
      } catch {
        robotStore.addLog("warn", "Signaling", "收到非 JSON 消息");
      }
    };

    socket.onerror = (_event: Event) => {
      console.error("[WS] onerror 触发:", { ip, port, readyState: socket.readyState, isActive: socket === _ws });
      appStore.connection = "error";
      appStore.showToast(`连接失败: ${ip}:${port}`, "error");
      robotStore.addLog("error", "Signaling", `连接错误: ${ip}:${port}`);
    };

    socket.onclose = (event: CloseEvent) => {
      console.log("[WS] onclose 触发:", {
        ip,
        port,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        isActive: socket === _ws,
        intentionalDisconnect: _intentionalDisconnect,
        handshakeAccepted: _handshakeAccepted,
      });
      // 只处理当前活跃 socket 的关闭事件，忽略已替换的旧 socket
      if (socket !== _ws) {
        console.log("[WS] onclose 忽略: 旧 socket (已被替换)");
        return;
      }
      stopHeartbeat();
      // 服务端明确拒绝 (code >= 4000): 不重连
      if (!_intentionalDisconnect && event.code >= 4000) {
        console.log("[WS] 服务端拒绝连接, code:", event.code);
        _intentionalDisconnect = true;
        // 4001 是版本不匹配，弹窗提示
        if (event.code === 4001) {
          if (_onVersionMismatch) _onVersionMismatch();
        }
      }
      appStore.connection = "disconnected";
      appStore.setSSHConnected(false);
      robotStore.addLog("warn", "Signaling", `信令已断开: ${ip}:${port}`);
      maybeReconnect(ip, port);
    };
  }

  function disconnect(): void {
    console.log("[WS] disconnect() 主动断开", {
      currentIp: _connectedIp.value,
      currentPort: _connectedPort.value,
      hasWs: !!_ws,
      readyState: _ws?.readyState,
    });
    _intentionalDisconnect = true;
    _handshakeAccepted = false;
    _clearTimers();
    stopHeartbeat();
    if (_ws) {
      _ws.close();
      _ws = null;
    }
    ws.value = null;
    appStore.connection = "disconnected";
    _remoteFeatures.value = []; // 清空 features，下次连接重新获取
    appStore.setSSHConnected(false);
    robotStore.addLog("info", "Signaling", "主动断开信令");
  }

  // ---- 心跳 ----
  function startHeartbeat(): void {
    stopHeartbeat();
    _lastPongTime = Date.now();
    _heartbeatTimer = setInterval(() => {
      // 检查 WebSocket 是否仍然存活
      if (!_ws || _ws.readyState === WebSocket.CLOSED || _ws.readyState === WebSocket.CLOSING) {
        console.warn("[WS] 心跳检测: WebSocket 已断开, readyState:", _ws?.readyState);
        stopHeartbeat();
        // 主动触发重连
        if (_connectedIp.value && _connectedPort.value) {
          robotStore.addLog("warn", "Signaling", "检测到连接断开，尝试重连...");
          maybeReconnect(_connectedIp.value, _connectedPort.value);
        }
        return;
      }
      // 检查上次 pong 是否超时
      if (Date.now() - _lastPongTime > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
        console.warn("[WS] 心跳超时: 无 pong 回应 >", HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT, "ms");
        robotStore.addLog("warn", "Signaling", "心跳超时，连接已断开");
        // 关闭当前连接，onclose 会触发重连
        _ws.close();
        return;
      }
      // 心跳始终通过 WebSocket 直接发送，不经过 _send()
      // 原因：_send() 优先走 DataChannel，但 DataChannel pong 响应更新的是
      // appStore._lastPing 而非 _lastPongTime，导致心跳超时误关闭 WebSocket
      _ws.send(JSON.stringify({ type: "ping", data: { ts: Date.now() } }));
    }, HEARTBEAT_INTERVAL);
  }

  function stopHeartbeat(): void {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  function maybeReconnect(ip: string, port: number): void {
    console.log("[WS] maybeReconnect() 检查:", {
      ip,
      port,
      intentionalDisconnect: _intentionalDisconnect,
      wasConnected: _handshakeAccepted,
      reconnectCount: reconnectCount.value,
      maxReconnect: MAX_RECONNECT,
      mockMode: appStore.mockMode,
    });
    if (_intentionalDisconnect) {
      console.log("[WS] maybeReconnect() 跳过: 主动断开或服务端拒绝");
      return;
    }
    if (appStore.mockMode) {
      console.log("[WS] maybeReconnect() 跳过: Mock 模式");
      return;
    }
    // 首次连接未成功过 (_handshakeAccepted=false): 最多重试 3 次
    const maxRetries = _handshakeAccepted ? MAX_RECONNECT : MAX_INITIAL_RETRIES;
    if (reconnectCount.value >= maxRetries) {
      console.log("[WS] maybeReconnect() 跳过: 已达最大重连次数", reconnectCount.value, "/", maxRetries);
      return;
    }
    reconnectCount.value++;
    const strategy = _handshakeAccepted ? "保活" : "首次连接";
    console.log("[WS] maybeReconnect() 安排重连 (", strategy, "):", reconnectCount.value, "/", maxRetries);
    robotStore.addLog("info", "Signaling", `正在尝试重连 (${reconnectCount.value}/${maxRetries})...`);
    _reconnectTimer = setTimeout(() => connect(ip, port), RECONNECT_DELAY * reconnectCount.value);
  }

  function _clearTimers(): void {
    if (_connectTimer) {
      clearTimeout(_connectTimer);
      _connectTimer = null;
    }
    if (_reconnectTimer) {
      clearTimeout(_reconnectTimer);
      _reconnectTimer = null;
    }
  }

  /** 处理所有消息（信令 + 业务响应，统一通过 WebSocket） */
  function handleSignalingMessage(msg: WsMsg): void {
    const data = msg.data ?? {};
    switch (msg.type) {
      // ---- 信令层 ----
      case "connected":
        _handshakeAccepted = true;
        appStore.connection = "connected";
        appStore.showToast("信令通道已建立", "success");
        reconnectCount.value = 0;
        robotStore.addLog("info", "Signaling", `信令已连接到 ${_connectedIp.value}:${_connectedPort.value}`);
        devicesStore.setRobotInfo({
          robot_id: String(data.robot_id ?? ""),
          name: String(data.name ?? ""),
          model: String(data.model ?? ""),
          version: String(data.version ?? ""),
          features: Array.isArray(data.features) ? (data.features as string[]) : [],
        });
        _remoteFeatures.value = Array.isArray(data.features) ? (data.features as string[]) : [];
        // 连接成功后自动订阅状态 + 获取摄像头列表
        _send({ type: "subscribe", data: { events: ["status"] } });
        requestCameraStatus();
        // 清空 WebSocket 待发送队列
        if (_pendingQueue.length > 0) {
          const q = _pendingQueue;
          _pendingQueue = [];
          for (const p of q) _ws!.send(p);
        }
        // 自动重连时也触发 WebRTC 握手
        if (_onReconnect) _onReconnect();
        // 启动心跳
        startHeartbeat();
        break;
      case "webrtc_answer":
        resolveWebRTCAnswer(String(data.sdp ?? ""));
        break;
      case "webrtc_ice_candidate":
        console.log("[WS] 转发 ICE candidate", {
          candidate: (data.candidate as string)?.substring(0, 60),
          sdpMid: data.sdpMid,
          sdpMLineIndex: data.sdpMLineIndex,
        });
        handleWebRTCIceCandidate(
          String(data.candidate ?? ""),
          data.sdpMid != null ? String(data.sdpMid) : null,
          data.sdpMLineIndex != null ? Number(data.sdpMLineIndex) : null,
        );
        break;

      // ---- 业务响应 ----
      case "status": {
        const batt = (data.battery ?? {}) as Record<string, unknown>;
        const sys = (data.system ?? {}) as Record<string, unknown>;
        const net = (data.network ?? {}) as Record<string, unknown>;
        robotStore.setSystemStatus({
          battery: {
            level: Number(batt.level ?? 0),
            status: String(batt.status ?? "discharging"),
            state: batt.level ? `${batt.level}%` : "--",
            temp: Number(batt.temperature ?? 0),
          },
          cpu: { usage: Number(sys.cpu_percent ?? 0), temp: Number(sys.temperature ?? 0) },
          memory: { usage: Number(sys.memory_percent ?? 0) },
          disk: { usage: Number(sys.disk_percent ?? 0) },
          wifi: {
            ssid: String(net.ssid ?? "--"),
            signal: net.signal_strength != null ? `${net.signal_strength} dBm` : "--",
            ip: String(net.ip ?? "--"),
          },
          cellular: { signal: "--", carrier: "--" },
          environment: { temperature: "--", humidity: "--", gas: "--", light: "--" },
          uptime: Number(sys.uptime ?? 0),
          hostname: String(sys.hostname ?? "--"),
        });
        // 从 status 中同步 features（确保平板等客户端也能获取最新功能列表）
        if (Array.isArray(data.features) && data.features.length > 0) {
          _remoteFeatures.value = data.features as string[];
        }
        // 从 status 中同步服务状态
        if (Array.isArray(data.services)) {
          robotStore.setServices(data.services as ServiceInfo[]);
        }
        break;
      }
      case "service_status": {
        if (Array.isArray(data.services)) {
          robotStore.setServices(data.services as ServiceInfo[]);
        }
        break;
      }
      case "service_message": {
        const svcMsg = data as Record<string, unknown>;
        robotStore.addMessage({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          subject: String(svcMsg.subject ?? "服务通知"),
          time: Date.now(),
          summary: String(svcMsg.summary ?? ""),
          body: String(svcMsg.body ?? ""),
          read: false,
          source: String(svcMsg.source ?? "service_manager"),
          severity: (["info", "warning", "error"].includes(String(svcMsg.severity)) ? svcMsg.severity : "info") as
            | "info"
            | "warning"
            | "error",
        });
        break;
      }
      case "service_control_ack": {
        robotStore.addLog("info", "Service", `${data.service_id} → ${data.action} (${data.status})`);
        if (Array.isArray(data.services) && data.services.length > 0) {
          robotStore.setServices(data.services as ServiceInfo[]);
        }
        break;
      }
      case "dance_list": {
        robotStore.setDances(Array.isArray(data.dances) ? (data.dances as DanceInfo[]) : []);
        break;
      }
      case "dance_status": {
        robotStore.setDanceStatus(
          String(data.status ?? "stopped") as "stopped" | "playing" | "paused",
          data.dance_id != null ? String(data.dance_id) : null,
          typeof data.progress === "number" ? data.progress : undefined,
        );
        break;
      }
      case "exec_result": {
        const stdout = String(data.stdout ?? ""),
          stderr = String(data.stderr ?? "");
        if (stdout) robotStore.addSSHOutput({ type: "out", text: stdout.trim() });
        if (stderr) robotStore.addSSHOutput({ type: "err", text: stderr.trim() });
        if (data.return_code !== undefined)
          robotStore.addSSHOutput({ type: "cmd", text: `[exit: ${data.return_code}]` });
        if (data.cwd !== undefined) robotStore.setShellCwd(String(data.cwd));
        break;
      }
      case "pong":
        _lastPongTime = Date.now();
        appStore._lastPing = _lastPongTime;
        break;
      case "logs": {
        const logs = Array.isArray(data.logs) ? (data.logs as Array<Record<string, unknown>>) : [];
        for (const l of logs) {
          const level = (["debug", "info", "warn", "error"].includes(String(l.level)) ? l.level : "info") as
            | "debug"
            | "info"
            | "warn"
            | "error";
          robotStore.addLog(level, String(l.source ?? "remote"), String(l.message ?? ""));
        }
        break;
      }
      case "motion_ack":
        robotStore.addCmdLog({
          time: new Date().toLocaleTimeString(),
          direction: "recv",
          type: "motion",
          data: `v=${data.linear} ω=${data.angular}`,
        });
        break;
      case "emergency_stop_ack":
        robotStore.addCmdLog({
          time: new Date().toLocaleTimeString(),
          direction: "recv",
          type: "emergency",
          data: "急停已确认",
        });
        appStore.showToast("急停已触发", "error");
        break;
      case "system_ack":
        robotStore.addLog("info", "System", `${data.action} → ${data.status}`);
        break;
      case "module_list": {
        robotStore.setModules(Array.isArray(data.modules) ? (data.modules as Module[]) : []);
        break;
      }
      case "module_control_ack":
        robotStore.addLog("info", "Module", `${data.module_id} → ${data.action} (${data.status})`);
        break;
      case "device_control_ack":
        robotStore.addLog("info", "Device", `${data.action} → ${data.enabled ? "ON" : "OFF"}`);
        break;
      case "software_install_ack":
      case "software_uninstall_ack":
      case "software_upgrade_ack":
        robotStore.addLog("info", "Software", `${data.package} → ${data.status}`);
        break;
      case "gimbal_status":
        robotStore.setGimbal(
          typeof data.pan === "number" ? data.pan : 90,
          typeof data.tilt === "number" ? data.tilt : 90,
        );
        robotStore.addLog("info", "Gimbal", `云台 pan=${data.pan}° tilt=${data.tilt}°`);
        break;
      case "gimbal_limit":
        robotStore.setGimbal(
          typeof data.pan === "number" ? data.pan : 90,
          typeof data.tilt === "number" ? data.tilt : 90,
        );
        const limitAxis = (data.limit_axis || data.axis || "pan") === "pan" ? "水平" : "俯仰";
        const limitDir = (data.limit || "min") === "max" ? "最大" : "最小";
        appStore.showToast(`云台${limitAxis}已到达${limitDir}限位`, "info");
        robotStore.addLog("warn", "Gimbal", `限位: ${limitAxis} ${limitDir}`);
        break;
      case "camera_status": {
        if (Array.isArray((data as Record<string, unknown>).cameras)) {
          robotStore.setCameras((data as Record<string, unknown>).cameras as CameraInfo[]);
        } else if (typeof (data as Record<string, unknown>).id === "number") {
          robotStore.updateCameraStatus(
            (data as Record<string, unknown>).id as number,
            String((data as Record<string, unknown>).status || "stopped"),
            (data as Record<string, unknown>).stream_url as string | undefined,
          );
        }
        break;
      }
      case "software_list": {
        if (Array.isArray(data.packages)) {
          robotStore.setInstalledSoftware(data.packages as Software[]);
        }
        break;
      }
      case "software_search_result": {
        if (Array.isArray(data.packages)) {
          robotStore.setAvailableSoftware(data.packages as Software[]);
        }
        break;
      }
      case "error":
        appStore.showToast(`错误: ${String(data.message ?? "未知错误")}`, "error");
        robotStore.addLog("error", "Signaling", String(data.message ?? ""));
        console.error(`[Signaling:error] ${String(data.message ?? "未知错误")}`);
        break;

      // ---- WiFi 管理 ----
      case "wifi_scan_result": {
        robotStore.setWifiNetworks({
          currentSsid: String(data.current_ssid ?? ""),
          currentDevice: String(data.current_device ?? ""),
          networks: Array.isArray(data.networks)
            ? (data.networks as Array<{ ssid: string; signal: number; security: string; connected: boolean }>)
            : [],
        });
        break;
      }
      case "wifi_connect_result": {
        const wifiStatus = String(data.status ?? "");
        if (wifiStatus === "connected") {
          appStore.showToast(`已连接到 ${data.ssid}`, "success");
          robotStore.addLog("info", "WiFi", `已连接到 ${data.ssid}`);
        } else {
          appStore.showToast(`WiFi 连接失败: ${data.ssid}`, "error");
          robotStore.addLog("error", "WiFi", `连接 ${data.ssid} 失败: ${data.error || data.output || ""}`);
        }
        break;
      }
      case "wifi_disconnect_result":
        appStore.showToast("WiFi 已断开", "info");
        robotStore.addLog("info", "WiFi", "WiFi 已断开");
        break;

      // ---- 音乐播放 ----
      case "music_status": {
        if ((data as Record<string, unknown>).error) {
          appStore.showToast(`音乐播放错误: ${String((data as Record<string, unknown>).error)}`, "error");
          robotStore.setMusicStatus({ ...robotStore.musicStatus, status: "stopped" });
        } else {
          robotStore.setMusicStatus(data as unknown as MusicStatus);
        }
        break;
      }
      case "music_action": {
        // 直接命令响应（play/pause/next/prev/stop/seek），服务不可用时返回此类型
        // 合并到 musicStatus 提供即时反馈（#16 解决按钮点击无反应）
        const actionData = data as Record<string, unknown>;
        robotStore.setMusicStatus({
          ...robotStore.musicStatus,
          status: (actionData.status as MusicStatus["status"]) ?? robotStore.musicStatus.status,
          volume: typeof actionData.volume === "number" ? actionData.volume : robotStore.musicStatus.volume,
          position: typeof actionData.position === "number" ? actionData.position : robotStore.musicStatus.position,
          current_track: (actionData.current_track as MusicTrack | null) ?? robotStore.musicStatus.current_track,
          playlist: Array.isArray(actionData.playlist)
            ? (actionData.playlist as MusicTrack[])
            : robotStore.musicStatus.playlist,
          active_source: (actionData.active_source as string | null) ?? robotStore.musicStatus.active_source,
        });
        break;
      }
      case "music_list": {
        if (Array.isArray((data as Record<string, unknown>).songs)) {
          robotStore.setMusicSongs((data as Record<string, unknown>).songs as unknown as MusicTrack[]);
        }
        break;
      }
      case "music_volume": {
        const volStatus = { ...robotStore.musicStatus, volume: Number((data as Record<string, unknown>).volume ?? 75) };
        robotStore.setMusicStatus(volStatus);
        break;
      }
      case "music_stream":
      case "music_playlist": {
        if (data.playlist) {
          const ms = { ...robotStore.musicStatus, playlist: data.playlist as unknown as MusicTrack[] };
          robotStore.setMusicStatus(ms);
        } else if (typeof data.streaming === "boolean") {
          const ms = {
            ...robotStore.musicStatus,
            streaming: data.streaming as boolean,
            stream_type: String(data.stream_type ?? null),
          };
          robotStore.setMusicStatus(ms);
        }
        break;
      }
    }
    // 通知所有消息监听器
    _messageListeners.forEach((fn) => {
      try {
        fn(msg as any);
      } catch {}
    });
  }

  /* ---- 便捷发送（走 DataChannel） ---- */
  function sendMotion(v_x: number, v_y: number, v_z_or_mode: number | string = 0): void {
    // 三轴麦轮协议: sendMotion(v_x, v_y, v_z)
    if (typeof v_z_or_mode === "number") {
      _send({ type: "motion", data: { v_x, v_y, v_z: v_z_or_mode } });
    } else {
      // 双轴兼容协议: sendMotion(linear, angular, mode)
      _send({ type: "motion", data: { linear: v_x, angular: v_y, mode: v_z_or_mode } });
    }
  }
  function sendMotionStop(): void {
    _send({ type: "motion_stop", data: {} });
  }
  function sendEmergencyStop(): void {
    _send({ type: "emergency_stop", data: {} });
  }
  function sendEmergencyRelease(): void {
    _send({ type: "emergency_release", data: {} });
  }
  function sendSystemAction(action: string): void {
    _send({ type: "system", data: { action } });
  }
  function sendExec(command: string, timeout = 5000): void {
    _send({ type: "exec", data: { command, timeout } });
  }
  function sendCamera(action: string, cameraId = 0): void {
    _send({ type: "camera", data: { action, camera_id: cameraId } });
  }
  function requestCameraStatus(): void {
    _send({ type: "camera", data: { action: "list" } });
  }
  function sendGimbal(axis: string, angle: number): void {
    _send({ type: "gimbal", data: { axis, angle } });
  }
  function sendGimbalMove(panDelta: number, tiltDelta: number, step: number = 3.0): void {
    _send({ type: "gimbal", data: { action: "move", pan_delta: panDelta, tilt_delta: tiltDelta, step } });
  }
  function sendGimbalMoveBegin(panSpeed: number, tiltSpeed: number): void {
    _send({ type: "gimbal", data: { action: "move_begin", pan_speed: panSpeed, tilt_speed: tiltSpeed } });
  }
  function sendGimbalMoveUpdate(panSpeed: number, tiltSpeed: number): void {
    _send({ type: "gimbal", data: { action: "move_update", pan_speed: panSpeed, tilt_speed: tiltSpeed } });
  }
  function sendGimbalMoveEnd(): void {
    _send({ type: "gimbal", data: { action: "move_end" } });
  }
  function sendGimbalCenter(): void {
    _send({ type: "gimbal", data: { action: "center" } });
  }
  function requestSoftwareList(): void {
    _send({ type: "software_list", data: {} });
  }
  function requestSoftwareSearch(keyword: string): void {
    _send({ type: "software_search", data: { keyword } });
  }
  function requestModuleList(): void {
    _send({ type: "module_list", data: {} });
  }
  function sendDeviceControl(action: string, enabled: boolean): void {
    _send({ type: "device_control", data: { action, enabled } });
  }
  function sendSoftwareAction(action: string, pkg: string): void {
    _send({ type: `software_${action}`, data: { package: pkg } });
  }
  function sendWifiScan(): void {
    _send({ type: "wifi_scan", data: {} });
  }
  function sendWifiConnect(ssid: string, password: string): void {
    _send({ type: "wifi_connect", data: { ssid, password } });
  }
  function sendWifiDisconnect(device: string): void {
    _send({ type: "wifi_disconnect", data: { device } });
  }
  function sendServiceStatus(): void {
    _send({ type: "service_status", data: {} });
  }
  function sendServiceControl(serviceId: string, action: string): void {
    _send({ type: "service_control", data: { service_id: serviceId, action } });
  }
  function sendMusicCommand(cmd: string, params: Record<string, unknown> = {}): void {
    _send({ type: cmd, data: params });
  }

  function cleanup(): void {
    disconnect();
  }

  return {
    ws,
    reconnectCount,
    lastMessage,
    connectedIp: _connectedIp,
    connectedPort: _connectedPort,
    connect,
    disconnect,
    send: _send,
    cleanup,
    sendMotion,
    sendMotionStop,
    sendEmergencyStop,
    sendEmergencyRelease,
    sendSystemAction,
    sendExec,
    sendCamera,
    requestCameraStatus,
    sendGimbal,
    sendGimbalMove,
    sendGimbalMoveBegin,
    sendGimbalMoveUpdate,
    sendGimbalMoveEnd,
    sendGimbalCenter,
    requestSoftwareList,
    requestSoftwareSearch,
    requestModuleList,
    sendDeviceControl,
    sendSoftwareAction,
    sendWifiScan,
    sendWifiConnect,
    sendWifiDisconnect,
    sendServiceStatus,
    sendServiceControl,
    sendMusicCommand,
  };
}
