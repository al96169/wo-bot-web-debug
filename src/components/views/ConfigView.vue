<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useAppStore } from "@/stores/app";
import { useWebSocket } from "@/composables/useWebSocket";
import ClientManagementView from "@/components/views/ClientManagementView.vue";
import { DEFAULT_CONFIG, CORE_FEATURES, FEATURE_LABELS, DRIVE_TYPE_OPTIONS } from "@/schemas/configSchema";
import type { RobotConfig } from "@/types";

const robotStore = useRobotStore();
const appStore = useAppStore();
const { sendWs } = useWebSocket();

// ---- 标签页 ----
const activeTab = ref<string>("features");

const tabs = [
  { id: "features", label: "🔧 功能列表" },
  { id: "motion", label: "🚗 运动方式" },
  { id: "camera", label: "📷 摄像头" },
  { id: "network", label: "🌐 网络" },
  { id: "power", label: "🔋 省电配置" },
  { id: "software", label: "📦 软件管理" },
  { id: "json_editor", label: "{ } JSON编辑器" },
  { id: "debug", label: "🧪 调试面板" },
  { id: "clients", label: "🔗 绑定配置" },
];

// ---- 编辑中的配置 ----
const editConfig = ref<RobotConfig>(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));

// ---- JSON 编辑器 ----
const jsonText = ref("");
const jsonError = ref("");

// ---- 省电策略 ----
// threshold 已合并到 editConfig.power_policy.threshold，通过 config_set 统一保存

// ---- 模拟电量调试 ----
const simulateBatteryLevel = ref<number>(25);
const isSimulating = ref(false);
let _simulateDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ---- 应用配置 ----
const isApplying = ref(false);
const _pendingApply = ref(false);
let _applyTimeout: ReturnType<typeof setTimeout> | null = null;

// ---- 初始化 ----
onMounted(() => {
  const sim = (robotStore.powerPolicy as any).simulated_battery;
  if (sim != null) {
    isSimulating.value = true;
    simulateBatteryLevel.value = sim;
  }
  if (!robotStore.configLoaded) {
    sendWs({ type: "config_get", data: {} });
  } else if (robotStore.robotConfig) {
    applyConfigToEdit(robotStore.robotConfig);
  }
});

watch(
  () => robotStore.robotConfig,
  (config) => {
    if (config) {
      applyConfigToEdit(config);
      if (_pendingApply.value) {
        _pendingApply.value = false;
        isApplying.value = false;
        if (_applyTimeout) {
          clearTimeout(_applyTimeout);
          _applyTimeout = null;
        }
        appStore.showToast("配置已应用", "success");
      }
    }
  },
);

// 模拟电量拖动
watch(simulateBatteryLevel, (val) => {
  if (!isSimulating.value) return;
  if (_simulateDebounceTimer) clearTimeout(_simulateDebounceTimer);
  _simulateDebounceTimer = setTimeout(() => sendSimulateBattery(val), 300);
});

function applyConfigToEdit(config: RobotConfig) {
  editConfig.value = safeMergeConfig(config);
  nextTick(() => {
    jsonText.value = JSON.stringify(editConfig.value, null, 2);
  });
}

function safeMergeConfig(config: RobotConfig): RobotConfig {
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), config) as RobotConfig;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

// ---- JSON 编辑器 ----
function syncToJson() {
  jsonText.value = JSON.stringify(editConfig.value, null, 2);
  jsonError.value = "";
}

function validateJson(text: string): boolean {
  try {
    JSON.parse(text);
    jsonError.value = "";
    return true;
  } catch (e: any) {
    jsonError.value = `JSON 格式错误: ${e.message}`;
    return false;
  }
}

function formatJson() {
  if (validateJson(jsonText.value)) {
    jsonText.value = JSON.stringify(JSON.parse(jsonText.value), null, 2);
  }
}

function handleApplyJson() {
  if (!validateJson(jsonText.value)) return;
  try {
    editConfig.value = safeMergeConfig(JSON.parse(jsonText.value));
    jsonError.value = "";
    jsonText.value = JSON.stringify(editConfig.value, null, 2);
    appStore.showToast("JSON 已回填到表单，请检查后点击「应用配置」保存", "success");
  } catch {
    /* already validated */
  }
}

// ---- 应用配置 ----
function hasConfigChanged(): boolean {
  if (!robotStore.robotConfig) return true;
  return JSON.stringify(editConfig.value) !== JSON.stringify(robotStore.robotConfig);
}

function handleApplyConfig() {
  if (isApplying.value) return;
  isApplying.value = true;
  _pendingApply.value = true;
  if (_applyTimeout) clearTimeout(_applyTimeout);
  _applyTimeout = setTimeout(() => {
    if (_pendingApply.value) {
      _pendingApply.value = false;
      isApplying.value = false;
      appStore.showToast("配置已发送，但未收到确认反馈", "info");
    }
    _applyTimeout = null;
  }, 8000);
  sendWs({ type: "config_set", data: { config: JSON.parse(JSON.stringify(editConfig.value)) } });
}

// ---- 功能开关 ----
function isCoreFeature(key: string): boolean {
  return (CORE_FEATURES as readonly string[]).includes(key);
}

function toggleFeature(key: string) {
  if (isCoreFeature(key)) return;
  (editConfig.value.features as any)[key] = !(editConfig.value.features as any)[key];
}

// ---- 省电策略 ----
function textTime() {
  return new Date().toLocaleTimeString();
}

// ---- 模拟电量 ----
function sendSimulateBattery(level: number | null) {
  sendWs({ type: "power_policy_simulate", data: { level } });
  robotStore.addCmdLog({
    time: textTime(),
    direction: "send",
    type: "config",
    data: level !== null ? `模拟电量 → ${level}%` : "恢复真实电量",
  });
}

function handleSimulate() {
  isSimulating.value = true;
  sendSimulateBattery(simulateBatteryLevel.value);
}

function handleClearSimulation() {
  isSimulating.value = false;
  sendSimulateBattery(null);
}

// ---- 摄像头名称 ----
function getCameraName(index: number): string {
  return editConfig.value.camera?.camera_names?.[index] || `摄像头 ${index}`;
}
function setCameraName(index: number, name: string) {
  if (!editConfig.value.camera.camera_names) {
    editConfig.value.camera.camera_names = {};
  }
  editConfig.value.camera.camera_names[index] = name;
}
</script>

<template>
  <div class="view active">
    <h2>⚙️ 机器人配置</h2>

    <!-- 二级导航 -->
    <div class="config-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="config-tab"
        :class="{ active: activeTab === tab.id }"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ==================== 功能列表 ==================== -->
    <div v-show="activeTab === 'features'" class="config-panel">
      <div class="config-section">
        <h3>🔧 支持的功能列表</h3>
        <p class="section-desc">开启或关闭机器人各项功能，关闭后对应面板入口将自动隐藏。</p>
        <div class="features-grid">
          <div
            v-for="(label, key) in FEATURE_LABELS"
            :key="key"
            class="feature-item"
            :class="{ disabled: !(editConfig.features as any)[key] }"
          >
            <div class="feature-info">
              <span class="feature-name">{{ label }}</span>
              <span class="feature-key">{{ key }}</span>
            </div>
            <label class="toggle-switch" :class="{ locked: isCoreFeature(key) }">
              <input
                type="checkbox"
                :checked="(editConfig.features as any)[key]"
                :disabled="isCoreFeature(key)"
                @change="toggleFeature(key)"
              />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 运动方式 ==================== -->
    <div v-show="activeTab === 'motion'" class="config-panel">
      <div class="config-section">
        <h3>🚗 运动驱动配置</h3>
        <div class="config-item">
          <div class="config-item-header"><label>驱动类型</label></div>
          <p class="config-item-desc">选择机器人运动驱动方式，未实现的类型标记为"待开发"。</p>
          <select v-model="editConfig.motion.drive_type" class="config-select">
            <option v-for="opt in DRIVE_TYPE_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}{{ opt.available ? "" : " (待开发)" }}
            </option>
          </select>
        </div>
        <div class="config-item">
          <div class="config-item-header">
            <label>最大线速度</label>
            <span class="config-item-value">{{ editConfig.motion.max_linear_speed }} m/s</span>
          </div>
          <p class="config-item-desc">机器人直线运动的最大速度，范围 0.1 - 10.0 m/s</p>
          <div class="slider-row">
            <input v-model.number="editConfig.motion.max_linear_speed" type="range" min="0.1" max="10" step="0.1" />
            <input
              v-model.number="editConfig.motion.max_linear_speed"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              class="num-input"
            />
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header">
            <label>最大角速度</label>
            <span class="config-item-value">{{ editConfig.motion.max_angular_speed }} rad/s</span>
          </div>
          <p class="config-item-desc">机器人旋转运动的最大速度，范围 0.1 - 10.0 rad/s</p>
          <div class="slider-row">
            <input v-model.number="editConfig.motion.max_angular_speed" type="range" min="0.1" max="10" step="0.1" />
            <input
              v-model.number="editConfig.motion.max_angular_speed"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              class="num-input"
            />
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>默认控制模式</label></div>
          <select v-model="editConfig.motion.default_mode" class="config-select">
            <option value="manual">手动模式</option>
            <option value="semi">半自动模式</option>
            <option value="auto">自动模式</option>
          </select>
        </div>
      </div>
    </div>

    <!-- ==================== 摄像头 ==================== -->
    <div v-show="activeTab === 'camera'" class="config-panel">
      <div class="config-section">
        <h3>📷 摄像头配置</h3>
        <div class="config-item">
          <div class="config-item-header">
            <label>启用摄像头</label>
            <label class="toggle-switch">
              <input v-model="editConfig.camera.enabled" type="checkbox" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>默认主摄像头</label></div>
          <p class="config-item-desc">选择默认使用的主摄像头。</p>
          <select v-model.number="editConfig.camera.default_camera" class="config-select">
            <option :value="0">{{ getCameraName(0) }}</option>
            <option :value="1">{{ getCameraName(1) }}</option>
          </select>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>摄像头重命名</label></div>
          <div class="rename-row">
            <label class="rename-label">摄像头 0:</label>
            <input
              :value="getCameraName(0)"
              class="config-input"
              placeholder="前方摄像头"
              @input="setCameraName(0, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="rename-row">
            <label class="rename-label">摄像头 1:</label>
            <input
              :value="getCameraName(1)"
              class="config-input"
              placeholder="后方摄像头"
              @input="setCameraName(1, ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>云台绑定</label></div>
          <p class="config-item-desc">摄像头图像是否跟随云台转动。</p>
          <div class="toggle-row">
            <span>水平绑定（Pan）</span
            ><label class="toggle-switch"
              ><input v-model="editConfig.camera.gimbal_pan_bind" type="checkbox" /><span class="toggle-slider"></span
            ></label>
          </div>
          <div class="toggle-row">
            <span>俯仰绑定（Tilt）</span
            ><label class="toggle-switch"
              ><input v-model="editConfig.camera.gimbal_tilt_bind" type="checkbox" /><span class="toggle-slider"></span
            ></label>
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>画面方向反转</label></div>
          <p class="config-item-desc">画面镜像翻转配置。</p>
          <div class="toggle-row">
            <span>水平翻转（镜像）</span
            ><label class="toggle-switch"
              ><input v-model="editConfig.camera.flip_horizontal" type="checkbox" /><span class="toggle-slider"></span
            ></label>
          </div>
          <div class="toggle-row">
            <span>垂直翻转（倒置）</span
            ><label class="toggle-switch"
              ><input v-model="editConfig.camera.flip_vertical" type="checkbox" /><span class="toggle-slider"></span
            ></label>
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header">
            <label>分辨率</label>
            <span class="config-item-value"
              >{{ editConfig.camera.resolution.width }} × {{ editConfig.camera.resolution.height }}</span
            >
          </div>
          <div class="res-row">
            <div class="res-field">
              <label>宽度</label
              ><input
                v-model.number="editConfig.camera.resolution.width"
                type="number"
                min="160"
                max="3840"
                step="16"
                class="num-input"
              />
            </div>
            <div class="res-field">
              <label>高度</label
              ><input
                v-model.number="editConfig.camera.resolution.height"
                type="number"
                min="120"
                max="2160"
                step="16"
                class="num-input"
              />
            </div>
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header">
            <label>帧率</label>
            <span class="config-item-value">{{ editConfig.camera.fps }} FPS</span>
          </div>
          <div class="slider-row">
            <input v-model.number="editConfig.camera.fps" type="range" min="1" max="120" step="1" />
            <input v-model.number="editConfig.camera.fps" type="number" min="1" max="120" class="num-input" />
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>视频流类型</label></div>
          <select v-model="editConfig.camera.stream_type" class="config-select">
            <option value="mjpeg">MJPEG</option>
            <option value="webrtc">WebRTC</option>
          </select>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>拍照画质</label></div>
          <p class="config-item-desc">拍摄照片时的画面质量。高画质占用更多带宽。</p>
          <select v-model="editConfig.camera.capture_quality" class="config-select">
            <option value="high">高画质</option>
            <option value="medium">中画质</option>
            <option value="low">低画质</option>
          </select>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>录制画质</label></div>
          <p class="config-item-desc">录制视频时的画面质量。高画质文件更大。</p>
          <select v-model="editConfig.camera.record_quality" class="config-select">
            <option value="high">高画质</option>
            <option value="medium">中画质</option>
            <option value="low">低画质</option>
          </select>
        </div>

        <!-- 云台配置（摄像头面板内） -->
        <div style="margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border)">
          <h3>🎯 云台配置</h3>
          <div class="config-item">
            <div class="config-item-header">
              <label>启用云台</label>
              <label class="toggle-switch"
                ><input v-model="editConfig.gimbal.enabled" type="checkbox" /><span class="toggle-slider"></span
              ></label>
            </div>
          </div>
          <div v-if="editConfig.gimbal.enabled" class="config-item">
            <div class="config-item-header"><label>云台类型</label></div>
            <input v-model="editConfig.gimbal.gimbal_type" class="config-input" />
          </div>
          <div v-if="editConfig.gimbal.enabled" class="config-item">
            <div class="config-item-header"><label>方向反转</label></div>
            <div class="toggle-row">
              <span>水平反转（Pan Invert）</span
              ><label class="toggle-switch"
                ><input v-model="editConfig.gimbal.pan_invert" type="checkbox" /><span class="toggle-slider"></span
              ></label>
            </div>
            <div class="toggle-row">
              <span>垂直反转（Tilt Invert）</span
              ><label class="toggle-switch"
                ><input v-model="editConfig.gimbal.tilt_invert" type="checkbox" /><span class="toggle-slider"></span
              ></label>
            </div>
          </div>
          <div v-if="editConfig.gimbal.enabled" class="config-item">
            <div class="config-item-header">
              <label>步进角度</label>
              <span class="config-item-value">{{ editConfig.gimbal.step }}°</span>
            </div>
            <div class="slider-row">
              <input v-model.number="editConfig.gimbal.step" type="range" min="0.1" max="30" step="0.1" />
              <input
                v-model.number="editConfig.gimbal.step"
                type="number"
                min="0.1"
                max="30"
                step="0.1"
                class="num-input"
              />
            </div>
          </div>
        </div>

        <p class="camera-tip">💡 如果检测不到所需摄像头，请检查是否已正确连接并安装相应驱动</p>
      </div>
    </div>

    <!-- ==================== 网络 ==================== -->
    <div v-show="activeTab === 'network'" class="config-panel">
      <div class="config-section">
        <h3>🌐 网络配置</h3>
        <div class="config-item">
          <div class="config-item-header"><label>对外公告 IP</label></div>
          <p class="config-item-desc">
            设置机器人在内网的固定 IP 地址，用于 WebRTC SDP 和客户端直连。修改后需重启服务才能生效。
          </p>
          <input v-model="editConfig.server.advertised_ip" class="config-input" placeholder="例如: 192.168.1.100" />
          <p
            v-if="editConfig.server.advertised_ip !== (robotStore.robotConfig?.server?.advertised_ip ?? '')"
            class="reboot-warning"
          >
            ⚠️ 修改此配置需要重启服务才能生效
          </p>
        </div>
        <div class="config-item">
          <div class="config-item-header"><label>WebSocket 端口</label></div>
          <p class="config-item-desc">WebSocket 信令服务器端口。修改后需重启服务才能生效。</p>
          <input v-model.number="editConfig.server.port" type="number" min="1" max="65535" class="num-input" />
          <p v-if="editConfig.server.port !== (robotStore.robotConfig?.server?.port ?? 8765)" class="reboot-warning">
            ⚠️ 修改此配置需要重启服务才能生效
          </p>
        </div>
      </div>
    </div>

    <!-- ==================== 省电配置 ==================== -->
    <div v-show="activeTab === 'power'" class="config-panel">
      <div class="config-section">
        <h3>🔋 省电策略配置</h3>
        <div class="config-item">
          <div class="config-item-header">
            <label>省电阀值</label>
            <span class="config-item-value">{{ editConfig.power_policy.threshold }}%</span>
            <span v-if="robotStore.powerPolicy.mode === 'eco'" class="eco-badge">当前省电中</span>
          </div>
          <p class="config-item-desc">当电量低于此阀值时，自动进入省电模式（限制跳舞、限制音量等）。范围 10% - 50%。</p>
          <div class="threshold-slider">
            <input v-model.number="editConfig.power_policy.threshold" type="range" min="10" max="50" step="5" />
            <div class="threshold-labels"><span>10%</span><span>30%</span><span>50%</span></div>
          </div>
        </div>
        <div class="config-item">
          <div class="config-item-header">
            <label>当前省电模式</label>
            <span class="mode-badge" :class="robotStore.powerPolicy.mode">
              {{ robotStore.powerPolicy.mode === "eco" ? "⚡ 省电模式" : "✅ 正常模式" }}
            </span>
          </div>
          <p v-if="robotStore.powerPolicy.mode === 'eco'" class="config-item-desc">
            省电模式下，跳舞功能不可用，音乐音量限制为 50% 以下。
          </p>
          <p v-if="robotStore.powerPolicy.manual_override" class="config-item-desc">
            已触发手动豁免，本次会话不再自动进入省电模式。
          </p>
        </div>
        <p class="section-desc" style="margin-top: 12px">💡 修改阀值后，点击底部「应用配置」按钮即可保存。</p>
      </div>
    </div>

    <!-- ==================== 软件管理 ==================== -->
    <div v-show="activeTab === 'software'" class="config-panel">
      <div class="config-section">
        <h3>📦 软件管理配置</h3>

        <div class="config-item">
          <div class="config-item-header"><label>市场源地址</label></div>
          <p class="config-item-desc">
            设置软件包市场源的 URL 地址（不含末尾斜杠）。修改后需重启 software_manager 子进程或整个服务才能生效。
          </p>
          <div class="endpoint-row">
            <input
              v-model="editConfig.software_manager.market_endpoint"
              class="config-input endpoint-input"
              placeholder="http://market.wo-bot.com:9099"
            />
            <button
              class="btn-reset-endpoint"
              @click="editConfig.software_manager.market_endpoint = 'market.wo-bot.com'"
              :disabled="editConfig.software_manager.market_endpoint === 'market.wo-bot.com'"
            >
              ↩ 重置为默认值
            </button>
          </div>
          <p v-if="editConfig.software_manager.market_endpoint === 'market.wo-bot.com'" class="default-hint">
            ✓ 当前使用默认市场源
          </p>
          <p
            v-if="
              editConfig.software_manager.market_endpoint !==
              (robotStore.robotConfig?.software_manager?.market_endpoint ?? 'market.wo-bot.com')
            "
            class="reboot-warning"
          >
            ⚠️ 修改市场源地址需要重启 software_manager 子进程才能生效（应用配置后自动重启）
          </p>
        </div>

        <div class="config-item">
          <div class="config-item-header">
            <label>白名单缓存时长</label>
            <span class="config-item-value">{{ editConfig.software_manager.manifest_cache_ttl }} 秒</span>
          </div>
          <p class="config-item-desc">
            Manifest 白名单的本地缓存时长。设置过小会频繁向市场服务器请求，设置过大可能导致无法及时发现可用更新。
          </p>
          <div class="slider-row">
            <input
              v-model.number="editConfig.software_manager.manifest_cache_ttl"
              type="range"
              min="60"
              max="3600"
              step="60"
            />
            <input
              v-model.number="editConfig.software_manager.manifest_cache_ttl"
              type="number"
              min="60"
              max="3600"
              step="60"
              class="num-input"
            />
          </div>
        </div>

        <div class="config-item">
          <div class="config-item-header">
            <label>操作超时时间</label>
            <span class="config-item-value">{{ editConfig.software_manager.operation_timeout }} 秒</span>
          </div>
          <p class="config-item-desc">安装/卸载/升级等 dpkg 操作的超时时间。网络较慢或有大型软件包时建议调大。</p>
          <div class="slider-row">
            <input
              v-model.number="editConfig.software_manager.operation_timeout"
              type="range"
              min="30"
              max="600"
              step="30"
            />
            <input
              v-model.number="editConfig.software_manager.operation_timeout"
              type="number"
              min="30"
              max="600"
              step="30"
              class="num-input"
            />
          </div>
        </div>

        <p class="section-desc" style="margin-top: 12px">
          💡 默认市场源地址为 <code>market.wo-bot.com</code>，实际访问时会自动拼接头部和路径（如
          <code>http://market.wo-bot.com:9099/api/manifest</code>）。
        </p>
      </div>
    </div>

    <!-- ==================== JSON 编辑器 ==================== -->
    <div v-show="activeTab === 'json_editor'" class="config-panel">
      <div class="config-section">
        <h3>{ } JSON 配置编辑器</h3>
        <p class="section-desc">直接编辑配置 JSON。修改后点击"应用JSON"回填到表单，或点击底部"应用配置"直接保存。</p>
        <div class="json-toolbar">
          <button class="btn-json-action" @click="syncToJson">🔄 从表单同步</button>
          <button class="btn-json-action" @click="formatJson">✨ 格式化</button>
          <button class="btn-json-action btn-json-primary" @click="handleApplyJson">📋 应用 JSON</button>
        </div>
        <textarea
          v-model="jsonText"
          class="json-editor"
          :class="{ error: !!jsonError }"
          spellcheck="false"
          placeholder="在此编辑 JSON 配置..."
        ></textarea>
        <p v-if="jsonError" class="json-error-msg">{{ jsonError }}</p>
      </div>
    </div>

    <!-- ==================== 调试面板 ==================== -->
    <div v-show="activeTab === 'debug'" class="config-panel">
      <div class="config-section">
        <h3>🧪 调试工具</h3>
        <div class="debug-section">
          <h4>模拟低电量测试</h4>
          <p class="config-item-desc">
            设置一个低于省电阀值的模拟电量，可立即测试自动进入省电模式。模拟期间不影响真实电量采集。
          </p>
          <div class="simulate-row">
            <input
              v-model.number="simulateBatteryLevel"
              type="range"
              min="5"
              max="95"
              step="1"
              class="simulate-slider"
            />
            <span class="simulate-value">{{ simulateBatteryLevel }}%</span>
          </div>
          <div class="simulate-actions">
            <button class="btn-simulate" @click="handleSimulate">
              {{ isSimulating ? "🔄 更新模拟值" : "🧪 模拟此电量" }}
            </button>
            <button v-if="isSimulating" class="btn-clear-sim" @click="handleClearSimulation">↩️ 恢复真实电量</button>
          </div>
          <p v-if="isSimulating" class="simulate-active-tip">
            ⚠️ 当前为模拟电量 {{ simulateBatteryLevel }}%，真实电量采集不受影响。
          </p>
        </div>
      </div>
    </div>

    <!-- ==================== 绑定配置 ==================== -->
    <div v-show="activeTab === 'clients'" class="config-panel">
      <ClientManagementView :edit-config="editConfig" />
    </div>

    <!-- ==================== 底部应用配置按钮（固定在底部） ==================== -->
    <div class="apply-bar">
      <button class="btn-apply" :disabled="isApplying || !hasConfigChanged()" @click="handleApplyConfig">
        {{ isApplying ? "应用中..." : "💾 应用配置" }}
      </button>
      <span v-if="!hasConfigChanged() && robotStore.configLoaded && !isApplying" class="no-change-hint"
        >✓ 配置未变更</span
      >
    </div>
  </div>
</template>

<style scoped>
.view {
  display: none;
}
.view.active {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
h2 {
  margin-bottom: 16px;
  font-size: 22px;
}

.config-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0;
  flex-wrap: wrap;
}
.config-tab {
  padding: 8px 12px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  white-space: nowrap;
}
.config-tab:hover {
  color: var(--text-primary);
}
.config-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.config-panel {
  flex: 1;
  overflow-y: auto;
}
.config-section {
  max-width: 620px;
}
.config-section h3 {
  font-size: 16px;
  margin-bottom: 8px;
}
.section-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 16px;
}

.config-item {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 12px;
}
.config-item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.config-item-header label {
  font-weight: 600;
  font-size: 14px;
}
.config-item-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
}
.eco-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(255, 193, 7, 0.2);
  color: #ffc107;
}
.mode-badge {
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 10px;
}
.mode-badge.normal {
  background: rgba(0, 255, 136, 0.15);
  color: var(--success);
}
.mode-badge.eco {
  background: rgba(255, 193, 7, 0.15);
  color: #ffc107;
}
.config-item-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 8px;
}

.features-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.feature-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: opacity 0.2s;
}
.feature-item.disabled {
  opacity: 0.5;
}
.feature-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.feature-name {
  font-size: 14px;
  font-weight: 500;
}
.feature-key {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-tertiary);
  border-radius: 24px;
  transition: 0.3s;
  border: 1px solid var(--border);
}
.toggle-slider:before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: var(--text-secondary);
  border-radius: 50%;
  transition: 0.3s;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent);
  border-color: var(--accent);
}
.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
  background: #000;
}
.toggle-switch.locked {
  opacity: 0.4;
  pointer-events: none;
}

.config-select {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
}
.config-select:focus {
  outline: none;
  border-color: var(--accent);
}
.config-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  box-sizing: border-box;
}
.config-input:focus {
  outline: none;
  border-color: var(--accent);
}
.slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.slider-row input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
}
.num-input {
  width: 80px;
  padding: 6px 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
  text-align: center;
}
.num-input:focus {
  outline: none;
  border-color: var(--accent);
}
.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  font-size: 13px;
}
.rename-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}
.rename-label {
  font-size: 13px;
  color: var(--text-muted);
  min-width: 70px;
}
.res-row {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}
.res-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.res-field label {
  font-size: 12px;
  color: var(--text-muted);
}
.res-field .num-input {
  width: 100px;
}
.camera-tip {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}
.reboot-warning {
  margin-top: 8px;
  font-size: 12px;
  color: #ffc107;
}

.json-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.btn-json-action {
  padding: 6px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-json-action:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}
.btn-json-primary {
  background: var(--accent);
  color: #000;
  border-color: var(--accent);
  font-weight: 600;
}
.btn-json-primary:hover {
  opacity: 0.85;
  color: #000;
}
.json-editor {
  width: 100%;
  min-height: 400px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  tab-size: 2;
  box-sizing: border-box;
}
.json-editor:focus {
  outline: none;
  border-color: var(--accent);
}
.json-editor.error {
  border-color: var(--danger);
}
.json-error-msg {
  font-size: 12px;
  color: var(--danger);
  font-family: monospace;
  margin-top: 4px;
}

.apply-bar {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  margin-top: auto;
  z-index: 10;
}
.btn-apply {
  padding: 10px 28px;
  background: var(--accent);
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-apply:hover:not(:disabled) {
  opacity: 0.85;
}
.btn-apply:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.no-change-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.threshold-slider {
  margin-top: 12px;
}
.threshold-slider input[type="range"] {
  width: 100%;
  accent-color: var(--accent);
}
.threshold-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.btn-save {
  padding: 10px 24px;
  background: var(--accent);
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-save:hover:not(:disabled) {
  opacity: 0.85;
}
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.debug-section {
  padding: 16px;
  background: var(--bg-card);
  border: 1px dashed rgba(255, 193, 7, 0.4);
  border-radius: var(--radius-md);
}
.debug-section h4 {
  margin: 0 0 4px 0;
  font-size: 14px;
}
.simulate-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.simulate-slider {
  flex: 1;
  accent-color: #ffc107;
}
.simulate-value {
  font-size: 18px;
  font-weight: 700;
  color: #ffc107;
  min-width: 44px;
  text-align: right;
}
.simulate-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.btn-simulate {
  padding: 8px 18px;
  background: #ffc107;
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-simulate:hover:not(:disabled) {
  opacity: 0.8;
}
.btn-simulate:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-clear-sim {
  padding: 8px 18px;
  background: none;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.btn-clear-sim:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.simulate-active-tip {
  margin-top: 10px;
  font-size: 12px;
  color: #ffc107;
}

.endpoint-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 8px;
}
.endpoint-input {
  flex: 1;
}
.btn-reset-endpoint {
  padding: 8px 16px;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}
.btn-reset-endpoint:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.btn-reset-endpoint:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.default-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--success);
}
</style>
