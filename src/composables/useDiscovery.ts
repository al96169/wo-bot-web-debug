import { ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useDevicesStore } from '../stores/devices'
import { useRobotStore } from '../stores/robot'

/* ============================================================
 * wo-bot-web-debug - 设备发现
 *
 * 策略：
 * 1. 优先调用 /api/discover（由 Vite 开发服务器的 mDNS 插件提供）
 *    该插件监听 _wobot._tcp.local. 多播，收集局域网内的机器人
 * 2. 同时做已知 IP 的快速探活（127.0.0.1 + 页面自身IP）作为补充
 * ============================================================ */

const WS_PORT = 8765

interface MDnsDevice {
  name: string
  ip: string
  port: number
  model?: string
  id?: string
  version?: string
}

export function useDiscovery() {
  const appStore = useAppStore()
  const devicesStore = useDevicesStore()
  const robotStore = useRobotStore()

  const scanning = ref(false)

  /** 快速探活单个 IP */
  function probe(ip: string, timeout: number): Promise<{ name: string; ip: string } | null> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://${ip}:${WS_PORT}`)
      const tid = setTimeout(() => { ws.close(); resolve(null) }, timeout)

      ws.onopen = () => {
        clearTimeout(tid)
        const rtid = setTimeout(() => { ws.close(); resolve({ name: `设备 ${ip}`, ip }) }, 600)
        ws.onmessage = (e) => {
          clearTimeout(rtid)
          ws.close()
          try {
            const m = JSON.parse(e.data)
            resolve({ name: m.data?.name || `设备 ${ip}`, ip: m.data?.ip || ip })
          } catch {
            resolve({ name: `设备 ${ip}`, ip })
          }
        }
      }
      ws.onerror = () => { clearTimeout(tid); resolve(null) }
    })
  }

  /** 调用开发服务器的 mDNS 发现接口 */
  async function callMdnsApi(durationMs: number): Promise<MDnsDevice[]> {
    try {
      const resp = await fetch(`/api/discover?t=${durationMs}`)
      if (!resp.ok) return []
      const data = await resp.json()
      return (data?.devices as MDnsDevice[]) || []
    } catch {
      return []
    }
  }

  /** 开始扫描 */
  async function startScan(): Promise<void> {
    if (scanning.value || appStore.mockMode) return
    scanning.value = true
    appStore.scanning = true
    devicesStore.clearDiscovered()

    robotStore.addLog('info', 'Discovery', '开始扫描局域网设备...')

    // 并行：mDNS 发现 + 本地快速探活
    const mdnsPromise = callMdnsApi(2500)

    const localTargets = new Set<string>()
    localTargets.add('127.0.0.1')
    const hostname = window.location.hostname
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      localTargets.add(hostname)
    }
    const localPromise = Promise.all(
      [...localTargets].map((ip) => probe(ip, 1500)),
    )

    const [mdnsDevices, localResults] = await Promise.all([mdnsPromise, localPromise])

    const combined = new Map<string, { name: string; ip: string; port: number }>()

    for (const d of mdnsDevices) {
      combined.set(d.ip + ':' + d.port, { name: d.name, ip: d.ip, port: d.port })
    }
    for (const r of localResults) {
      if (!r) continue
      combined.set(r.ip + ':' + WS_PORT, { name: r.name, ip: r.ip, port: WS_PORT })
    }

    let found = 0
    for (const device of combined.values()) {
      found++
      devicesStore.addDiscovered({
        id: `lan-${device.ip.replace(/\./g, '-')}-${device.port}`,
        name: device.name,
        ip: device.ip,
        port: device.port,
        online: true,
      })
    }

    robotStore.addLog(
      'info',
      'Discovery',
      `扫描完成: 发现 ${found} 个设备（mDNS: ${mdnsDevices.length}, 探测: ${localResults.filter((x) => x).length}）`,
    )
    scanning.value = false
    appStore.scanning = false
  }

  function stopScan(): void {
    scanning.value = false
    appStore.scanning = false
  }

  return { scanning, startScan, stopScan }
}
