<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import {
  useWebSocket,
  getClientId,
  setOnBindShareCreated,
  getConnectedEndpoint,
} from "@/composables/useWebSocket";
import { useRobotStore } from "@/stores/robot";
import { useDevicesStore } from "@/stores/devices";
import { useAppStore } from "@/stores/app";

const robotStore = useRobotStore();
const devicesStore = useDevicesStore();
const appStore = useAppStore();
const { requestBindList, sendBindRemove, sendBindShareCreate } = useWebSocket();

const removeTarget = ref<string | null>(null);
const currentClientId = getClientId();

// ---- 分享绑定 ----
const shareCode = ref("");
const shareExpiresIn = ref(0);
const shareCountdown = ref(0); // 剩余秒数
let _countdownTimer: ReturnType<typeof setInterval> | null = null;
const shareCopied = ref(false);

const hasShareCode = computed(() => shareCode.value !== "" && shareCountdown.value > 0);

const shareLink = computed(() => {
  if (!hasShareCode.value) return "";
  const { ip, port } = getConnectedEndpoint();
  if (!ip || !port) return "";
  const robotId = devicesStore.robotInfo?.robot_id || "";
  const robotIdParam = robotId ? `&robotId=${encodeURIComponent(robotId)}` : "";
  return `${window.location.origin}/?robotIp=${encodeURIComponent(ip)}&robotPort=${port}${robotIdParam}&shareCode=${encodeURIComponent(shareCode.value)}`;
});

function handleCreateShare() {
  shareCode.value = "";
  shareCountdown.value = 0;
  sendBindShareCreate();
}

// 注册分享码生成回调
setOnBindShareCreated((code, expiresIn) => {
  shareCode.value = code;
  shareExpiresIn.value = expiresIn;
  shareCountdown.value = expiresIn;
  shareCopied.value = false;
  startCountdown();
});

function startCountdown() {
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(() => {
    shareCountdown.value -= 1;
    if (shareCountdown.value <= 0) {
      shareCountdown.value = 0;
      shareCode.value = "";
      if (_countdownTimer) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
      }
    }
  }, 1000);
}

function copyShareCode() {
  if (!shareCode.value) return;
  navigator.clipboard.writeText(shareCode.value).then(() => {
    appStore.showToast("分享码已复制", "success");
  });
}

function copyShareLink() {
  if (!shareLink.value) return;
  navigator.clipboard.writeText(shareLink.value).then(() => {
    shareCopied.value = true;
    appStore.showToast("分享链接已复制", "success");
  });
}

function formatCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function handleRemove(clientId: string) {
  removeTarget.value = clientId;
}

function confirmRemove() {
  if (removeTarget.value) {
    sendBindRemove(removeTarget.value);
    removeTarget.value = null;
  }
}

function cancelRemove() {
  removeTarget.value = null;
}

onMounted(() => {
  requestBindList();
});

onUnmounted(() => {
  setOnBindShareCreated(null);
  if (_countdownTimer) {
    clearInterval(_countdownTimer);
    _countdownTimer = null;
  }
});
</script>

<template>
  <div class="client-mgmt-view">
    <div class="view-header">
      <h3>🔗 客户端管理</h3>
      <button class="btn-refresh" @click="requestBindList" title="刷新列表">🔄</button>
    </div>

    <!-- 分享绑定 -->
    <div class="share-section">
      <div class="share-header">
        <span class="share-title">📤 分享绑定</span>
        <button class="btn-share" @click="handleCreateShare" :disabled="!!shareCode && shareCountdown > 0">
          {{ hasShareCode ? '生成中...' : '生成分享码' }}
        </button>
      </div>

      <div v-if="hasShareCode" class="share-result">
        <div class="share-code-box">
          <span class="share-code-label">分享码</span>
          <span class="share-code-value">{{ shareCode }}</span>
          <span class="share-countdown">{{ formatCountdown(shareCountdown) }}</span>
          <button class="btn-copy-sm" @click="copyShareCode" title="复制分享码">📋</button>
        </div>
        <div class="share-link-box">
          <span class="share-link-label">分享链接</span>
          <input class="share-link-input" :value="shareLink" readonly @click="($event.target as HTMLInputElement).select()" />
          <button class="btn-copy-link" @click="copyShareLink">
            {{ shareCopied ? '✓ 已复制' : '复制链接' }}
          </button>
        </div>
        <p class="share-hint">将链接发送给其他设备，打开后可自动连接并绑定（2分钟内有效）</p>
      </div>
    </div>

    <div v-if="robotStore.bindings.length === 0" class="empty-list">
      <div class="empty-icon">📱</div>
      <p>暂无已绑定的客户端</p>
    </div>

    <div v-else class="bindings-list">
      <div
        v-for="binding in robotStore.bindings"
        :key="binding.clientId"
        class="binding-card"
        :class="{ 'is-self': binding.clientId === currentClientId }"
      >
        <div class="binding-info">
          <div class="binding-name">{{ binding.clientName }}</div>
          <div class="binding-meta">
            <span class="meta-item">ID: {{ binding.clientId.slice(0, 16) }}...</span>
            <span class="meta-item">绑定: {{ formatDate(binding.boundAt) }}</span>
            <span class="meta-item">最近: {{ formatDate(binding.lastSeen) }}</span>
          </div>
          <span v-if="binding.clientId === currentClientId" class="self-badge">当前设备</span>
        </div>
        <button
          v-if="binding.clientId !== currentClientId"
          class="btn-remove"
          @click="handleRemove(binding.clientId)"
        >
          移除
        </button>
      </div>
    </div>

    <!-- 移除单个确认 -->
    <div v-if="removeTarget" class="confirm-overlay" @click.self="cancelRemove">
      <div class="confirm-dialog">
        <h3>确认移除</h3>
        <p>确定要移除此客户端的绑定吗？移除后该设备需要重新绑定才能使用。</p>
        <div class="confirm-actions">
          <button class="btn-cancel" @click="cancelRemove">取消</button>
          <button class="btn-danger" @click="confirmRemove">移除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.client-mgmt-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h3 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.btn-refresh {
  padding: 4px 10px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* 分享绑定 */
.share-section {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.share-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.share-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.btn-share {
  padding: 6px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-share:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-share:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.share-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.share-code-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.share-code-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.share-code-value {
  flex: 1;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--accent);
}

.share-countdown {
  font-size: 12px;
  color: var(--danger);
  font-weight: 600;
  min-width: 36px;
  text-align: right;
}

.btn-copy-sm {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
}

.btn-copy-sm:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.share-link-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.share-link-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.share-link-input {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-link-input:focus {
  outline: none;
  border-color: var(--accent);
}

.btn-copy-link {
  padding: 4px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-copy-link:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.share-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.4;
}

.bindings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.binding-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.binding-card.is-self {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.binding-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.binding-name {
  font-size: 15px;
  font-weight: 600;
}

.binding-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.meta-item {
  white-space: nowrap;
}

.self-badge {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 11px;
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-sm);
  width: fit-content;
}

.btn-remove {
  padding: 6px 16px;
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  cursor: pointer;
}

.btn-remove:hover {
  border-color: var(--danger);
  color: var(--danger);
}

/* 确认弹窗 */
.confirm-overlay {
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

.confirm-dialog {
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 400px;
  width: 90%;
}

.confirm-dialog h3 {
  margin: 0 0 12px;
  font-size: 18px;
}

.confirm-dialog p {
  margin: 0 0 20px;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 8px 20px;
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
}

.btn-danger {
  padding: 8px 20px;
  background: var(--danger);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
}
</style>
