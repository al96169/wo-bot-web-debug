import { ref } from "vue";
import { useAppStore } from "../stores/app";
import { useRobotStore, type CameraInfo } from "../stores/robot";
import type {
  CameraPhoto,
  DanceInfo,
  GalleryItem,
  GalleryStorage,
  LogEntry,
  MusicStatus,
  MusicTrack,
  ServiceInfo,
  SoftwareTask,
} from "../types";
import { getSignalingWs, setDataChannel, getRemoteFeatures, refreshHeartbeatPongTime } from "./useWebSocket";

/* ============================================================
 * wo-bot-web-debug - WebRTC 连接管理
 *
 * 在 WebSocket 信令建立后，自动发起 WebRTC 连接：
 * 1. 创建 RTCPeerConnection + DataChannel
 * 2. 通过 WebSocket 发送 SDP offer
 * 3. 接收 SDP answer → 完成连接
 * 4. DataChannel 承载所有业务消息
 * 5. MediaStream 承载视频流
 * ============================================================ */

const STUN_SERVER = "stun:stun.l.google.com:19302";

// ---- 模块级 answer resolver + pending timer ----
let _answerResolver: ((sdp: string) => void) | null = null;
let _pendingTimer: ReturnType<typeof setTimeout> | null = null;
let _establishing = false; // 防止并发 establishConnection

/** 清理 pending timer + answer resolver */
function _clearPending(): void {
  if (_pendingTimer) {
    clearTimeout(_pendingTimer);
    _pendingTimer = null;
  }
  if (_answerResolver) {
    // 拒绝旧 resolver，避免旧的 establishConnection 永久挂起
    const oldResolver = _answerResolver;
    _answerResolver = null;
    try {
      oldResolver("");
    } catch {
      /* ignore */
    }
  }
}

/** 由外部（WebSocket 信令层收到 webrtc_answer 时）调用 */
export function resolveWebRTCAnswer(sdp: string): void {
  console.log("[WebRTC] answer received, has resolver:", !!_answerResolver, "sdp length:", sdp.length);
  if (_answerResolver) {
    _answerResolver(sdp);
    _answerResolver = null;
  }
}

/** 由外部（WebSocket 信令层收到 webrtc_ice_candidate 时）调用 */
export async function handleWebRTCIceCandidate(
  candidate: string,
  sdpMid: string | null,
  sdpMLineIndex: number | null,
): Promise<void> {
  console.log("[WebRTC:ICE] 收到远端 ICE candidate:", {
    hasPc: !!_pc,
    pcSignalingState: _pc?.signalingState,
    pcConnectionState: _pc?.connectionState,
    candidate: candidate?.substring(0, 80),
    sdpMid,
    sdpMLineIndex,
  });
  // 记录远端候选
  if (candidate) {
    remoteCandidates.value = [...remoteCandidates.value, candidate].slice(-20);
  }
  if (!_pc) {
    console.warn("[WebRTC:ICE] _pc 为 null, 丢弃 ICE candidate（信令到达时 PC 尚未创建或已销毁）");
    return;
  }
  if (!candidate) {
    console.warn("[WebRTC:ICE] candidate 为空, 跳过");
    return;
  }
  try {
    await _pc.addIceCandidate(
      new RTCIceCandidate({
        candidate,
        sdpMid: sdpMid ?? undefined,
        sdpMLineIndex: sdpMLineIndex ?? undefined,
      }),
    );
    console.log("[WebRTC:ICE] addIceCandidate 成功");
  } catch (e) {
    console.error("[WebRTC:ICE] addIceCandidate 失败:", e);
  }
}

// ---- 模块级 pc 引用（供 ICE candidate 中继使用） ----
let _pc: RTCPeerConnection | null = null;

// ---- 模块级单例 refs（useWebRTC() 多次调用共享同一状态） ----
const pc = ref<RTCPeerConnection | null>(null);
const dc = ref<RTCDataChannel | null>(null);
const videoStream0 = ref<MediaStream | null>(null);
const videoStream1 = ref<MediaStream | null>(null);

// ---- WebRTC 监控状态 ----
const iceConnectionState = ref<string>("new");
const iceGatheringState = ref<string>("new");
const connectionState = ref<string>("new");
const signalingState = ref<string>("stable");
const dcReadyState = ref<string>("closed");
/** DC 是否曾经成功打开过（用于区分"从未建立"和"打开后关闭"） */
const dcEverOpened = ref(false);
const localCandidates = ref<string[]>([]);
const remoteCandidates = ref<string[]>([]);

// ICE completed 兜底定时器（清除 connectionState 未触发的边缘情况）
let _iceFallbackTimer: ReturnType<typeof setTimeout> | null = null;

// ICE gathering 完成兜底定时器（iPadOS WebKit iceConnectionState 不转换的兜底）
let _gatheringFallbackTimer: ReturnType<typeof setTimeout> | null = null;

/** gatheringCompleted 标记，供监控面板排查 */
const gatheringCompleted = ref(false);

const webrtcState = ref<"idle" | "connecting" | "connected" | "failed">("idle");

// 媒体超时自动重试：连接建立后 5s 内未收到实际视频数据则重试
let _mediaTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let _mediaRetryCount = 0;
let _videoPlaying = false;
const MAX_MEDIA_RETRY = 3;

export function useWebRTC() {
  const appStore = useAppStore();
  const robotStore = useRobotStore();

  // ---- 媒体超时自动重试辅助函数 ----
  function _clearMediaTimeout(): void {
    if (_mediaTimeoutTimer) {
      clearTimeout(_mediaTimeoutTimer);
      _mediaTimeoutTimer = null;
    }
  }

  function _startMediaTimeout(): void {
    _clearMediaTimeout();
    console.log("[WebRTC:Media] 启动媒体超时检测 (5s), 当前重试次数:", _mediaRetryCount);
    _mediaTimeoutTimer = setTimeout(() => {
      _mediaTimeoutTimer = null;
      if (!_videoPlaying) {
        console.warn("[WebRTC:Media] 5s 内未收到实际视频数据, 触发重试");
        _doRetry();
      }
    }, 5000);
  }

  function _doRetry(): void {
    if (_mediaRetryCount >= MAX_MEDIA_RETRY) {
      console.warn("WebRTC 自动重试已达上限");
      return;
    }
    _mediaRetryCount++;
    _videoPlaying = false;
    console.log(`[WebRTC:Media] 第 ${_mediaRetryCount}/${MAX_MEDIA_RETRY} 次重试`);
    resetAndOffer();
  }

  // ---- ICE 兜底定时器 ----
  function _startIceFallback(): void {
    _clearIceFallback();
    _iceFallbackTimer = setTimeout(() => {
      if (webrtcState.value !== "connected" && webrtcState.value !== "failed") {
        console.warn("[WebRTC:ICE] connectionState 未变化超过 5s, 使用 ICE completed 作为兜底");
        webrtcState.value = "connected";
        _startMediaTimeout();
        appStore.setSSHConnected(true);
      }
    }, 5000);
  }

  function _clearIceFallback(): void {
    if (_iceFallbackTimer) {
      clearTimeout(_iceFallbackTimer);
      _iceFallbackTimer = null;
    }
  }

  // ---- Gathering 完成兜底（Android/iPadOS 上 iceConnectionState 不转换的兜底） ----
  function _startGatheringFallback(): void {
    _clearGatheringFallback();
    // 等 ICE candidates 全部收集完毕后再给额外时间建立连接
    _gatheringFallbackTimer = setTimeout(() => {
      if (webrtcState.value === "connecting") {
        console.warn(
          "[WebRTC:ICE] gathering 完成但 webrtcState 仍为 connecting, 强制标记为 connected (WebKit/Android 兜底)",
        );
        webrtcState.value = "connected";
        _startMediaTimeout();
        appStore.setSSHConnected(true);
      }
    }, 8000); // 8s after gathering complete
  }

  function _clearGatheringFallback(): void {
    if (_gatheringFallbackTimer) {
      clearTimeout(_gatheringFallbackTimer);
      _gatheringFallbackTimer = null;
    }
  }

  /** 建立 WebRTC 连接（在 WebSocket 信令连通后调用） */
  async function establishConnection(): Promise<void> {
    if (_establishing) {
      console.log("[WebRTC] establishConnection skipped: already in progress");
      return;
    }
    _establishing = true;

    function done(): void {
      _establishing = false;
    }

    console.log("[WebRTC] establishConnection() called");
    // 检查服务端是否支持 WebRTC
    const features = getRemoteFeatures();
    console.log("[WebRTC] features:", features);
    if (!features.includes("webrtc")) {
      webrtcState.value = "idle";
      done();
      return;
    }

    // 清理旧状态，防止多次调用导致的竞态
    _clearPending();
    videoStream0.value = null;
    videoStream1.value = null;
    if (pc.value) {
      pc.value.close();
      pc.value = null;
    }
    if (dc.value) {
      dc.value.close();
      dc.value = null;
    }

    const ws = getSignalingWs();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      done();
      return;
    }

    webrtcState.value = "connecting";

    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: STUN_SERVER }],
      });
      pc.value = peerConnection;
      _pc = peerConnection; // 模块级引用供 ICE 中继

      // 接收服务端创建的远程 DataChannel（fallback）
      peerConnection.ondatachannel = (event: RTCDataChannelEvent) => {
        const rc = event.channel;
        console.log("[WebRTC] Remote DataChannel received:", rc.label);
        rc.onopen = () => {
          console.log("[WebRTC] Remote DC opened, using as fallback");
          dcReadyState.value = "open";
          dcEverOpened.value = true;
          webrtcState.value = "connected";
          _startMediaTimeout();
          appStore.setSSHConnected(true);
          appStore.showToast("WebRTC 业务通道已建立", "success");
          rc.send(JSON.stringify({ type: "subscribe", data: { events: ["status"] } }));
        };
        rc.onmessage = (ev: MessageEvent) => {
          try {
            dispatchDataChannelMessage(JSON.parse(ev.data as string));
          } catch {}
        };
        rc.onclose = () => {
          if (dc.value === rc) {
            dc.value = null;
            setDataChannel(null);
          }
        };
        // 本地 DC 未开时，用远程 DC
        if (dc.value && dc.value.readyState !== "open") {
          dc.value = rc;
          setDataChannel(rc);
        }
      };

      // 创建 DataChannel
      const channel = peerConnection.createDataChannel("wobot-control", {
        ordered: true,
      });
      dc.value = channel;
      dcReadyState.value = "connecting";
      setDataChannel(channel);

      channel.onopen = () => {
        console.log("[WebRTC] DataChannel opened!");
        dcReadyState.value = "open";
        dcEverOpened.value = true;
        webrtcState.value = "connected";
        _startMediaTimeout();
        appStore.setSSHConnected(true);
        appStore.showToast("WebRTC 业务通道已建立", "success");
        channel.send(JSON.stringify({ type: "subscribe", data: { events: ["status"] } }));
        // DC 连接后立即查询录制状态，同步按钮
        setTimeout(() => {
          channel.send(JSON.stringify({ type: "camera_record_query", data: {} }));
        }, 500);
      };

      channel.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          dispatchDataChannelMessage(msg);
        } catch {
          /* 非 JSON 消息忽略 */
        }
      };

      channel.onclose = () => {
        // 防止旧 DC 的 onclose 异步触发后覆盖新 DC 状态
        if (dc.value !== channel) return;
        dcReadyState.value = "closed";
        webrtcState.value = "idle";
        appStore.setSSHConnected(false);
        setDataChannel(null);
      };

      channel.onerror = (event: Event) => {
        if (dc.value !== channel) return;
        const err = (event as RTCErrorEvent).error;
        const detail = err ? `${err.message ?? err.errorDetail ?? "unknown"}` : "无详情";
        console.error(`[WebRTC:DataChannel] 错误: ${detail}`);
      };

      // 接收远端视频流（双摄像头）
      // 关键：使用 event.streams[0]（浏览器引擎创建），不是 new MediaStream（Android 兼容）
      // 简单计数器模式：第一个 track → cam0，第二个 → cam1
      let _ontrackCount = 0;

      peerConnection.ontrack = (event: RTCTrackEvent) => {
        _ontrackCount++;
        // 每个 track 创建独立的 MediaStream，避免多 track 共享同一 stream
        // 导致两个 video 元素都显示同一个摄像头的画面
        let resolvedStream: MediaStream;
        if (event.streams && event.streams.length > 0) {
          const sharedStream = event.streams[0];
          // 检查是否和已分配的流是同一个对象（多 track 共享 stream 的情况）
          if (sharedStream === videoStream0.value || sharedStream === videoStream1.value) {
            resolvedStream = new MediaStream();
            resolvedStream.addTrack(event.track);
          } else {
            resolvedStream = sharedStream;
          }
        } else {
          resolvedStream = new MediaStream();
          resolvedStream.addTrack(event.track);
        }
        console.log(
          "[WebRTC] ontrack #" + _ontrackCount,
          "track:",
          event.track.id,
          "kind:",
          event.track.kind,
          "streams:",
          event.streams?.length ?? 0,
          "stream.tracks:",
          resolvedStream.getTracks().length,
        );

        // 监听 track 状态变化（mute/ended 是画面冻结的关键信号）
        event.track.onmute = () => {
          console.warn("[WebRTC:Track] track muted:", event.track.id, "readyState:", event.track.readyState);
          // 标记视频停止播放，允许媒体超时检测触发重连
          if (event.track.kind === "video") {
            _videoPlaying = false;
          }
        };
        event.track.onunmute = () => {
          console.log("[WebRTC:Track] track unmuted:", event.track.id, "readyState:", event.track.readyState);
          // 仅视频轨开始接收数据时标记为播放中
          if (event.track.kind === "video") {
            _videoPlaying = true;
            _clearMediaTimeout();
            _mediaRetryCount = 0;
            // 视频数据到达 = 连接实际成功，比 ICE/connectionState 更可靠
            if (webrtcState.value === "connecting") {
              _clearGatheringFallback();
              _clearIceFallback();
              webrtcState.value = "connected";
              appStore.setSSHConnected(true);
              console.log("[WebRTC] 视频轨数据到达, webrtcState → connected");
            }
          }
        };
        event.track.onended = () => {
          console.warn("[WebRTC:Track] track ended:", event.track.id);
        };

        if (_ontrackCount === 1) {
          videoStream0.value = resolvedStream;
        } else {
          videoStream1.value = resolvedStream;
        }

        // 注意：不清除媒体超时，等待 onunmute 确认视频轨正在接收数据
      };

      // ICE candidate → 通过信令发送
      peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
        if (event.candidate) {
          const candStr = event.candidate.candidate ?? "";
          console.log("[WebRTC:ICE] 本地 ICE candidate:", candStr.substring(0, 80), "ws ready:", ws.readyState);
          // 记录本地候选
          localCandidates.value = [...localCandidates.value, candStr].slice(-20);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "webrtc_ice_candidate",
                data: {
                  candidate: candStr,
                  sdpMid: event.candidate.sdpMid,
                  sdpMLineIndex: event.candidate.sdpMLineIndex,
                },
              }),
            );
          }
        } else {
          console.log("[WebRTC:ICE] ICE candidate gathering complete (null candidate)");
        }
      };

      // ICE 连接状态监听（更细粒度，先于 connectionState 变化）
      peerConnection.oniceconnectionstatechange = () => {
        if (pc.value !== peerConnection) return;
        const iceState = peerConnection.iceConnectionState;
        iceConnectionState.value = iceState;
        console.log(
          "[WebRTC:ICE] iceConnectionState ->",
          iceState,
          "connectionState:",
          peerConnection.connectionState,
          "signalingState:",
          peerConnection.signalingState,
        );
        if (iceState === "connected" || iceState === "completed") {
          console.log("[WebRTC:ICE] ICE 已连接, 等待 DTLS/DataChannel");
          _clearGatheringFallback();
          _startIceFallback();
        } else if (iceState === "failed") {
          console.error("[WebRTC:ICE] ICE 连接失败");
          _clearGatheringFallback();
          webrtcState.value = "failed";
          appStore.setSSHConnected(false);
        }
      };

      // ICE gathering 状态监听
      peerConnection.onicegatheringstatechange = () => {
        if (pc.value !== peerConnection) return;
        const gatherState = peerConnection.iceGatheringState;
        iceGatheringState.value = gatherState;
        console.log("[WebRTC:ICE] iceGatheringState ->", gatherState);
        if (gatherState === "complete") {
          gatheringCompleted.value = true;
          _startGatheringFallback();
        }
      };

      peerConnection.onconnectionstatechange = () => {
        if (pc.value !== peerConnection) return; // 不是当前活跃的 PC
        const state = peerConnection.connectionState;
        connectionState.value = state;
        signalingState.value = peerConnection.signalingState;
        console.log(
          "[WebRTC] connectionState ->",
          state,
          "iceState:",
          peerConnection.iceConnectionState,
          "signalingState:",
          peerConnection.signalingState,
        );
        if (state === "connected") {
          _clearGatheringFallback();
          webrtcState.value = "connected";
          _startMediaTimeout();
          appStore.setSSHConnected(true);
          _clearIceFallback();
        } else if (state === "failed" || state === "disconnected") {
          _clearGatheringFallback();
          webrtcState.value = "failed";
          appStore.setSSHConnected(false);
          _clearIceFallback();
        }
      };

      // 创建双 Video Transceiver（服务端为两个摄像头添加独立视频轨）
      peerConnection.addTransceiver("video", { direction: "recvonly" });
      peerConnection.addTransceiver("video", { direction: "recvonly" });

      // 创建 SDP offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      signalingState.value = peerConnection.signalingState;
      console.log("[WebRTC] Offer SDP has DC:", offer.sdp?.includes("m=application") ?? false);

      ws.send(JSON.stringify({ type: "webrtc_offer", data: { sdp: offer.sdp } }));

      // 等待 answer
      const answer = await new Promise<string>((resolve) => {
        _answerResolver = resolve;
        _pendingTimer = setTimeout(() => {
          _clearPending();
          resolve("");
        }, 10000);
      });

      if (!answer) {
        console.log("[WebRTC] answer timed out or rejected");
        webrtcState.value = "failed";
        return;
      }

      // 诊断：分析 answer SDP
      const answerHasIceLite = answer.includes("a=ice-lite");
      const answerCandidates = (answer.match(/a=candidate/g) || []).length;
      const answerHasVideo = answer.includes("m=video");
      const answerHasApp = answer.includes("m=application");
      console.log("[WebRTC] Answer SDP 诊断:", {
        hasIceLite: answerHasIceLite,
        candidateCount: answerCandidates,
        hasVideo: answerHasVideo,
        hasDataChannel: answerHasApp,
        sdpLength: answer.length,
        sdpPreview: answer.substring(0, 300),
      });
      await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answer }));
      signalingState.value = peerConnection.signalingState;
      console.log(
        "[WebRTC] setRemoteDescription OK, connectionState:",
        peerConnection.connectionState,
        "iceState:",
        peerConnection.iceConnectionState,
      );
    } catch {
      webrtcState.value = "failed";
    } finally {
      _establishing = false;
    }
  }

  /** DataChannel 消息分发 */
  function dispatchDataChannelMessage(msg: { type: string; data?: Record<string, unknown> }): void {
    // 收到任何 DataChannel 消息，说明通道已通
    if (!appStore.sshConnected) appStore.setSSHConnected(true);

    // 解包 response 信封：后端 DataChannel 响应格式为 { type: "response", data: { type: "xxx", data: {...} } }
    let data = msg.data ?? {};
    let msgType = msg.type;
    if (msgType === "response" && typeof data === "object" && "type" in data) {
      msgType = String((data as Record<string, unknown>).type);
      data = ((data as Record<string, unknown>).data as Record<string, unknown>) ?? {};
    }

    switch (msgType) {
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
        // 同步省电策略状态
        const pp = (data.power_policy ?? {}) as Record<string, unknown>;
        if (pp.mode) {
          robotStore.setPowerPolicy({
            mode: (pp.mode as "normal" | "eco") ?? "normal",
            threshold: typeof pp.threshold === "number" ? pp.threshold : 30,
            manual_override: Boolean(pp.manual_override),
            simulated_battery: pp.simulated_battery != null ? Number(pp.simulated_battery) : null,
          });
        }
        break;
      }
      case "pong":
        appStore._lastPing = Date.now();
        refreshHeartbeatPongTime(); // 防御性：同步更新 WS 心跳时间戳，防止误判超时
        break;
      case "logs": {
        const rawLogs = Array.isArray(data.logs) ? (data.logs as Array<Record<string, unknown>>) : [];
        const totalLines = Number(data.total_lines ?? 0);
        const hasNextSince = data.next_since !== undefined;
        const nextSince = Number(data.next_since ?? 0);
        const hasMore = Boolean(data.has_more);
        const mode = String(data.mode ?? "tail");
        const mapped: LogEntry[] = rawLogs.map((l) => {
          const rawLevel = String(l.level ?? "info").toLowerCase();
          const level = (
            rawLevel === "warning" ? "warn" : ["debug", "info", "warn", "error"].includes(rawLevel) ? rawLevel : "info"
          ) as LogEntry["level"];
          const timestamp = String(l.timestamp ?? l.time ?? "");
          const lineNo = Number(l.line_no ?? 0);
          return {
            id: `ln-${lineNo}`,
            lineNo,
            time: timestamp,
            level,
            source: String(l.source ?? "remote"),
            message: String(l.message ?? ""),
          };
        });
        const meta = { totalLines, nextSince, hasMore };
        if (mode === "since") {
          robotStore.appendLogs(mapped, hasNextSince ? meta : undefined);
        } else if (mode === "before") {
          robotStore.prependLogs(mapped);
          if (hasNextSince) {
            robotStore.logTotalLines = totalLines;
            robotStore.logHasMore = hasMore;
          }
        } else {
          robotStore.setLogs(mapped, hasNextSince ? meta : undefined);
        }
        break;
      }
      case "software_list": {
        const pkgs = Array.isArray(data.packages) ? (data.packages as Array<Record<string, unknown>>) : [];
        robotStore.setInstalledSoftware(
          pkgs.map((p) => ({
            name: String(p.name ?? ""),
            display_name: String(p.display_name ?? p.name ?? ""),
            description: String(p.description ?? ""),
            ...(p.version != null ? { version: String(p.version) } : {}),
            category: String(p.category ?? "other"),
            critical: Boolean(p.critical ?? false),
            icon: String(p.icon ?? ""),
            installed: true,
            ...(p.upgradable != null ? { upgradable: Boolean(p.upgradable) } : {}),
          })),
        );
        break;
      }
      case "software_available": {
        const pkgs = Array.isArray(data.packages) ? (data.packages as Array<Record<string, unknown>>) : [];
        robotStore.setAvailableSoftware(
          pkgs.map((p) => ({
            name: String(p.name ?? ""),
            display_name: String(p.display_name ?? p.name ?? ""),
            description: String(p.description ?? ""),
            ...(p.version != null ? { version: String(p.version) } : {}),
            category: String(p.category ?? "other"),
            critical: Boolean(p.critical ?? false),
            icon: String(p.icon ?? ""),
            installed: false,
          })),
        );
        break;
      }
      case "software_progress": {
        const pkg = String(data.package ?? "");
        if (pkg) {
          robotStore.updateSoftwareTaskByPackage(pkg, {
            progress: typeof data.progress === "number" ? data.progress : 0,
            stage: String(data.stage ?? ""),
          });
          const line = String(data.output ?? "");
          if (line) robotStore.appendSoftwareTaskOutput(pkg, line);
        }
        break;
      }
      case "software_updates_available": {
        // 发现可更新软件，提示用户到软件管理页面升级
        const updates = Array.isArray(data.updates) ? data.updates : [];
        if (updates.length > 0) {
          const names = updates.map((u: any) => u.display_name || u.name).join("、");
          appStore.showToast(`发现 ${updates.length} 个可更新软件：${names}，请到软件管理页面升级`, "info");
        }
        break;
      }
      case "software_install_ack":
      case "software_uninstall_ack":
      case "software_upgrade_ack": {
        const action = msgType.replace("software_", "").replace("_ack", "") as SoftwareTask["action"];
        const pkg = String(data.package ?? "");
        // 后端成功状态：installed/removed/upgraded/already_latest；失败状态：failed/protected/permission_denied/not_in_whitelist
        const failStatuses = ["failed", "protected", "permission_denied", "not_in_whitelist", "error"];
        const status = String(data.status ?? "failed");
        const ok = !failStatuses.includes(status);
        const fromVersion = typeof data.old_version === "string" ? data.old_version : undefined;
        const toVersion = typeof data.new_version === "string" ? data.new_version : undefined;
        robotStore.updateSoftwareTaskByPackage(
          pkg,
          { status: ok ? "success" : "failed", completedAt: Date.now(), fromVersion, toVersion },
          action,
        );
        // already_latest 特殊提示
        if (status === "already_latest") {
          appStore.showToast(`${pkg} 已是最新版本`, "info");
        }
        // 安装/卸载/升级完成后自动刷新列表（经 WebSocket 信令通道）
        const _ws = getSignalingWs();
        if (_ws && _ws.readyState === WebSocket.OPEN) {
          _ws.send(JSON.stringify({ type: "software_list", data: {} }));
          _ws.send(JSON.stringify({ type: "software_available", data: {} }));
        }
        break;
      }
      case "module_list": {
        robotStore.setModules(Array.isArray(data.modules) ? (data.modules as any) : []);
        break;
      }
      case "module_control_ack":
        break;
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
      case "device_control_ack":
        break;
      case "power_policy_status":
        robotStore.setPowerPolicy({
          mode: (data.mode as "normal" | "eco") ?? "normal",
          threshold: typeof data.threshold === "number" ? data.threshold : 30,
          manual_override: Boolean(data.manual_override),
          simulated_battery: data.simulated_battery != null ? Number(data.simulated_battery) : null,
        });
        break;
      case "power_policy_config":
        robotStore.setPowerPolicy({
          mode: (data.mode as "normal" | "eco") ?? "normal",
          threshold: typeof data.threshold === "number" ? data.threshold : 30,
          manual_override: Boolean(data.manual_override),
          simulated_battery: data.simulated_battery != null ? Number(data.simulated_battery) : null,
        });
        break;
      case "system_ack":
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
      case "error":
        console.warn(`[Remote:error] ${String(data.message ?? "未知错误")}`);
        // 503=可选服务不可用, 403=功能被管理员禁用，均不弹 Toast
        if (String(data.code ?? "") !== "503" && String(data.code ?? "") !== "403") {
          appStore.showToast(`错误: ${String(data.message ?? "未知错误")}`, "error");
        }
        break;

      // ---- 音乐播放 (DataChannel 路径) ----
      case "music_status": {
        console.log("[DC.msg] music_status:", JSON.stringify(data).slice(0, 200));
        if ((data as Record<string, unknown>).error) {
          robotStore.setMusicStatus({ ...robotStore.musicStatus, status: "stopped" });
        } else {
          robotStore.setMusicStatus(data as unknown as MusicStatus);
        }
        break;
      }
      case "music_list": {
        const songsArr = (data as Record<string, unknown>).songs;
        console.log(
          "[DC.msg] music_list, songs:",
          Array.isArray(songsArr) ? (songsArr as Array<unknown>).length : "N/A",
        );
        if (Array.isArray(songsArr)) {
          robotStore.setMusicSongs(songsArr as unknown as MusicTrack[]);
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

      // ---- 服务管理 (DataChannel 路径) ----
      case "service_status": {
        if (Array.isArray(data.services)) {
          robotStore.setServices(data.services as ServiceInfo[]);
        }
        break;
      }
      case "service_control_ack": {
        if (Array.isArray(data.services) && data.services.length > 0) {
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

      // ---- 舞蹈 (DataChannel 路径) ----
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
      case "config_get_ack":
        if (data && typeof data === "object") {
          robotStore.setRobotConfig(data as any);
        }
        break;
      case "config_set_ack":
        break;

      // ---- 拍照 / 录像 / 图库 (R00034, DataChannel 路径) ----
      case "camera_capture_result": {
        const success = Boolean(data.success);
        if (success) {
          const photos = Array.isArray(data.photos) ? (data.photos as CameraPhoto[]) : [];
          const count = photos.length;
          appStore.showToast(count > 0 ? `拍照成功，已保存 ${count} 张照片` : "拍照成功", "success");
          robotStore.addCmdLog({
            time: new Date().toLocaleTimeString(),
            direction: "recv",
            type: "camera_capture",
            data: `拍照成功 ${count} 张`,
          });
        } else {
          appStore.showToast(`拍照失败: ${String(data.error ?? data.message ?? "未知错误")}`, "error");
        }
        break;
      }
      case "camera_record_result": {
        // 录制操作响应（乐观更新已在按钮点击时完成，这里只做确认/回滚）
        const ok = data.success !== false;
        const errMsg = String(data.error ?? data.message ?? "");
        if (!ok) {
          // 错误回滚：根据错误信息判断实际状态
          if (errMsg.includes("Already recording")) {
            // 机器人已在录制中，同步前端状态
            robotStore.setRecordingUiState(true, data.camera_id as number | undefined);
            appStore.showToast("已在录制中", "info");
          } else if (errMsg.includes("Not recording")) {
            // 机器人未在录制，同步前端状态
            robotStore.setRecordingUiState(false);
            appStore.showToast("未在录制", "info");
          } else {
            // 其他错误，回滚为 false
            robotStore.setRecordingUiState(false);
            appStore.showToast(`录像操作失败: ${errMsg}`, "error");
          }
        } else if (data.is_recording === true) {
          appStore.showToast("录像已开始", "success");
        } else if (data.is_recording === false && data.file_name) {
          const duration = typeof data.duration_s === "number" ? data.duration_s : 0;
          const sizeMB = typeof data.size_bytes === "number" ? (data.size_bytes / 1024 / 1024).toFixed(1) : "?";
          appStore.showToast(`录像完成: ${duration}s, ${sizeMB}MB`, "success");
        } else if (data.is_recording === false) {
          appStore.showToast("录像已停止", "info");
        }
        break;
      }
      case "camera_record_status": {
        robotStore.setCameraRecordStatus({
          is_recording: Boolean(data.is_recording),
          camera_id: typeof data.camera_id === "number" ? data.camera_id : undefined,
          elapsed_s: typeof data.elapsed_s === "number" ? data.elapsed_s : undefined,
          file_size_bytes: typeof data.file_size_bytes === "number" ? data.file_size_bytes : undefined,
        });
        break;
      }
      case "camera_recording_ui_state": {
        robotStore.setRecordingUiState(
          Boolean(data.is_recording),
          typeof data.camera_id === "number" ? data.camera_id : undefined,
        );
        break;
      }
      case "camera_media_list_result": {
        const total = typeof data.total === "number" ? data.total : 0;
        const page = typeof data.page === "number" ? data.page : 1;
        const files = Array.isArray(data.files) ? (data.files as GalleryItem[]) : [];
        const pageSize = robotStore.galleryPageSize;
        const hasMore = page * pageSize < total;
        if (page <= 1) {
          robotStore.setGallery(files);
        } else {
          robotStore.appendGallery(files);
        }
        robotStore.setGalleryPageInfo(page, total, hasMore);
        robotStore.setGalleryLoading(false);
        if (data.storage && typeof data.storage === "object") {
          const st = data.storage as Record<string, unknown>;
          const storage: GalleryStorage = {
            total_bytes: Number(st.total_bytes ?? 0),
            used_bytes: Number(st.used_bytes ?? 0),
            available_bytes: Number(st.available_bytes ?? 0),
          };
          robotStore.setGalleryStorage(storage);
        }
        break;
      }
      case "camera_media_delete_result": {
        const ok = data.success !== false;
        const deleted = Array.isArray(data.deleted) ? (data.deleted as string[]) : [];
        const failed = Array.isArray(data.failed) ? (data.failed as string[]) : [];
        if (ok && deleted.length > 0) {
          robotStore.removeGalleryItems(deleted);
          appStore.showToast(`已删除 ${deleted.length} 个文件`, "success");
        } else if (failed.length > 0) {
          appStore.showToast(`删除失败 ${failed.length} 个文件`, "error");
        } else {
          appStore.showToast(ok ? "删除成功" : "删除失败", ok ? "success" : "error");
        }
        break;
      }
      case "camera_media_download_data": {
        const fileName = String(data.file_name ?? "");
        if (!fileName) break;
        if (data.download_url) {
          // 大文件通过 HTTP URL 下载
          const link = document.createElement("a");
          link.href = String(data.download_url);
          link.download = fileName;
          link.click();
          appStore.showToast(`开始下载: ${fileName}`, "info");
        } else if (data.file_base64) {
          // 小文件通过 base64 数据下载
          const base64 = String(data.file_base64);
          const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(fileName);
          const mime = isVideo ? "video/mp4" : "image/jpeg";
          const link = document.createElement("a");
          link.href = `data:${mime};base64,${base64}`;
          link.download = fileName;
          link.click();
          appStore.showToast(`下载完成: ${fileName}`, "success");
        }
        break;
      }
      default:
        console.log("[DC.msg] unhandled:", msgType, JSON.stringify(data).slice(0, 200));
        break;
    }
  }

  /** 关闭连接 */
  function close(): void {
    _clearPending();
    _establishing = false; // 重置建立状态，允许重新连接
    _clearIceFallback();
    _clearGatheringFallback();
    _clearMediaTimeout();
    _videoPlaying = false;
    if (dc.value) {
      dc.value.close();
      dc.value = null;
    }
    if (pc.value) {
      pc.value.close();
      pc.value = null;
    }
    _pc = null;
    // 重连时清空旧视频流引用，否则 ontrack 会认为槽位已占用，拒绝接收新流
    videoStream0.value = null;
    videoStream1.value = null;
    setDataChannel(null);
    webrtcState.value = "idle";
    // 重置监控状态
    iceConnectionState.value = "new";
    iceGatheringState.value = "new";
    connectionState.value = "new";
    signalingState.value = "stable";
    dcReadyState.value = "closed";
    dcEverOpened.value = false;
    gatheringCompleted.value = false;
    localCandidates.value = [];
    remoteCandidates.value = [];
  }

  /** 重置并重新发起 WebRTC 连接（关闭当前 PC 后重新 createOffer） */
  async function resetAndOffer(): Promise<void> {
    close();
    await establishConnection();
  }

  /** 重连 — 关闭旧连接并立即建立新连接（摄像头启停后刷新视频轨） */
  let _reconnecting = false;
  async function reconnect(): Promise<void> {
    if (_reconnecting) return;
    _reconnecting = true;
    try {
      close();
      await new Promise((r) => setTimeout(r, 300));
      await establishConnection();
    } finally {
      _reconnecting = false;
    }
  }

  function requestLogs(params: {
    mode?: "tail" | "since" | "before";
    sinceLine?: number;
    beforeLine?: number;
    limit?: number;
    level?: string;
  }): void {
    const { mode = "tail", sinceLine = 0, beforeLine = 0, limit = 200, level = "" } = params;
    const payload = JSON.stringify({
      type: "logs",
      data: { mode, since_line: sinceLine, before_line: beforeLine, limit, level },
    });
    if (dc.value && dc.value.readyState === "open") {
      dc.value.send(payload);
    } else {
      const ws = getSignalingWs();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  return {
    pc,
    dc,
    videoStream0,
    videoStream1,
    webrtcState,
    iceConnectionState,
    iceGatheringState,
    connectionState,
    signalingState,
    dcReadyState,
    dcEverOpened,
    gatheringCompleted,
    localCandidates,
    remoteCandidates,
    establishConnection,
    close,
    reconnect,
    resetAndOffer,
    requestLogs,
  };
}
