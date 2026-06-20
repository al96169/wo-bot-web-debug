import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import mdnsDiscovery from './src/plugins/mdnsDiscovery'
import { WebSocketServer, WebSocket } from 'ws'

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
        const pendingQueue: Array<{ data: any; isBinary: boolean }> = []
        targetWs.on('open', () => {
          while (pendingQueue.length > 0) {
            const p = pendingQueue.shift()!
            targetWs.send(p.data, { binary: p.isBinary })
          }
        })

        // 接受浏览器端的 WebSocket 升级
        wss.handleUpgrade(req, socket, head, (ws: any) => {
          clientWs = ws

          // 浏览器端 -> 目标
          ws.on('message', (data: any, isBinary: boolean) => {
            if (targetWs.readyState === WebSocket.OPEN) {
              targetWs.send(data, { binary: isBinary })
            } else {
              pendingQueue.push({ data, isBinary })
            }
          })
          ws.on('close', () => safeClose(targetWs))
          ws.on('error', () => safeClose(targetWs))

          // 目标 -> 浏览器端
          targetWs.on('message', (data: any, isBinary: boolean) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data, { binary: isBinary })
            }
          })
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
