<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuth } from "@/composables/useAuth";
import { getDevices, unbindDevice, renameDevice, type CloudDevice } from "@/services/account";

const { isAuthenticated, login } = useAuth();

const devices = ref<CloudDevice[]>([]);
const loading = ref(true);
const errorMsg = ref<string | null>(null);

// 重命名
const renamingRobotId = ref<string | null>(null);
const newName = ref("");

// 解绑确认
const unbindingRobot = ref<CloudDevice | null>(null);

async function loadDevices() {
  loading.value = true;
  errorMsg.value = null;
  try {
    devices.value = await getDevices();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "加载设备列表失败";
  } finally {
    loading.value = false;
  }
}

function startRename(device: CloudDevice) {
  renamingRobotId.value = device.robotId;
  newName.value = device.robotName || "";
}

async function confirmRename() {
  if (!renamingRobotId.value) return;
  try {
    await renameDevice(renamingRobotId.value, newName.value);
    const idx = devices.value.findIndex((d) => d.robotId === renamingRobotId.value);
    if (idx >= 0) devices.value[idx].robotName = newName.value;
    renamingRobotId.value = null;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "重命名失败";
  }
}

function cancelRename() {
  renamingRobotId.value = null;
  newName.value = "";
}

async function confirmUnbind() {
  if (!unbindingRobot.value) return;
  try {
    await unbindDevice(unbindingRobot.value.robotId);
    devices.value = devices.value.filter((d) => d.robotId !== unbindingRobot.value?.robotId);
    unbindingRobot.value = null;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "解绑失败";
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}

onMounted(() => {
  if (isAuthenticated.value) {
    loadDevices();
  } else {
    loading.value = false;
  }
});
</script>

<template>
  <div class="view cloud-devices-view">
    <h2>☁️ 我的设备</h2>

    <!-- 未登录 -->
    <div v-if="!isAuthenticated" class="not-logged-in">
      <p>请先登录以查看云端设备</p>
      <button class="btn btn-primary" @click="login">登录</button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="loading">
      <div class="spinner"></div>
      <p>加载设备列表...</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="errorMsg" class="error-msg">
      <p>❌ {{ errorMsg }}</p>
      <button class="btn" @click="loadDevices">重试</button>
    </div>

    <!-- 设备列表 -->
    <div v-else-if="devices.length > 0" class="device-list">
      <div v-for="device in devices" :key="device.robotId" class="device-card">
        <div class="device-info">
          <div class="device-header">
            <span v-if="renamingRobotId !== device.robotId" class="device-name">
              {{ device.robotName || "未命名设备" }}
            </span>
            <div v-else class="rename-input">
              <input v-model="newName" placeholder="设备名称" @keyup.enter="confirmRename" />
              <button class="btn btn-sm btn-primary" @click="confirmRename">确定</button>
              <button class="btn btn-sm" @click="cancelRename">取消</button>
            </div>
            <span class="device-status" :class="device.status">
              {{ device.status === "online" ? "🟢 在线" : "⚫ 离线" }}
            </span>
          </div>
          <div class="device-meta">
            <span>Robot ID: {{ device.robotId.substring(0, 16) }}...</span>
            <span>客户端: {{ device.clientId }}</span>
            <span>绑定时间: {{ formatTime(device.boundAt) }}</span>
            <span>最后在线: {{ formatTime(device.lastSeenAt) }}</span>
          </div>
        </div>
        <div class="device-actions">
          <button class="btn btn-sm" @click="startRename(device)">重命名</button>
          <button class="btn btn-sm btn-danger" @click="unbindingRobot = device">解绑</button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <p>📭 还没有绑定的设备</p>
      <p class="hint">在设备连接后，通过绑定流程将设备绑定到你的帐号</p>
    </div>

    <!-- 解绑确认弹窗 -->
    <div v-if="unbindingRobot" class="modal-overlay" @click.self="unbindingRobot = null">
      <div class="modal">
        <h3>确认解绑</h3>
        <p>确定要解绑设备「{{ unbindingRobot.robotName || unbindingRobot.robotId }}」吗？</p>
        <p class="hint">解绑后需要重新绑定才能远程连接此设备。</p>
        <div class="modal-actions">
          <button class="btn" @click="unbindingRobot = null">取消</button>
          <button class="btn btn-danger" @click="confirmUnbind">确认解绑</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cloud-devices-view {
  padding: 1rem;
}

.not-logged-in,
.loading,
.error-msg,
.empty-state {
  text-align: center;
  padding: 3rem 1rem;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color, #444);
  border-top-color: var(--accent-color, #4af);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.device-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  background: var(--bg-secondary, #1a1a1a);
}

.device-info {
  flex: 1;
}

.device-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.device-name {
  font-size: 1.1rem;
  font-weight: 500;
}

.device-status {
  font-size: 0.85rem;
  padding: 2px 8px;
  border-radius: 4px;
}

.device-status.online {
  background: rgba(76, 175, 80, 0.2);
}

.device-status.offline {
  opacity: 0.5;
}

.device-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.8rem;
  color: var(--text-secondary, #888);
}

.device-actions {
  display: flex;
  gap: 0.5rem;
}

.rename-input {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.rename-input input {
  padding: 4px 8px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: var(--bg-primary, #111);
  color: var(--text-primary, #eee);
  width: 180px;
}

.btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--border-color, #555);
  border-radius: 6px;
  background: var(--bg-secondary, #222);
  color: var(--text-primary, #eee);
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.2s;
}

.btn:hover {
  background: var(--bg-hover, #333);
}

.btn-sm {
  padding: 0.25rem 0.75rem;
  font-size: 0.8rem;
}

.btn-primary {
  background: var(--accent-color, #4af);
  border-color: var(--accent-color, #4af);
  color: #fff;
}

.btn-danger {
  border-color: #e44;
  color: #e44;
}

.btn-danger:hover {
  background: rgba(238, 68, 68, 0.15);
}

.hint {
  color: var(--text-secondary, #888);
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-color, #333);
  border-radius: 12px;
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
}

.modal h3 {
  margin-bottom: 0.75rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
</style>
