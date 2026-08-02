<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useWebSocket } from "@/composables/useWebSocket";
import { useIRRemote, type IRDevice } from "@/composables/useIRRemote";

const { send } = useWebSocket();
const {
  devices,
  currentDevice,
  learnState,
  loading,
  learnedButton,
  learnCountdown,
  sendStatusMap,
  loadDevices,
  addDevice,
  deleteDevice,
  startLearn,
  cancelLearn,
  renameButton,
  deleteButton,
  sendIR,
  exportCodes,
  importCodes,
  selectDevice,
  resetLearnState,
} = useIRRemote(send);

/* ---- 品类图标映射 ---- */
const categoryIcons: Record<string, string> = {
  fan: "🌀",
  air_conditioner: "❄️",
  tv: "📺",
  set_top_box: "📡",
  light: "💡",
  other: "📟",
};

const categoryLabels: Record<string, string> = {
  fan: "风扇",
  air_conditioner: "空调",
  tv: "电视",
  set_top_box: "机顶盒",
  light: "灯",
  other: "其他",
};

function categoryIcon(cat: string): string {
  return categoryIcons[cat] ?? "📟";
}

/* ---- 新增设备弹窗 ---- */
const showAddDevice = ref(false);
const newDeviceName = ref("");
const newDeviceBrand = ref("");
const newDeviceModel = ref("");
const newDeviceCategory = ref("other");

function openAddDevice() {
  newDeviceName.value = "";
  newDeviceBrand.value = "";
  newDeviceModel.value = "";
  newDeviceCategory.value = "other";
  showAddDevice.value = true;
}

function confirmAddDevice() {
  if (!newDeviceName.value.trim()) return;
  addDevice({
    name: newDeviceName.value.trim(),
    brand: newDeviceBrand.value.trim(),
    model: newDeviceModel.value.trim(),
    category: newDeviceCategory.value,
  });
  showAddDevice.value = false;
}

/* ---- 学习弹窗 ---- */
const showLearnModal = ref(false);

watch(learnState, (state) => {
  if (state === "learning") {
    showLearnModal.value = true;
  } else if (state === "success" || state === "timeout") {
    // 短暂延迟后关闭学习弹窗
    setTimeout(() => {
      showLearnModal.value = false;
    }, 600);
  }
});

function handleStartLearn() {
  if (!currentDevice.value) return;
  startLearn(currentDevice.value.device_id);
}

function handleCancelLearn() {
  cancelLearn();
  showLearnModal.value = false;
}

/* ---- 按键命名弹窗 ---- */
const showNameButton = ref(false);
const nameButtonValue = ref("");
const nameButtonType = ref("stateless");

watch(learnedButton, (btn) => {
  if (btn) {
    nameButtonValue.value = "";
    nameButtonType.value = "stateless";
    showNameButton.value = true;
  }
});

function confirmNameButton() {
  if (!learnedButton.value) return;
  const { device_id, button_id } = learnedButton.value;
  renameButton(device_id, button_id, nameButtonValue.value.trim() || `按键${learnedButton.value.index}`);
  // 如果类型为 toggle，通过 updateDevice 传递（或后续扩展）
  showNameButton.value = false;
  learnedButton.value = null;
  resetLearnState();
}

function cancelNameButton() {
  showNameButton.value = false;
  learnedButton.value = null;
  resetLearnState();
}

/* ---- 长按按键操作菜单 ---- */
const buttonMenu = ref<{ deviceId: string; buttonId: string; buttonName: string; x: number; y: number } | null>(null);
const showRenameInput = ref(false);
const renameInputValue = ref("");

let _longPressTimer: ReturnType<typeof setTimeout> | null = null;

function onButtonTouchStart(e: TouchEvent | MouseEvent, deviceId: string, buttonId: string, buttonName: string) {
  const x = "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
  const y = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
  _longPressTimer = setTimeout(() => {
    buttonMenu.value = { deviceId, buttonId, buttonName, x, y };
  }, 500);
}

function onButtonTouchEnd() {
  if (_longPressTimer) {
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  }
}

function closeButtonMenu() {
  buttonMenu.value = null;
  showRenameInput.value = false;
  renameInputValue.value = "";
}

function handleButtonRename() {
  if (!buttonMenu.value) return;
  renameInputValue.value = buttonMenu.value.buttonName;
  showRenameInput.value = true;
}

function confirmButtonRename() {
  if (!buttonMenu.value) return;
  renameButton(buttonMenu.value.deviceId, buttonMenu.value.buttonId, renameInputValue.value.trim());
  closeButtonMenu();
}

function handleButtonDelete() {
  if (!buttonMenu.value) return;
  deleteButton(buttonMenu.value.deviceId, buttonMenu.value.buttonId);
  closeButtonMenu();
}

/* ---- 设备删除确认 ---- */
const deleteConfirm = ref<IRDevice | null>(null);

function handleDeleteDevice(dev: IRDevice) {
  deleteConfirm.value = dev;
}

function confirmDeleteDevice() {
  if (!deleteConfirm.value) return;
  deleteDevice(deleteConfirm.value.device_id);
  deleteConfirm.value = null;
}

/* ---- 导入码库 ---- */
const fileInput = ref<HTMLInputElement | null>(null);

function handleImportClick() {
  fileInput.value?.click();
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target?.result as string);
      importCodes(data, "skip");
    } catch {
      console.error("[IRRemote] 导入文件解析失败");
    }
  };
  reader.readAsText(file);
  input.value = "";
}

/* ---- 按键发射 ---- */
function handleSendIR(buttonId: string) {
  if (!currentDevice.value) return;
  // 长按触发时不发射
  if (_longPressTimer) {
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
    return;
  }
  sendIR(currentDevice.value.device_id, buttonId);
}

/* ---- 生命周期 ---- */
onMounted(() => {
  loadDevices();
  document.addEventListener("click", closeButtonMenu);
});

onUnmounted(() => {
  document.removeEventListener("click", closeButtonMenu);
  cancelLearn();
});

// 选中设备时检查是否需要加载
watch(currentDevice, (dev) => {
  if (dev && dev.buttons.length === 0 && !loading.value) {
    // 可选：重新加载设备列表以获取最新按键
  }
});
</script>

<template>
  <div class="ir-remote-view">
    <!-- ---- 左侧面板：设备列表 ---- -->
    <aside class="device-panel">
      <div class="panel-header">
        <span class="panel-title">红外遥控</span>
        <button class="btn-add" @click="openAddDevice">+ 新增设备</button>
      </div>

      <div class="device-list scrollable">
        <div
          v-for="dev in devices"
          :key="dev.device_id"
          class="device-card"
          :class="{ active: currentDevice?.device_id === dev.device_id }"
          @click="selectDevice(dev)"
        >
          <div class="device-icon">{{ categoryIcon(dev.category) }}</div>
          <div class="device-info">
            <div class="device-name">{{ dev.name }}</div>
            <div class="device-meta">
              <span class="device-cat">{{ categoryLabels[dev.category] ?? dev.category }}</span>
              <span class="device-sep">·</span>
              <span>{{ dev.buttons.length }} 个按键</span>
            </div>
          </div>
          <div class="device-state" :class="{ on: dev.state === 'on' }">
            {{ dev.state === "on" ? "开" : "关" }}
          </div>
          <button
            class="btn-delete-device"
            title="删除设备"
            @click.stop="handleDeleteDevice(dev)"
          >
            ✕
          </button>
        </div>

        <div v-if="devices.length === 0 && !loading" class="empty-devices">
          <p>暂无红外设备</p>
          <p class="sub">点击上方按钮新增设备</p>
        </div>
        <div v-if="loading && devices.length === 0" class="loading-hint">加载中...</div>
      </div>
    </aside>

    <!-- ---- 右侧面板：按键管理 ---- -->
    <section class="button-panel">
      <!-- 空状态 -->
      <div v-if="!currentDevice" class="empty-state">
        <div class="empty-icon">📟</div>
        <div class="empty-text">请选择或新增设备</div>
      </div>

      <!-- 按键管理 -->
      <template v-else>
        <!-- 工具栏 -->
        <div class="toolbar">
          <div class="toolbar-left">
            <span class="toolbar-icon">{{ categoryIcon(currentDevice.category) }}</span>
            <span class="toolbar-name">{{ currentDevice.name }}</span>
            <span class="toolbar-state" :class="{ on: currentDevice.state === 'on' }">
              {{ currentDevice.state === "on" ? "开启" : "关闭" }}
            </span>
          </div>
          <div class="toolbar-right">
            <button class="btn-tool primary" @click="handleStartLearn">📡 学习新按键</button>
            <button class="btn-tool" @click="exportCodes(currentDevice.device_id)">📥 导出设备</button>
            <button class="btn-tool" @click="exportCodes()">📤 导出全部</button>
            <button class="btn-tool" @click="handleImportClick">📥 导入码库</button>
            <input
              ref="fileInput"
              type="file"
              accept=".json"
              style="display: none"
              @change="handleFileChange"
            />
          </div>
        </div>

        <!-- 按键网格 -->
        <div class="button-grid scrollable">
          <button
            v-for="btn in currentDevice.buttons"
            :key="btn.id"
            class="ir-button"
            :class="{
              success: sendStatusMap[btn.id] === 'success',
              fail: sendStatusMap[btn.id] === 'fail',
              toggle: btn.type === 'toggle',
            }"
            @click="handleSendIR(btn.id)"
            @touchstart="onButtonTouchStart($event, currentDevice.device_id, btn.id, btn.name)"
            @touchend="onButtonTouchEnd"
            @touchmove="onButtonTouchEnd"
            @mousedown="onButtonTouchStart($event, currentDevice.device_id, btn.id, btn.name)"
            @mouseup="onButtonTouchEnd"
            @mouseleave="onButtonTouchEnd"
          >
            <span class="ir-btn-name">{{ btn.name }}</span>
            <span v-if="btn.type === 'toggle'" class="ir-btn-badge">切换</span>
          </button>

          <div v-if="currentDevice.buttons.length === 0" class="empty-buttons">
            <p>暂无按键</p>
            <p class="sub">点击「学习新按键」开始添加</p>
          </div>
        </div>
      </template>
    </section>

    <!-- ---- 学习弹窗 ---- -->
    <Transition name="modal">
      <div v-if="showLearnModal" class="modal-overlay" @click.self="handleCancelLearn">
        <div class="modal-box learn-modal">
          <div class="learn-pulse" :class="{ timeout: learnState === 'timeout' }">
            <div class="pulse-ring"></div>
            <div class="pulse-ring delay"></div>
            <div class="pulse-core">{{ categoryIcon(currentDevice?.category ?? "other") }}</div>
          </div>
          <div class="learn-countdown" :class="{ timeout: learnState === 'timeout' }">
            {{ learnCountdown }}s
          </div>
          <div class="learn-text">
            {{ learnState === "timeout" ? "学习超时" : "请将遥控器对准红外模块，按下按键..." }}
          </div>
          <button class="btn-modal cancel" @click="handleCancelLearn">取消</button>
        </div>
      </div>
    </Transition>

    <!-- ---- 新增设备弹窗 ---- -->
    <Transition name="modal">
      <div v-if="showAddDevice" class="modal-overlay" @click.self="showAddDevice = false">
        <div class="modal-box">
          <div class="modal-title">新增红外设备</div>
          <div class="form-group">
            <label>设备名称 <span class="required">*</span></label>
            <input
              v-model="newDeviceName"
              type="text"
              class="form-input"
              placeholder="如：客厅空调"
              @keyup.enter="confirmAddDevice"
            />
          </div>
          <div class="form-group">
            <label>品牌</label>
            <input v-model="newDeviceBrand" type="text" class="form-input" placeholder="如：格力" />
          </div>
          <div class="form-group">
            <label>型号</label>
            <input v-model="newDeviceModel" type="text" class="form-input" placeholder="如：KFR-35GW" />
          </div>
          <div class="form-group">
            <label>品类</label>
            <select v-model="newDeviceCategory" class="form-input">
              <option value="fan">🌀 风扇</option>
              <option value="air_conditioner">❄️ 空调</option>
              <option value="tv">📺 电视</option>
              <option value="set_top_box">📡 机顶盒</option>
              <option value="light">💡 灯</option>
              <option value="other">📟 其他</option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn-modal cancel" @click="showAddDevice = false">取消</button>
            <button class="btn-modal confirm" :disabled="!newDeviceName.trim()" @click="confirmAddDevice">
              确认
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ---- 按键命名弹窗 ---- -->
    <Transition name="modal">
      <div v-if="showNameButton" class="modal-overlay" @click.self="cancelNameButton">
        <div class="modal-box">
          <div class="modal-title">命名新按键</div>
          <div class="form-group">
            <label>按键名称</label>
            <input
              v-model="nameButtonValue"
              type="text"
              class="form-input"
              placeholder="如：电源开关"
              @keyup.enter="confirmNameButton"
            />
          </div>
          <div class="form-group">
            <label>按键类型</label>
            <select v-model="nameButtonType" class="form-input">
              <option value="stateless">普通按键</option>
              <option value="toggle">toggle 切换键</option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn-modal cancel" @click="cancelNameButton">取消</button>
            <button class="btn-modal confirm" @click="confirmNameButton">确认</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ---- 长按操作菜单 ---- -->
    <div
      v-if="buttonMenu"
      class="button-menu"
      :style="{ left: buttonMenu.x + 'px', top: buttonMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="!showRenameInput">
        <button class="menu-item" @click="handleButtonRename">✏️ 重命名</button>
        <button class="menu-item danger" @click="handleButtonDelete">🗑️ 删除</button>
      </template>
      <template v-else>
        <input
          v-model="renameInputValue"
          type="text"
          class="menu-input"
          @keyup.enter="confirmButtonRename"
        />
        <div class="menu-actions">
          <button class="menu-btn confirm" @click="confirmButtonRename">确认</button>
          <button class="menu-btn cancel" @click="closeButtonMenu">取消</button>
        </div>
      </template>
    </div>

    <!-- ---- 删除设备确认弹窗 ---- -->
    <Transition name="modal">
      <div v-if="deleteConfirm" class="modal-overlay" @click.self="deleteConfirm = null">
        <div class="modal-box small">
          <div class="modal-title">确认删除</div>
          <div class="modal-body">
            确定要删除设备「{{ deleteConfirm.name }}」及其所有按键吗？此操作不可撤销。
          </div>
          <div class="modal-actions">
            <button class="btn-modal cancel" @click="deleteConfirm = null">取消</button>
            <button class="btn-modal danger" @click="confirmDeleteDevice">删除</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ir-remote-view {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 0;
  overflow: hidden;
}

/* ---- 左侧设备面板 ---- */
.device-panel {
  flex-shrink: 0;
  width: 280px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--bg-secondary);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.btn-add {
  padding: 4px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-add:hover {
  background: var(--accent);
  color: #fff;
}

.device-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.scrollable {
  min-height: 0;
}

.device-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  margin-bottom: 4px;
}

.device-card:hover {
  background: var(--bg-hover);
}

.device-card.active {
  background: rgba(0, 212, 255, 0.08);
  border-color: var(--accent);
}

.device-icon {
  font-size: 22px;
  flex-shrink: 0;
}

.device-info {
  flex: 1;
  min-width: 0;
}

.device-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.device-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.device-sep {
  opacity: 0.5;
}

.device-state {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  flex-shrink: 0;
}

.device-state.on {
  background: rgba(76, 175, 80, 0.15);
  color: var(--success);
}

.btn-delete-device {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  opacity: 0;
  transition: all 0.15s;
}

.device-card:hover .btn-delete-device {
  opacity: 1;
}

.btn-delete-device:hover {
  background: rgba(255, 71, 87, 0.15);
  color: var(--danger);
}

.empty-devices,
.empty-buttons,
.loading-hint {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px 0;
}

.empty-devices .sub,
.empty-buttons .sub {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 4px;
}

/* ---- 右侧按键面板 ---- */
.button-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 12px;
}

.empty-icon {
  font-size: 48px;
  opacity: 0.4;
}

.empty-text {
  font-size: 16px;
  font-weight: 500;
}

/* ---- 工具栏 ---- */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.toolbar-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.toolbar-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toolbar-state {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-muted);
  flex-shrink: 0;
}

.toolbar-state.on {
  background: rgba(76, 175, 80, 0.15);
  color: var(--success);
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-tool {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-tool:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}

.btn-tool.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn-tool.primary:hover {
  opacity: 0.85;
}

/* ---- 按键网格 ---- */
.button-grid {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
  align-content: start;
}

.ir-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 64px;
  padding: 12px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  overflow: hidden;
}

.ir-button:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.ir-button:active {
  transform: translateY(0);
}

.ir-button.success {
  border-color: var(--success);
  background: rgba(76, 175, 80, 0.12);
  animation: flash-green 0.6s ease;
}

.ir-button.fail {
  border-color: var(--danger);
  background: rgba(255, 71, 87, 0.12);
  animation: flash-red 0.6s ease;
}

@keyframes flash-green {
  0% {
    background: rgba(76, 175, 80, 0.4);
  }
  100% {
    background: rgba(76, 175, 80, 0.12);
  }
}

@keyframes flash-red {
  0% {
    background: rgba(255, 71, 87, 0.4);
  }
  100% {
    background: rgba(255, 71, 87, 0.12);
  }
}

.ir-btn-name {
  font-weight: 600;
  text-align: center;
  word-break: break-all;
}

.ir-btn-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #000;
  font-weight: 600;
}

.ir-button.toggle {
  border-style: dashed;
}

.empty-buttons {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 40px 0;
}

.empty-buttons .sub {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 4px;
}

/* ---- 模态弹窗 ---- */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 360px;
  max-width: 90vw;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.modal-box.small {
  min-width: 320px;
}

.modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.modal-body {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.required {
  color: var(--danger);
}

.form-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-input:focus {
  border-color: var(--accent);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.btn-modal {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border);
}

.btn-modal.cancel {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.btn-modal.cancel:hover {
  background: var(--bg-hover);
}

.btn-modal.confirm {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn-modal.confirm:hover {
  opacity: 0.85;
}

.btn-modal.confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-modal.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

.btn-modal.danger:hover {
  opacity: 0.85;
}

/* ---- 学习弹窗 ---- */
.learn-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  min-width: 320px;
}

.learn-pulse {
  position: relative;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.pulse-core {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  z-index: 2;
}

.pulse-ring {
  position: absolute;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid var(--accent);
  animation: pulse-ring 1.5s ease-out infinite;
}

.pulse-ring.delay {
  animation-delay: 0.5s;
}

@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 0.8;
  }
  100% {
    transform: scale(1.8);
    opacity: 0;
  }
}

.learn-pulse.timeout .pulse-core {
  background: var(--danger);
}

.learn-pulse.timeout .pulse-ring {
  border-color: var(--danger);
  animation: none;
  opacity: 0;
}

.learn-countdown {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 8px;
}

.learn-countdown.timeout {
  color: var(--danger);
}

.learn-text {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 20px;
  max-width: 260px;
  line-height: 1.5;
}

/* ---- 长按菜单 ---- */
.button-menu {
  position: fixed;
  z-index: 2000;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  padding: 4px;
  min-width: 140px;
  transform: translate(-50%, -100%);
}

.menu-item {
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-item.danger {
  color: var(--danger);
}

.menu-item.danger:hover {
  background: rgba(255, 71, 87, 0.1);
}

.menu-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 6px;
}

.menu-actions {
  display: flex;
  gap: 4px;
}

.menu-btn {
  flex: 1;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.menu-btn.confirm {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.menu-btn.cancel {
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

/* ---- 弹窗过渡动画 ---- */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

/* ---- 响应式 ---- */
@media (max-width: 640px) {
  .ir-remote-view {
    flex-direction: column;
  }

  .device-panel {
    width: 100%;
    max-height: 200px;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .button-grid {
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 8px;
  }

  .toolbar {
    padding: 8px 12px;
  }

  .toolbar-right {
    gap: 4px;
  }

  .btn-tool {
    padding: 4px 8px;
    font-size: 11px;
  }

  .modal-box {
    min-width: auto;
    width: 90vw;
    padding: 18px;
  }
}
</style>
