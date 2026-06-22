import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { networkInterfaces } from 'node:os'
import mdnsDiscovery from './src/plugins/mdnsDiscovery'
import { WebSocketServer, WebSocket } from 'ws'

// 获取本机局域网 IPv4 地址
function getLanIp(): string {
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return ''
}

// 规范化客户端 IP：去除 ::ffff: 前缀，localhost 替换为局域网 IP
function normalizeClientIp(raw: string): string {
  if (!raw) return ''
  // 去除 IPv4-mapped IPv6 前缀
  let ip = raw.replace(/^::ffff:/, '')
  // localhost 替换为本机局域网 IP（Jetson 需要真实可路由 IP）
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
    ip = getLanIp()
  }
  return ip
}

// WebSocket 代理插件：浏览器连接 ws://localhost:9093/api/device-ws?host=IP&port=PORT
function wsProxyPlugin() {
  return {
    name: 'ws-proxy',
    configureServer(server: any) {
      const wss = new WebSocketServer({ noServer: true })

      server.httpServer?.on('upgrade', (req: any, socket: any, head: any) => {
        const url = new URL(req.url!, `http://${req.headers.host}`)

        if (url.pathname !== '/api/device-ws') return

        const host = url.searchParams.get('host')
        const port = url.searchParams.get('port')
        const protocolVersion = url.searchParams.get('protocol_version')
        const token = url.searchParams.get('token')

        if (!host || !port) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
          socket.destroy()
          return
        }

        let targetUrl = `ws://${host}:${port}`
        const targetParams: string[] = []
        if (protocolVersion) targetParams.push(`protocol_version=${encodeURIComponent(protocolVersion)}`)
        if (token) targetParams.push(`token=${encodeURIComponent(token)}`)
        // 传递客户端真实 IP，用于 Jetson 端修复 mDNS .local 解析错误
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
        const clientIp = normalizeClientIp(rawIp)
        if (clientIp) targetParams.push(`client_ip=${encodeURIComponent(clientIp)}`)
        if (targetParams.length > 0) targetUrl += '?' + targetParams.join('&')
        const targetWs = new WebSocket(targetUrl)
        let clientWs: any = null
        let closed = false

        function safeClose(ws: any, code?: number, reason?: string) {
          if (closed) return
          closed = true
          try {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
              ws.close(code ?? 1000, reason)
            }
          } catch { /* ignore */ }
        }

        targetWs.on('error', (err: Error) => {
          console.error('[WS Proxy] 目标连接失败:', err.message)
          if (clientWs) safeClose(clientWs)
        })

        // 消息缓冲：targetWs 未 OPEN 时暂存，OPEN 后发送
        const pendingToTarget: Array<{ data: any; isBinary: boolean }> = []
        targetWs.on('open', () => {
          while (pendingToTarget.length > 0) {
            const p = pendingToTarget.shift()!
            targetWs.send(p.data, { binary: p.isBinary })
          }
        })

        // 目标→浏览器缓冲：浏览器 WebSocket 未就绪时暂存，避免丢失 connected 等关键消息
        const pendingToClient: any[] = []

        // 提前注册目标→浏览器消息处理器（放在 handleUpgrade 外面），
        // 防止 Jetson 的 connected 消息在浏览器升级完成前到达而被丢弃
        targetWs.on('message', (data: any, isBinary: boolean) => {
          if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data, { binary: isBinary })
          } else {
            pendingToClient.push({ data, isBinary })
          }
        })

        // 接受浏览器端的 WebSocket 升级
        wss.handleUpgrade(req, socket, head, (ws: any) => {
          clientWs = ws

          // 将缓冲的目标→浏览器消息全部发送
          while (pendingToClient.length > 0) {
            const p = pendingToClient.shift()!
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(p.data, { binary: p.isBinary })
            }
          }

          // 浏览器端 -> 目标
          ws.on('message', (data: any, isBinary: boolean) => {
            if (targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(data, { binary: isBinary })
            } else {
              pendingToTarget.push({ data, isBinary })
            }
          })
          ws.on('close', () => safeClose(targetWs))
          ws.on('error', () => safeClose(targetWs))

          targetWs.on('close', (code: number, reason: Buffer) => {
            // 转发目标端关闭码，让浏览器端能检测 4001 等异常码
            safeClose(ws, code, reason?.toString())
          })
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), mdnsDiscovery(), wsProxyPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 9093,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 9093,
    },
  },
})
