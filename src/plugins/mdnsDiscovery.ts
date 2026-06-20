/**
 * Vite 插件：mDNS 设备发现中间件
 *
 * 前端浏览器不能直接做 mDNS 扫描，此插件在 Node.js 层中继服务。
 * 监听 `_wobot._tcp.local.` 类型的服务。
 *
 * 注意：bonjour-service 在某些环境下无法解析 A 记录（addresses 为空），
 * 但 `service.referer.address` 总是包含 mDNS 广播包的源 IP，是最可靠的真实地址。
 */
import type { Plugin } from "vite";

interface DiscoveredDevice {
  name: string;
  ip: string;
  port: number;
  model?: string;
  id?: string;
  version?: string;
}

let cachedDevices: DiscoveredDevice[] = [];
let lastScanAt = 0;
let isScanning = false;

function mdnsDiscoveryPlugin(): Plugin {
  return {
    name: "wo-bot-mdns-discovery",
    configureServer(server) {
      server.middlewares.use("/api/discover", async (req, res) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const duration = Math.min(Math.max(parseInt(url.searchParams.get("t") || "2500", 10), 500), 8000);

        const now = Date.now();
        if (cachedDevices.length && now - lastScanAt < 2000) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ cached: true, devices: cachedDevices }));
          return;
        }

        if (isScanning) {
          res.statusCode = 429;
          res.end(JSON.stringify({ error: "scanning in progress" }));
          return;
        }

        try {
          isScanning = true;
          const Bonjour = (await import("bonjour-service")).default;
          const bonjour = new Bonjour();
          const found = new Map<string, DiscoveredDevice>();

          const browser = bonjour.find({ type: "wobot" }, (service: any) => {
            // 1. 优先使用 referer.address（mDNS 广播包源 IP，最可靠）
            // 2. 其次使用 service.addresses 中的第一个 IPv4
            // 3. 最后使用 service.host（主机名）
            let ip = service.referer?.address || "";
            if (!ip && service.addresses && service.addresses.length) {
              ip =
                service.addresses.find((a: string) => a.includes(".") && !a.startsWith("127.")) || service.addresses[0];
            }
            if (!ip) {
              ip = service.host || "";
            }
            if (!ip) return;

            const txt = service.txt || {};
            const key = `${ip}:${service.port}`;
            if (!found.has(key)) {
              found.set(key, {
                name: txt.name || service.name || "Unknown Robot",
                ip,
                port: service.port || 8765,
                model: txt.model || undefined,
                version: txt.version || undefined,
                id: txt.id || service.name || undefined,
              });
            }
          });

          await new Promise((r) => setTimeout(r, duration));

          try {
            browser.stop();
            bonjour.destroy();
          } catch {
            // ignore cleanup errors
          }

          cachedDevices = Array.from(found.values());
          lastScanAt = now;

          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ cached: false, devices: cachedDevices }));
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        } finally {
          isScanning = false;
        }
      });
    },
  };
}

export default mdnsDiscoveryPlugin;
