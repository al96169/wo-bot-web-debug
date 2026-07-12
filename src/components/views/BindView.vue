<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from "vue";
import QRCode from "qrcode";
import {
  useWebSocket,
  getClientId,
  setOnBindRequestAck,
  setOnBindSuccess,
  setOnBindFailed,
  availableMethods,
} from "@/composables/useWebSocket";
import type { BindingMethod, AuthRequiredData } from "@/types";
import { useDevicesStore } from "@/stores/devices";

const devicesStore = useDevicesStore();
const {
  sendBindRequest,
  sendBindVerify,
  sendBindReplay,
  sendBindStartScan,
  sendBindCancel,
  sendBindShareUse,
  sendBindPassword,
} = useWebSocket();

const props = defineProps<{
  authData: AuthRequiredData | null;
}>();

// ---- 状态 ----
const step = ref<
  "select" | "display" | "tts" | "qr_scan" | "gimbal" | "password" | "share_code" | "success" | "failed"
>("select");
const requestToken = ref("");
const errorMessage = ref("");
const attempts = ref(0);
const randomCode = ref("");
const scanStarted = ref(false);
const isSubmitting = ref(false);
// 云台方向输入
const gimbalSequenceLength = 4;
const gimbalInputs = ref<string[]>([]);
// 分享码输入
const shareCodeInput = ref("");
// 密码输入
const passwordInput = ref("");

// ---- 方式选择 ----
const methodLabels: Record<BindingMethod, string> = {
  display: "屏幕显示",
  qr_scan: "二维码扫描",
  tts: "语音播报",
  gimbal: "云台动作",
  password: "密码绑定",
  share_code: "输入绑定码",
};

const methodIcons: Record<BindingMethod, string> = {
  display: "🖥️",
  qr_scan: "📷",
  tts: "🔊",
  gimbal: "🎮",
  password: "🔑",
  share_code: "🔗",
};

const methodDescriptions: Record<BindingMethod, string> = {
  display: "机器人在屏幕上显示 6 位数字，请在此输入",
  qr_scan: "机器人的摄像头将扫描你屏幕上的二维码",
  tts: "机器人将通过语音播报 4 位数字，请在此输入",
  gimbal: "观察云台转动方向，依次点击对应方向按钮",
  password: "输入机器人密码完成绑定",
  share_code: "输入从其他设备获取的 6 位分享码直接绑定",
};

/** 服务端可用方式 + 始终可用的分享码方式（qr_scan 已禁用，不展示） */
const availableMethodList = computed<BindingMethod[]>(() => {
  const serverMethods = (props.authData?.methods || availableMethods.value).filter((m) => m !== "qr_scan");
  if (serverMethods.includes("share_code")) return serverMethods;
  return [...serverMethods, "share_code"];
});

function selectMethod(method: BindingMethod) {
  // 分享码方式不需要 bind_request，直接展示输入界面
  if (method === "share_code") {
    step.value = "share_code";
    errorMessage.value = "";
    shareCodeInput.value = "";
    isSubmitting.value = false;
    return;
  }

  requestToken.value = "rt-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  errorMessage.value = "";
  randomCode.value = "";
  gimbalInputs.value = [];
  scanStarted.value = false;
  isSubmitting.value = false;

  sendBindRequest(requestToken.value, method);
  step.value = method;

  // QR 扫描方式：进入后自动生成二维码
  if (method === "qr_scan") {
    nextTick(() => generateQrCode());
  }
}

// ---- 分享码提交 ----
function submitShareCode() {
  if (!shareCodeInput.value || isSubmitting.value) return;
  isSubmitting.value = true;
  sendBindShareUse(shareCodeInput.value.trim().toUpperCase());
}

// ---- 密码提交 ----
function submitPassword() {
  if (!passwordInput.value || !requestToken.value || isSubmitting.value) return;
  isSubmitting.value = true;
  sendBindPassword(requestToken.value, passwordInput.value);
}

// ---- 回调注册 ----
setOnBindRequestAck((token, method, options) => {
  requestToken.value = token;
  void options; // 云台不再使用 options
  console.log("[Bind] ACK received:", token, method, options);
});

setOnBindSuccess((_clientId, _clientToken) => {
  console.log("[Bind] Success:", _clientId);
  step.value = "success";
  isSubmitting.value = false;
});

setOnBindFailed((error, attemptCount) => {
  errorMessage.value = error;
  attempts.value = attemptCount;
  step.value = "failed";
  isSubmitting.value = false;
});

// ---- 验证码提交 ----
function submitCode() {
  if (!randomCode.value || !requestToken.value || isSubmitting.value) return;
  isSubmitting.value = true;
  sendBindVerify(requestToken.value, randomCode.value);
}

// ---- 云台方向输入 ----
function addDirection(dir: string) {
  if (gimbalInputs.value.length >= gimbalSequenceLength || isSubmitting.value) return;
  gimbalInputs.value.push(dir);
}

function removeLastDirection() {
  if (isSubmitting.value || gimbalInputs.value.length === 0) return;
  gimbalInputs.value.pop();
}

function submitGimbalSequence() {
  if (gimbalInputs.value.length !== gimbalSequenceLength || isSubmitting.value) return;
  isSubmitting.value = true;
  sendBindVerify(requestToken.value, gimbalInputs.value.join(","));
}

// ---- 重播 ----
function replay() {
  if (!requestToken.value) return;
  sendBindReplay(requestToken.value);
}

// ---- QR 扫描：手动启动 ----
function startScan() {
  if (!requestToken.value) return;
  scanStarted.value = true;
  sendBindStartScan(requestToken.value);
}

// ---- QR 码生成（本地，不依赖外部 API） ----
// QR 内容格式：wobot:bind|<deviceId>|<requestToken>|<clientId>
// 简短格式降低二维码密度，提高扫描成功率
const qrDataUrl = ref("");

function buildQrPayload(): string {
  const robotId = devicesStore.robotInfo?.robot_id || "";
  return `wobot:bind|${robotId}|${requestToken.value}|${getClientId()}`;
}

async function generateQrCode() {
  try {
    const payload = buildQrPayload();
    qrDataUrl.value = await QRCode.toDataURL(payload, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: "M",
    });
  } catch (e) {
    console.error("[BindView] QR generation failed:", e);
    qrDataUrl.value = "";
  }
}

// ---- 返回/取消（发送 bind_cancel 停止后端任务） ----
function backToSelect() {
  if (requestToken.value) {
    sendBindCancel(requestToken.value);
  }
  step.value = "select";
  errorMessage.value = "";
  randomCode.value = "";
  gimbalInputs.value = [];
  shareCodeInput.value = "";
  passwordInput.value = "";
  scanStarted.value = false;
  isSubmitting.value = false;
}

onMounted(() => {
  console.log("[BindView] mounted, available methods:", props.authData?.methods || availableMethods.value);
});

onUnmounted(() => {
  setOnBindRequestAck(null);
  setOnBindSuccess(null);
  setOnBindFailed(null);
});
</script>

<template>
  <div class="bind-view">
    <!-- 方式选择 -->
    <div v-if="step === 'select'" class="method-select">
      <h2>绑定认证</h2>
      <p class="hint">{{ props.authData?.message || "请选择绑定认证方式" }}</p>
      <div class="methods-grid">
        <button v-for="method in availableMethodList" :key="method" class="method-card" @click="selectMethod(method)">
          <span class="method-icon">{{ methodIcons[method] }}</span>
          <span class="method-label">{{ methodLabels[method] }}</span>
          <span class="method-desc">{{ methodDescriptions[method] }}</span>
        </button>
      </div>
    </div>

    <!-- 显示方式（屏幕） -->
    <div v-else-if="step === 'display'" class="method-step">
      <h2>屏幕显示认证</h2>
      <p class="hint">请在机器人屏幕上查看 6 位数字</p>
      <input
        v-model="randomCode"
        class="code-input"
        type="text"
        maxlength="6"
        placeholder="输入 6 位数字"
        @keyup.enter="submitCode"
      />
      <div class="btn-group">
        <button class="btn-primary" :disabled="randomCode.length !== 6" @click="submitCode">确认</button>
        <button class="btn-secondary" @click="replay">重新显示</button>
      </div>
      <button class="btn-back" @click="backToSelect">返回</button>
    </div>

    <!-- TTS 方式 -->
    <div v-else-if="step === 'tts'" class="method-step">
      <h2>语音播报认证</h2>
      <p class="hint">机器人正在播报 4 位数字，请输入听到的数字</p>
      <input
        v-model="randomCode"
        class="code-input"
        type="text"
        maxlength="4"
        placeholder="输入 4 位数字"
        @keyup.enter="submitCode"
      />
      <div class="btn-group">
        <button class="btn-primary" :disabled="randomCode.length !== 4" @click="submitCode">确认</button>
        <button class="btn-secondary" @click="replay">重新播报</button>
      </div>
      <button class="btn-back" @click="backToSelect">返回</button>
    </div>

    <!-- QR 扫描方式 -->
    <div v-else-if="step === 'qr_scan'" class="method-step">
      <h2>二维码扫描认证</h2>
      <p class="hint">将下方二维码对准机器人摄像头</p>
      <div class="qr-container">
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR Code" class="qr-image" />
        <div v-else class="qr-placeholder">生成二维码中...</div>
      </div>
      <div v-if="!scanStarted" class="btn-group">
        <button class="btn-primary" @click="startScan">开始扫描</button>
        <button class="btn-back" @click="backToSelect">返回</button>
      </div>
      <div v-else class="scan-waiting">
        <div class="scanning-indicator">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
        <p class="hint-small">机器人正在扫描，请保持二维码对准摄像头...</p>
        <button class="btn-back" @click="backToSelect">取消扫描</button>
      </div>
    </div>

    <!-- 云台方式 -->
    <div v-else-if="step === 'gimbal'" class="method-step">
      <h2>云台动作认证</h2>
      <p class="hint">观察云台转动方向，依次点击对应方向按钮</p>
      <!-- 已输入序列显示 -->
      <div class="gimbal-display">
        <div v-for="i in gimbalSequenceLength" :key="i" class="gimbal-slot" :class="{ filled: gimbalInputs[i - 1] }">
          {{ gimbalInputs[i - 1] || "" }}
        </div>
      </div>
      <!-- 方向按钮 -->
      <div class="gimbal-pad">
        <button
          class="dir-btn"
          :disabled="isSubmitting || gimbalInputs.length >= gimbalSequenceLength"
          @click="addDirection('上')"
        >
          ↑
        </button>
        <div class="dir-row">
          <button
            class="dir-btn"
            :disabled="isSubmitting || gimbalInputs.length >= gimbalSequenceLength"
            @click="addDirection('左')"
          >
            ←
          </button>
          <button
            class="dir-btn dir-btn-del"
            :disabled="isSubmitting || gimbalInputs.length === 0"
            title="删除上一个"
            @click="removeLastDirection"
          >
            ⌫
          </button>
          <button
            class="dir-btn"
            :disabled="isSubmitting || gimbalInputs.length >= gimbalSequenceLength"
            @click="addDirection('右')"
          >
            →
          </button>
        </div>
        <button
          class="dir-btn"
          :disabled="isSubmitting || gimbalInputs.length >= gimbalSequenceLength"
          @click="addDirection('下')"
        >
          ↓
        </button>
      </div>
      <div class="btn-group">
        <button
          class="btn-primary"
          :disabled="gimbalInputs.length !== gimbalSequenceLength || isSubmitting"
          @click="submitGimbalSequence"
        >
          确认
        </button>
        <button class="btn-secondary" :disabled="isSubmitting" @click="replay">重新转动</button>
        <button class="btn-back" :disabled="isSubmitting" @click="backToSelect">返回</button>
      </div>
    </div>

    <!-- 分享码输入方式 -->
    <div v-else-if="step === 'share_code'" class="method-step">
      <h2>输入绑定码</h2>
      <p class="hint">请输入从其他设备获取的 6 位分享码</p>
      <input
        v-model="shareCodeInput"
        class="code-input share-code-input"
        type="text"
        maxlength="6"
        placeholder="ABC123"
        @keyup.enter="submitShareCode"
      />
      <div class="btn-group">
        <button class="btn-primary" :disabled="shareCodeInput.length !== 6 || isSubmitting" @click="submitShareCode">
          {{ isSubmitting ? "绑定中..." : "确认绑定" }}
        </button>
        <button class="btn-back" :disabled="isSubmitting" @click="backToSelect">返回</button>
      </div>
    </div>

    <!-- 密码绑定方式 -->
    <div v-else-if="step === 'password'" class="method-step">
      <h2>密码绑定</h2>
      <p class="hint">请输入机器人密码完成绑定</p>
      <input
        v-model="passwordInput"
        class="code-input password-input"
        type="password"
        placeholder="输入密码"
        @keyup.enter="submitPassword"
      />
      <div class="btn-group">
        <button class="btn-primary" :disabled="!passwordInput || isSubmitting" @click="submitPassword">
          {{ isSubmitting ? "验证中..." : "确认" }}
        </button>
        <button class="btn-back" :disabled="isSubmitting" @click="backToSelect">返回</button>
      </div>
    </div>

    <!-- 成功 -->
    <div v-else-if="step === 'success'" class="method-step result-step">
      <div class="result-icon success">✓</div>
      <h2>绑定成功</h2>
      <p class="hint">绑定已完成，可以正常使用所有功能</p>
    </div>

    <!-- 失败 -->
    <div v-else-if="step === 'failed'" class="method-step result-step">
      <div class="result-icon failed">✗</div>
      <h2>绑定失败</h2>
      <p class="error-message">{{ errorMessage }}</p>
      <p v-if="attempts > 0" class="hint-small">已失败 {{ attempts }} 次</p>
      <div class="btn-group">
        <button class="btn-primary" @click="backToSelect">重试</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bind-view {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

h2 {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  text-align: center;
  color: var(--text-primary);
}

.hint {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  margin: 0;
}

.hint-small {
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
  margin: 0;
}

/* 方式选择 */
.methods-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.method-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s;
}

.method-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}

.method-icon {
  font-size: 32px;
}

.method-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.method-desc {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.4;
}

/* 通用步骤 */
.method-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.code-input {
  width: 200px;
  padding: 12px 16px;
  font-size: 24px;
  text-align: center;
  letter-spacing: 8px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
}

.code-input:focus {
  outline: none;
  border-color: var(--accent);
}

.share-code-input {
  text-transform: uppercase;
  letter-spacing: 4px;
  font-size: 20px;
}

.password-input {
  letter-spacing: 2px;
  font-size: 18px;
  width: 240px;
}

.btn-primary {
  padding: 10px 32px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 8px 24px;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--accent);
}

.btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-back {
  padding: 8px 24px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
}

.btn-back:hover:not(:disabled) {
  color: var(--text-primary);
}

.btn-group {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}

/* QR 扫描 */
.qr-container {
  padding: 16px;
  background: #fff;
  border-radius: var(--radius-lg);
}

.qr-image {
  display: block;
  width: 240px;
  height: 240px;
}

.qr-placeholder {
  width: 240px;
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 14px;
}

.scan-waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.scanning-indicator {
  display: flex;
  gap: 6px;
}

.scanning-indicator .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1.4s ease-in-out infinite;
}

.scanning-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.scanning-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

/* 云台方向输入 */
.gimbal-display {
  display: flex;
  gap: 8px;
}

.gimbal-slot {
  width: 48px;
  height: 48px;
  border: 2px dashed var(--border);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-secondary);
}

.gimbal-slot.filled {
  border-style: solid;
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-card);
}

.gimbal-pad {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.dir-row {
  display: flex;
  gap: 8px;
}

.dir-btn {
  width: 56px;
  height: 56px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  border-radius: var(--radius-md);
  font-size: 24px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dir-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.dir-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.dir-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.dir-btn-del {
  font-size: 18px;
}

/* 结果 */
.result-step {
  padding: 32px 0;
}

.result-icon {
  font-size: 48px;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-icon.success {
  background: var(--success);
  color: #fff;
}

.result-icon.failed {
  background: var(--danger);
  color: #fff;
}

.error-message {
  color: var(--danger);
  font-size: 14px;
  text-align: center;
}
</style>
