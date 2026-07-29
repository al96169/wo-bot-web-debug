<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket, onMessage } from "@/composables/useWebSocket";

const robotStore = useRobotStore();

/* ============================================================
 * 传感器时间轴图表 (R00045)
 *
 * 使用 ECharts CDN 动态加载，支持：
 * - 多传感器曲线叠加
 * - 传感器勾选/取消
 * - 时间范围切换 (1h/6h/24h/7d)
 * - 双 Y 轴（温度和湿度独立缩放）
 * - 悬停查看具体数值
 * ============================================================ */

// ---- 槽位标签与颜色映射（必须在 computed 之前定义） ----
function getSlotLabel(name: string): string {
  const map: Record<string, string> = {
    dht11: "温湿度",
    gas: "燃气",
    light: "光照",
    co2: "CO₂",
    pm25: "PM2.5",
    ir_transceiver: "红外",
    battery_voltage: "电池电压",
  };
  return map[name] || name;
}

const SLOT_COLORS: Record<string, string> = {
  dht11: "#ef4444",
  gas: "#f59e0b",
  light: "#eab308",
  co2: "#84cc16",
  pm25: "#06b6d4",
  ir_transceiver: "#8b5cf6",
  battery_voltage: "#22c55e",
};

// ---- 状态 ----
const loaded = ref(false);
const error = ref("");
const loading = ref(false);
const range = ref<"1h" | "6h" | "24h" | "7d">("1h");
const selectedSlots = ref<string[]>([]);

// ---- 槽位配置（哪些传感器有数据） ----
const slotsConfig = computed(() => {
  const configs: { name: string; label: string; color: string }[] = [];
  const p = robotStore.systemStatus.peripherals;
  for (const [name, info] of Object.entries(p)) {
    if (info.provider && info.provider !== "none") {
      configs.push({
        name,
        label: getSlotLabel(name),
        color: SLOT_COLORS[name] || "#00d4ff",
      });
    }
  }
  return configs;
});

// 默认全选所有已配置的传感器
watch(
  slotsConfig,
  (configs) => {
    if (selectedSlots.value.length === 0 && configs.length > 0) {
      selectedSlots.value = configs.map((c) => c.name);
    }
  },
  { immediate: true },
);

const activeSlots = computed(() =>
  slotsConfig.value.filter((s) => selectedSlots.value.includes(s.name)),
);

// ---- ECharts 加载 ----
let echartsInstance: any = null;
const chartRef = ref<HTMLDivElement>();

// ---- 动态加载 ECharts ----
async function loadECharts(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).echarts) {
      resolve((window as any).echarts);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js";
    script.onload = () => resolve((window as any).echarts);
    script.onerror = () => reject(new Error("ECharts 加载失败，请检查网络连接"));
    document.head.appendChild(script);
  });
}

// ---- WebSocket 通信 ----
const { sendPeripheralHistory } = useWebSocket();

// ---- 数据获取（WebSocket） ----
function fetchHistory() {
  if (activeSlots.value.length === 0) return;
  loading.value = true;
  error.value = "";

  sendPeripheralHistory(
    activeSlots.value.map((s) => s.name),
    range.value,
  );
}

// ---- 图表渲染 ----
function renderChart(data: any) {
  if (!echartsInstance || !chartRef.value) return;

  const echarts = (window as any).echarts;
  if (!echarts) return;

  const rawData = data.data || {};
  const series: any[] = [];
  const yAxisConfigs: any[] = [];
  const legendData: string[] = [];
  let yIndexTemp = -1;
  let yIndexHum = -1;
  let nextYIndex = 0;

  // DHT11 特殊处理：temperature 和 humidity 分属两个 Y 轴
  const hasDht11 = rawData.dht11 && rawData.dht11.length > 0;

  if (hasDht11) {
    yIndexTemp = nextYIndex++;
    yAxisConfigs.push({
      type: "value",
      name: "温度 (°C)",
      position: "left",
      axisLabel: { color: "#ef4444", fontSize: 10 },
      nameTextStyle: { color: "#ef4444", fontSize: 10 },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    });
    yIndexHum = nextYIndex++;
    yAxisConfigs.push({
      type: "value",
      name: "湿度 (%)",
      position: "right",
      axisLabel: { color: "#3b82f6", fontSize: 10 },
      nameTextStyle: { color: "#3b82f6", fontSize: 10 },
      splitLine: { show: false },
    });

    const tempData = rawData.dht11
      .map((d: any) => [d.ts * 1000, d.temperature])
      .filter((d: any) => d[1] != null);
    const humData = rawData.dht11
      .map((d: any) => [d.ts * 1000, d.humidity])
      .filter((d: any) => d[1] != null);

    legendData.push("温度", "湿度");

    series.push({
      name: "温度",
      type: "line",
      yAxisIndex: yIndexTemp,
      smooth: true,
      symbol: "none",
      lineStyle: { color: "#ef4444", width: 2 },
      data: tempData,
    });
    series.push({
      name: "湿度",
      type: "line",
      yAxisIndex: yIndexHum,
      smooth: true,
      symbol: "none",
      lineStyle: { color: "#3b82f6", width: 2 },
      data: humData,
    });
  }

  // 其他传感器（共用左侧 Y 轴或新建 Y 轴）
  for (const [slotName, points] of Object.entries(rawData)) {
    if (slotName === "dht11") continue;
    if (!Array.isArray(points) || points.length === 0) continue;

    const color = SLOT_COLORS[slotName] || "#00d4ff";
    const label = getSlotLabel(slotName);
    const yIndex = hasDht11 ? yIndexTemp : 0;
    // 如果这是第一个非 DHT11 传感器且没有左 Y 轴，创建它
    if (yAxisConfigs.length === 0) {
      yAxisConfigs.push({
        type: "value",
        name: label,
        position: "left",
        axisLabel: { color, fontSize: 10 },
        nameTextStyle: { color, fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      });
    }

    const mapped = points
      .map((d: any) => [d.ts * 1000, d.value != null ? d.value : null])
      .filter((d: any) => d[1] != null);

    legendData.push(label);
    series.push({
      name: label,
      type: "line",
      yAxisIndex: yIndex,
      smooth: true,
      symbol: "none",
      lineStyle: { color, width: 2 },
      data: mapped,
    });
  }

  // Fallback: 确保至少一个 Y 轴
  if (yAxisConfigs.length === 0) {
    yAxisConfigs.push({
      type: "value",
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
    });
  }

  echartsInstance.setOption(
    {
      backgroundColor: "transparent",
      legend: {
        data: legendData,
        bottom: 0,
        textStyle: { color: "#9ca3af", fontSize: 11 },
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 8,
      },
      grid: {
        left: 60,
        right: 60,
        top: 20,
        bottom: 40,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(17,24,39,0.95)",
        borderColor: "rgba(255,255,255,0.1)",
        textStyle: { color: "#e5e7eb", fontSize: 12 },
        formatter: (params: any) => {
          if (!params || params.length === 0) return "";
          const time = new Date(params[0].value[0]).toLocaleString("zh-CN");
          let html = `<div style="font-weight:600;margin-bottom:4px">${time}</div>`;
          for (const p of params) {
            const val = p.value[1] != null ? p.value[1].toFixed(1) : "--";
            html += `<div style="color:${p.color};margin:2px 0">
              ${p.marker} ${p.seriesName}: ${val}
            </div>`;
          }
          return html;
        },
      },
      xAxis: {
        type: "time",
        axisLabel: {
          color: "#6b7280",
          fontSize: 10,
          formatter: (val: number) => {
            const d = new Date(val);
            if (range.value === "7d" || range.value === "24h") {
              return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:00`;
            }
            return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
          },
        },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.1)" } },
        splitLine: { show: false },
      },
      yAxis: yAxisConfigs,
      series,
    },
    { notMerge: true },
  );
}

// ---- 事件 ----
function toggleSlot(name: string) {
  const idx = selectedSlots.value.indexOf(name);
  if (idx >= 0) {
    if (selectedSlots.value.length > 1) {
      selectedSlots.value.splice(idx, 1);
    }
  } else {
    selectedSlots.value.push(name);
  }
}

function changeRange(r: "1h" | "6h" | "24h" | "7d") {
  range.value = r;
}

// ---- 生命周期 ----
let resizeHandler: (() => void) | null = null;
let unlistenMsg: (() => void) | null = null;

onMounted(async () => {
  // 统一消息监听：错误 + peripheral_history 响应
  unlistenMsg = onMessage((msg) => {
    if (msg.type === "error" && loading.value) {
      loading.value = false;
      error.value = msg.data?.message || "请求失败";
    } else if (msg.type === "peripheral_history") {
      loading.value = false;
      renderChart(msg.data);
    }
  });

  try {
    const echarts = await loadECharts();
    if (chartRef.value) {
      echartsInstance = echarts.init(chartRef.value, undefined, { renderer: "canvas" });
      resizeHandler = () => echartsInstance?.resize();
      window.addEventListener("resize", resizeHandler);
      loaded.value = true;
      fetchHistory();
    }
  } catch (e: any) {
    error.value = e.message || "加载失败";
  }
});

onUnmounted(() => {
  unlistenMsg?.();
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
  echartsInstance?.dispose();
});

// 时间范围或传感器勾选变化时重新请求
watch([range, selectedSlots], () => {
  if (loaded.value) fetchHistory();
});
</script>

<template>
  <div class="sensor-chart-view">
    <!-- 头部 -->
    <div class="chart-header">
      <h2>传感器数据</h2>
    </div>

    <!-- 控件栏 -->
    <div class="chart-controls">
      <div class="sensor-toggles">
        <button
          v-for="slot in slotsConfig"
          :key="slot.name"
          class="toggle-btn"
          :class="{ active: selectedSlots.includes(slot.name) }"
          :style="{ '--slot-color': slot.color }"
          @click="toggleSlot(slot.name)"
        >
          {{ slot.label }}
        </button>
        <span v-if="slotsConfig.length === 0" class="no-sensors">
          暂无已配置的传感器
        </span>
      </div>
      <div class="range-toggles">
        <button
          v-for="r in (['1h','6h','24h','7d'] as const)"
          :key="r"
          class="range-btn"
          :class="{ active: range === r }"
          @click="changeRange(r)"
        >
          {{ r }}
        </button>
      </div>
    </div>

    <!-- 图表区域：overlay 与 chart 分离，避免 ECharts 破坏 Vue DOM 锚点 -->
    <div class="chart-wrapper">
      <div class="chart-container" ref="chartRef"></div>
      <div v-if="!loaded && !error" class="chart-overlay">加载图表组件中...</div>
      <div v-if="loading" class="chart-overlay">加载数据中...</div>
      <div v-if="error" class="chart-overlay chart-error">
        <p>{{ error }}</p>
        <button class="retry-btn" @click="fetchHistory">重试</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sensor-chart-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  gap: 16px;
  overflow: hidden;
}
.chart-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #e5e7eb);
}
.chart-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.sensor-toggles {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.toggle-btn {
  padding: 5px 14px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 999px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  color: var(--text-secondary, #9ca3af);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.toggle-btn:hover {
  border-color: var(--slot-color, #00d4ff);
  color: var(--text-primary, #e5e7eb);
}
.toggle-btn.active {
  background: rgba(0, 212, 255, 0.12);
  border-color: var(--slot-color, #00d4ff);
  color: var(--slot-color, #00d4ff);
}
.no-sensors {
  color: var(--text-muted, #6b7280);
  font-size: 12px;
}
.range-toggles {
  display: flex;
  gap: 2px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  border-radius: 8px;
  padding: 2px;
}
.range-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #9ca3af);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.range-btn:hover {
  color: var(--text-primary, #e5e7eb);
}
.range-btn.active {
  background: var(--accent, #00d4ff);
  color: #fff;
}
.chart-wrapper {
  flex: 1;
  min-height: 300px;
  position: relative;
}
.chart-container {
  position: absolute;
  inset: 0;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  background: var(--bg-secondary, rgba(0, 0, 0, 0.2));
  overflow: hidden;
}
.chart-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #6b7280);
  font-size: 14px;
  gap: 8px;
  z-index: 10;
  pointer-events: none;
}
.chart-error {
  color: #ef4444;
  pointer-events: auto;
}
.retry-btn {
  padding: 4px 16px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.04));
  color: var(--text-secondary, #9ca3af);
  font-size: 12px;
  cursor: pointer;
}
.retry-btn:hover {
  border-color: var(--accent, #00d4ff);
  color: var(--accent, #00d4ff);
}
</style>
