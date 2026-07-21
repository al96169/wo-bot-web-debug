import { ref } from "vue";
import { useAppStore } from "../stores/app";
import { useDevicesStore } from "../stores/devices";
import { connectionMode } from "./useWebSocket";

/* ============================================================
 * wo-bot-web-debug - 设备发现
 *
 * 策略：
 * 1. 优先调用 /api/discover（由 Vite 开发服务器的 mDNS 插件提供）
 *    该插件监听 _wobot._tcp.local. 多播，收集局域网内的机器人
 * 2. 同时做已知 IP 的快速探活（127.0.0.1 + 页面自身IP）作为补充
 * ============================================================ */

const WS_PORT = 8765;
const PROBE_PROTOCOL_VERSION = 1; // 探活必须带协议版本，否则服务端拒绝连接

interface MDnsDevice {
  name: string;
  ip: string;
  port: number;
  model?: string;
  id?: string;
  version?: string;
}

export function useDiscovery() {
  const appStore = useAppStore();
  const devicesStore = useDevicesStore();

  const scanning = ref(false);

  /** 快速探活单个 IP */
  function probe(ip: string, timeout: number): Promise<{ name: string; ip: string; robotId?: string } | null> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://${ip}:${WS_PORT}?protocol_version=${PROBE_PROTOCOL_VERSION}`);
      const tid = setTimeout(() => {
        ws.close();
        resolve(null);
      }, timeout);

      ws.onopen = () => {
        clearTimeout(tid);
        const rtid = setTimeout(() => {
          ws.close();
          resolve({ name: `设备 ${ip}`, ip });
        }, 600);
        ws.onmessage = (e) => {
          clearTimeout(rtid);
          ws.close();
          try {
            const m = JSON.parse(e.data);
            const data = m.data || {};
            resolve({
              name: data.name || `设备 ${ip}`,
              ip: data.ip || ip,
              robotId: data.robot_id || undefined,
            });
          } catch {
            resolve({ name: `设备 ${ip}`, ip });
          }
        };
      };
      ws.onerror = () => {
        clearTimeout(tid);
        resolve(null);
      };
    });
  }

  /** 调用开发服务器的 mDNS 发现接口 */
  async function callMdnsApi(durationMs: number): Promise<MDnsDevice[]> {
    try {
      const resp = await fetch(`/api/discover?t=${durationMs}`);
      if (!resp.ok) return [];
      const data = await resp.json();
      return (data?.devices as MDnsDevice[]) || [];
    } catch {
      return [];
    }
  }

  /** 开始扫描 */
  async function startScan(): Promise<void> {
    // signal 模式（云端远控）下跳过本地探活，避免无意义的 ws://127.0.0.1:8765 探测
    if (connectionMode.value === "signal") {
      console.log("[Discovery] Signal mode, skipping local scan");
      return;
    }
    if (scanning.value || appStore.mockMode) return;
    scanning.value = true;
    appStore.scanning = true;
    devicesStore.clearDiscovered();

    // 并行：mDNS 发现 + 本地快速探活
    const mdnsPromise = callMdnsApi(2500);

    const localTargets: string[] = [];
    // 探活分两步：
    // 1) 如果从 localhost 访问（开发场景），探 127.0.0.1
    // 2) 如果从局域网 IP 访问，跳过该 IP（它是 Vite 服务器，不是机器人），
    //    改为基于同网段探测常见 IP（Jetson 等设备）
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      localTargets.push("127.0.0.1");
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      // 当前访问的是 Vite 服务器的 IP，不是机器人，不要探它
      const parts = hostname.split(".").map(Number);
      // 同网段快速探活：扫描常见设备 IP（跳过 .1 路由器 和 .2）
      const candidates = [47, 100, 101, 102, 103];
      for (const lastOctet of candidates) {
        if (lastOctet !== parts[3]) {
          localTargets.push(`${parts[0]}.${parts[1]}.${parts[2]}.${lastOctet}`);
        }
      }
    }
    const localPromise = Promise.all(localTargets.map((ip) => probe(ip, 800)));

    const [mdnsDevices, localResults] = await Promise.all([mdnsPromise, localPromise]);

    const combined = new Map<string, { name: string; ip: string; port: number; robotId?: string }>();

    for (const d of mdnsDevices) {
      combined.set(d.ip + ":" + d.port, { name: d.name, ip: d.ip, port: d.port, robotId: d.id });
    }
    for (const r of localResults) {
      if (!r) continue;
      combined.set(r.ip + ":" + WS_PORT, { name: r.name, ip: r.ip, port: WS_PORT, robotId: r.robotId });
    }

    for (const device of combined.values()) {
      devicesStore.addDiscovered({
        id: `lan-${device.ip.replace(/\./g, "-")}-${device.port}`,
        name: device.name,
        ip: device.ip,
        port: device.port,
        online: true,
        robotId: device.robotId,
      });
    }

    scanning.value = false;
    appStore.scanning = false;
  }

  function stopScan(): void {
    scanning.value = false;
    appStore.scanning = false;
  }

  return { scanning, startScan, stopScan };
}
