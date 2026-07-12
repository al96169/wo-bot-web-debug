<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import type { RobotConfig } from "@/types";
import { useWebSocket, getClientId, setOnBindShareCreated, getConnectedEndpoint } from "@/composables/useWebSocket";
import { useRobotStore } from "@/stores/robot";
import { useDevicesStore } from "@/stores/devices";
import { useAppStore } from "@/stores/app";

const props = defineProps<{
  editConfig: RobotConfig;
}>();

// 本地引用，避免模板中直接修改 props 触发 lint 规则
const config = props.editConfig;

const robotStore = useRobotStore();
const devicesStore = useDevicesStore();
const appStore = useAppStore();
const { requestBindList, sendBindRemove, sendBindShareCreate } = useWebSocket();

const METHOD_ICONS: Record<string, string> = {
  display: "🖥️",
  tts: "🔊",
  qr_scan: "📷",
  gimbal: "🎯",
  password: "🔑",
  share_code: "🔗",
};

const METHOD_LABELS: Record<string, string> = {
  display: "屏幕显示验证码",
  tts: "语音播报验证码",
  qr_scan: "二维码扫描",
  gimbal: "云台动作验证",
  password: "密码绑定",
  share_code: "分享码绑定",
};

const removeTarget = ref<string | null>(null);
const currentClientId = getClientId();

// ---- 分享绑定 ----
const shareCode = ref("");
const shareExpiresIn = ref(0);
const shareCountdown = ref(0);
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

// ---- 密码绑定（直接写入 editConfig，通过统一「应用配置」保存） ----
const showPasswordForm = ref(false);
const editPassword = ref("");
const confirmPassword = ref("");
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);

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
      <h3>🔗 绑定配置</h3>
      <button class="btn-refresh" title="刷新列表" @click="requestBindList">🔄</button>
    </div>

    <!-- 分享绑定 -->
    <div class="share-section">
      <div class="share-header">
        <span class="share-title">📤 分享绑定</span>
        <button class="btn-share" :disabled="!!shareCode && shareCountdown > 0" @click="handleCreateShare">
          {{ hasShareCode ? "生成中..." : "生成分享码" }}
        </button>
      </div>

      <div v-if="hasShareCode" class="share-result">
        <div class="share-code-box">
          <span class="share-code-label">分享码</span>
          <span class="share-code-value">{{ shareCode }}</span>
          <span class="share-countdown">{{ formatCountdown(shareCountdown) }}</span>
          <button class="btn-copy-sm" title="复制分享码" @click="copyShareCode">📋</button>
        </div>
        <div class="share-link-box">
          <span class="share-link-label">分享链接</span>
          <input
            class="share-link-input"
            :value="shareLink"
            readonly
            @click="($event.target as HTMLInputElement).select()"
          />
          <button class="btn-copy-link" @click="copyShareLink">
            {{ shareCopied ? "✓ 已复制" : "复制链接" }}
          </button>
        </div>
        <p class="share-hint">将链接发送给其他设备，打开后可自动连接并绑定（2分钟内有效）</p>
      </div>
    </div>

    <!-- 密码绑定配置 -->
    <div class="password-section">
      <div class="password-header">
        <span class="password-title">🔐 密码绑定</span>
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="config.binding.password_enabled"
            @change="config.binding.password_enabled = ($event.target as HTMLInputElement).checked"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="password-hint">开启后，客户端可通过输入机器人密码完成绑定。修改后点击底部「应用配置」保存。</p>
      <div v-if="config.binding.password_enabled" class="password-actions">
        <div v-if="!showPasswordForm" class="password-summary">
          <button class="btn-change-pwd" @click="showPasswordForm = true">修改密码</button>
          <span class="pwd-hint">点击「应用配置」后密码生效</span>
        </div>
        <div v-else class="password-form">
          <div class="pwd-input-wrap">
            <input
              v-model="editPassword"
              :type="showNewPassword ? 'text' : 'password'"
              class="pwd-input"
              placeholder="新密码（至少6位，字母+数字）"
            />
            <button type="button" class="pwd-toggle" tabindex="-1" @click="showNewPassword = !showNewPassword">
              {{ showNewPassword ? "🙈" : "👁️" }}
            </button>
          </div>
          <div class="pwd-input-wrap">
            <input
              v-model="confirmPassword"
              :type="showConfirmPassword ? 'text' : 'password'"
              class="pwd-input"
              placeholder="确认新密码"
            />
            <button type="button" class="pwd-toggle" tabindex="-1" @click="showConfirmPassword = !showConfirmPassword">
              {{ showConfirmPassword ? "🙈" : "👁️" }}
            </button>
          </div>
          <div class="pwd-btn-group">
            <button
              class="btn-save-pwd"
              @click="
                config.binding.password = editPassword;
                editPassword = '';
                confirmPassword = '';
                showPasswordForm = false;
                appStore.showToast('密码已填入配置，请点击底部「应用配置」保存', 'success');
              "
            >
              确认
            </button>
            <button
              class="btn-cancel-pwd"
              @click="
                showPasswordForm = false;
                editPassword = '';
                confirmPassword = '';
              "
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 绑定方式开关 -->
    <div class="bind-methods-section">
      <div class="bind-methods-header">
        <span class="bind-methods-title">🔐 支持的绑定方式</span>
      </div>
      <p class="bind-methods-hint">
        控制客户端可以使用哪些方式进行绑定认证。关闭不想要的方式，客户端绑定界面将不再显示。
      </p>
      <div class="methods-grid">
        <div v-for="(enabled, method) in config.binding.methods" :key="String(method)" class="method-card">
          <div class="method-info">
            <span class="method-icon">{{ METHOD_ICONS[String(method)] || "🔑" }}</span>
            <span class="method-name">{{ METHOD_LABELS[String(method)] || String(method) }}</span>
          </div>
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="enabled"
              @change="config.binding.methods[String(method)] = ($event.target as HTMLInputElement).checked"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
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
        <button v-if="binding.clientId !== currentClientId" class="btn-remove" @click="handleRemove(binding.clientId)">
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

/* 密码绑定配置 */
.password-section {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.password-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.password-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.password-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.password-actions {
  margin-top: 12px;
}

.password-summary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pwd-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.btn-change-pwd {
  padding: 6px 16px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-change-pwd:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.password-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pwd-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.pwd-input {
  width: 100%;
  padding: 8px 40px 8px 12px;
  font-size: 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  box-sizing: border-box;
}

.pwd-input:focus {
  outline: none;
  border-color: var(--accent);
}

.pwd-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 4px;
  line-height: 1;
  opacity: 0.7;
}

.pwd-toggle:hover {
  opacity: 1;
}

.pwd-btn-group {
  display: flex;
  gap: 8px;
}

.btn-save-pwd {
  padding: 6px 16px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-save-pwd:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-save-pwd:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-cancel-pwd {
  padding: 6px 16px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  cursor: pointer;
}

/* 开关 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
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
  border: 1px solid var(--border);
  border-radius: 24px;
  transition: 0.3s;
}

.toggle-slider::before {
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

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(20px);
  background: #fff;
}

/* 绑定方式开关 */
.bind-methods-section {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 16px;
}

.bind-methods-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bind-methods-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.bind-methods-hint {
  margin: 6px 0 12px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.methods-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.method-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.method-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.method-icon {
  font-size: 16px;
}

.method-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
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
