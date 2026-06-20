import { ref, type Ref } from "vue";
import { useAppStore } from "../stores/app";
import { useDevicesStore } from "../stores/devices";
import { useRobotStore } from "../stores/robot";
import type { Module, Message, Software, Device, LogEntry } from "../types";

/* ============================================================
 * wo-bot-vue - Mock 模式组合式函数
 *
 * 模拟完整的机器人联机体验，包括设备发现、模块状态、
 * 消息推送、软件列表、实时运行指标和日志输出。
 * ============================================================ */

const MOCK_MODULE_NAMES = [
  "nav-engine",
  "vision-pipeline",
  "lidar-driver",
  "motor-ctrl",
  "imu-sensor",
  "battery-mgr",
  "audio-codec",
  "thermal-mon",
];

const MOCK_FEATURES = ["SLAM", "RGB-D", "LiDAR", "IMU", "GPS", "Obstacle", "Audio", "Thermal"];

const MOCK_SUBJECTS = [
  "系统自检报告",
  "固件更新通知",
  "电机过温警告",
  "电池维护提醒",
  "导航路径优化",
  "传感器校准完成",
  "地图更新完成",
  "任务执行结果",
];

export function useMock() {
  const appStore = useAppStore();
  const devicesStore = useDevicesStore();
  const robotStore = useRobotStore();

  // 运行指标
  const mockBattery = ref(85);
  const mockCpu = ref(42);
  const mockMemory = ref(58);
  const mockDisk = ref(33);

  // 计数器
  let logCounter = 0;
  let msgCounter = 0;
  let discoveryCounter = 0;

  // 定时器句柄
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let discoveryTimer: ReturnType<typeof setInterval> | null = null;
  let logTimer: ReturnType<typeof setInterval> | null = null;

  /* ---- 启动 Mock ---- */

  function startMockMode(): void {
    // 防重复：已在 mock 模式下不再重新初始化
    if (appStore.mockMode && devicesStore.currentDevice) return;

    appStore.mockMode = true;

    // 生成假设备列表
    generateMockDevices();

    // 生成假模块
    generateMockModules();

    // 生成假消息
    generateMockMessages();

    // 生成假软件
    generateMockSoftware();

    // 子系统状态
    robotStore.setSubsystemStatus([
      { name: "运动控制", status: "online", icon: "🏃" },
      { name: "摄像头系统", status: "online", icon: "📷" },
      { name: "激光雷达", status: "online", icon: "📡" },
      { name: "IMU 传感器", status: "online", icon: "🧭" },
      { name: "音频系统", status: "online", icon: "🔊" },
      { name: "电源管理", status: "online", icon: "🔋" },
      { name: "GPS 模块", status: "offline", icon: "🛰️" },
      { name: "温控系统", status: "warning", icon: "🌡️" },
    ]);

    // 设备详情
    robotStore.setDeviceDetails([
      { label: "设备型号", value: "WB-MK3", copyable: true },
      { label: "序列号", value: "WB2025-DEV-001", copyable: true },
      { label: "固件版本", value: "v4.2.1-beta", copyable: true },
      { label: "ROS 版本", value: "2.1.0 Humble", copyable: true },
      { label: "操作系统", value: "Ubuntu 22.04 LTS", copyable: true },
      { label: "内核版本", value: "5.15.0-102-generic", copyable: true },
    ]);

    // 推送初始系统状态 BEFORE 启动定时器
    robotStore.setSystemStatus({
      battery: { level: 85, status: "discharging", state: "正常", temp: 30 },
      cpu: { usage: 42, temp: 45 },
      memory: { usage: 58 },
      disk: { usage: 33 },
      wifi: { ssid: "MockWiFi", signal: "-35 dBm", ip: "192.168.1.100" },
      cellular: { signal: "-72 dBm", carrier: "中国移动" },
      environment: { temperature: "26°C", humidity: "55%", gas: "正常", light: "420 lux" },
      uptime: 3300,
      hostname: "wobot-mock",
    });

    // 日志
    robotStore.addLog("info", "Mock", "Mock 模式已启动");

    // 启动定时器
    startStatusTimer();
    startDiscoveryTimer();
    startLogTimer();

    // 2 阶段连接：先 connecting，800ms 后 connected
    appStore.connection = "connecting";

    setTimeout(() => {
      if (!appStore.mockMode) return;
      appStore.connection = "connected";
      appStore._lastPing = 4;
      devicesStore.setRobotInfo({
        robot_id: "WB-2025-DEV",
        name: "wo-bot Simulator",
        model: "WB-MK3",
        version: "v4.2.1-beta",
        features: [...MOCK_FEATURES],
      });
    }, 800);
  }

  function stopMockMode(): void {
    appStore.connection = "disconnected";
    appStore.mockMode = false;

    // 清理所有定时器
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
    if (discoveryTimer) {
      clearInterval(discoveryTimer);
      discoveryTimer = null;
    }
    if (logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }

    // 清理数据
    devicesStore.currentDevice = null;
    devicesStore.robotInfo = null;
    robotStore.setSystemStatus({
      battery: { level: 0, status: "unknown", state: "未知", temp: 0 },
      cpu: { usage: 0, temp: 0 },
      memory: { usage: 0 },
      disk: { usage: 0 },
      wifi: { ssid: "--", signal: "--", ip: "--" },
      cellular: { signal: "--", carrier: "--" },
      environment: { temperature: "--", humidity: "--", gas: "--", light: "--" },
      uptime: 0,
      hostname: "--",
    });

    robotStore.setSubsystemStatus([]);
    robotStore.setDeviceDetails([]);
    robotStore.clearLogs();
    robotStore.addLog("info", "Mock", "Mock 模式已停止");
  }

  /* ---- Mock 生成函数 ---- */

  function generateMockDevices(): void {
    const deviceList: Device[] = [
      { id: "d1", name: "wo-bot #1 (大厅)", ip: "192.168.1.101", port: 8899, online: true },
      { id: "d2", name: "wo-bot #2 (仓库)", ip: "192.168.1.102", port: 8899, online: true },
      { id: "d3", name: "wo-bot #3 (实验室)", ip: "192.168.1.103", port: 8899, online: false },
    ];
    devicesStore.devices = deviceList;
    devicesStore.currentDevice = deviceList[0];
  }

  function generateMockModules(): void {
    const statuses: Array<Module["status"]> = [
      "online",
      "online",
      "online",
      "online",
      "online",
      "online",
      "offline",
      "disabled",
    ];
    const modules: Module[] = MOCK_MODULE_NAMES.map((name, i) => ({
      id: `mod-${i + 1}`,
      name,
      version: `v${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 100)}`,
      status: statuses[i],
      enabled: statuses[i] !== "disabled",
    }));
    robotStore.setModules(modules);
  }

  function generateMockMessages(): void {
    const msgs: Message[] = MOCK_SUBJECTS.map((subject, i) => ({
      id: `msg-${i + 1}`,
      subject,
      time: Date.now() - i * 3600000,
      summary: `这是关于 ${subject} 的简短摘要。`,
      body: `详细内容：${subject} 已完成。各项指标正常，建议定期检查。`,
      read: i > 2,
    }));
    msgCounter = msgs.length + 1;
    robotStore.setMessages(msgs);
  }

  function generateMockSoftware(): void {
    const swList: Software[] = [
      {
        name: "wo-nav-core",
        version: "2.1.0",
        size: "45 MB",
        installDate: "2025-03-15",
        icon: "nav",
        source: "official",
      },
      {
        name: "wo-vision-sdk",
        version: "1.8.3",
        size: "128 MB",
        installDate: "2025-04-02",
        icon: "vision",
        source: "official",
      },
      {
        name: "wo-slam-engine",
        version: "3.0.1",
        size: "256 MB",
        installDate: "2025-05-10",
        icon: "slam",
        source: "official",
      },
      {
        name: "community-utils",
        version: "0.9.5",
        size: "8 MB",
        installDate: "2025-05-22",
        icon: "utils",
        source: "community",
      },
      {
        name: "debug-tools",
        version: "1.2.0",
        size: "12 MB",
        installDate: "2025-05-28",
        icon: "debug",
        source: "community",
      },
    ];
    robotStore.setInstalledSoftware(swList);
  }

  /* ---- Mock 定时器 ---- */

  function startStatusTimer(): void {
    statusTimer = setInterval(() => {
      mockBattery.value = Math.max(50, Math.min(100, mockBattery.value + (Math.random() - 0.5) * 6));
      mockCpu.value = Math.max(15, Math.min(85, mockCpu.value + (Math.random() - 0.5) * 10));
      mockMemory.value = Math.max(35, Math.min(80, mockMemory.value + (Math.random() - 0.5) * 5));
      mockDisk.value = Math.max(28, Math.min(42, mockDisk.value + (Math.random() - 0.3) * 0.5));
      // Push to store so views update
      robotStore.setSystemStatus({
        battery: {
          level: Math.round(mockBattery.value),
          status: Math.random() > 0.3 ? "discharging" : "charging",
          state: mockBattery.value > 50 ? "正常" : "低电量",
          temp: 25 + Math.round(Math.random() * 15),
        },
        cpu: { usage: Math.round(mockCpu.value), temp: 40 + Math.round(Math.random() * 20) },
        memory: { usage: Math.round(mockMemory.value) },
        disk: { usage: Math.round(mockDisk.value) },
        wifi: { ssid: "MockWiFi", signal: `${-40 + Math.round(Math.random() * 20)} dBm`, ip: "192.168.1.100" },
        cellular: { signal: `${-70 + Math.round(Math.random() * 20)} dBm`, carrier: "中国移动" },
        environment: {
          temperature: `${22 + Math.round(Math.random() * 8)}°C`,
          humidity: `${45 + Math.round(Math.random() * 20)}%`,
          gas: "正常",
          light: `${300 + Math.round(Math.random() * 500)} lux`,
        },
        uptime: mockDisk.value * 100,
        hostname: "wobot-mock",
      });
      // Update ping
      appStore._lastPing = 3 + Math.floor(Math.random() * 6);
    }, 3000);
  }

  function startDiscoveryTimer(): void {
    appStore.scanning = true;
    const prefixes = ["camera-node", "sensor-hub", "edge-gateway", "motor-ctrl"];
    discoveryTimer = setInterval(() => {
      discoveryCounter++;
      const idx = discoveryCounter % prefixes.length;
      const device: Device = {
        id: `disc-${discoveryCounter}`,
        name: `${prefixes[idx]}-${discoveryCounter}`,
        ip: `192.168.2.${100 + discoveryCounter}`,
        port: 8899,
        online: Math.random() > 0.3,
      };
      devicesStore.addDiscovered(device);
      if (discoveryCounter >= 8) {
        if (discoveryTimer) {
          clearInterval(discoveryTimer);
          discoveryTimer = null;
        }
        appStore.scanning = false;
      }
    }, 4000);
  }

  function startLogTimer(): void {
    const levels: LogEntry["level"][] = ["debug", "info", "info", "info", "warn", "error"];
    const sources = ["nav-engine", "vision", "lidar", "motor", "imu", "system"];
    const messages = [
      "位姿更新完成",
      "点云处理完成，共 12800 点",
      "路径规划重新计算中",
      "电机 PID 参数已调整",
      "IMU 校准偏移超出阈值",
      "温度传感器读数异常，已触发降频",
    ];
    logTimer = setInterval(() => {
      logCounter++;
      const level = levels[logCounter % levels.length];
      const source = sources[logCounter % sources.length];
      const msg = messages[logCounter % messages.length];
      robotStore.addLog(level, source, `[mock] ${msg} (seq=${logCounter})`);
    }, 2500);
  }

  return {
    mockBattery: mockBattery as Ref<number>,
    mockCpu: mockCpu as Ref<number>,
    mockMemory: mockMemory as Ref<number>,
    mockDisk: mockDisk as Ref<number>,
    startMockMode,
    stopMockMode,
  };
}
