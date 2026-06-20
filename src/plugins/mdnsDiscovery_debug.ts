/**
 * Vite 插件：mDNS 设备发现中间件（调试版，打印原始 service 对象）
 */
import type { Plugin } from "vite";

function mdnsDiscoveryPlugin(): Plugin {
  return {
    name: "wo-bot-mdns-discovery-debug",
    configureServer(server) {
      server.middlewares.use("/api/discover-debug", async (_req, res) => {
        const Bonjour = (await import("bonjour-service")).default;
        const bonjour = new Bonjour();
        const all: any[] = [];

        const browser = bonjour.find({ type: "wobot" }, (service: any) => {
          all.push({
            name: service.name,
            fqdn: service.fqdn,
            host: service.host,
            addresses: service.addresses,
            ipv4: service.ipv4,
            ipv6: service.ipv6,
            port: service.port,
            txt: service.txt,
            raw: JSON.stringify(service),
          });
        });

        await new Promise((r) => setTimeout(r, 3000));

        try {
          browser.stop();
          bonjour.destroy();
        } catch {}

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(all, null, 2));
      });
    },
  };
}

export default mdnsDiscoveryPlugin;
