<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuth } from "@/composables/useAuth";

const router = useRouter();
const { handleCallback } = useAuth();

const loading = ref(true);
const errorMsg = ref<string | null>(null);

onMounted(async () => {
  const code = new URLSearchParams(window.location.search).get("code");
  const state = new URLSearchParams(window.location.search).get("state");
  const error = new URLSearchParams(window.location.search).get("error");

  if (error) {
    const errorDesc = new URLSearchParams(window.location.search).get("error_description");
    errorMsg.value = errorDesc || `授权失败: ${error}`;
    loading.value = false;
    return;
  }

  if (!code || !state) {
    errorMsg.value = "回调参数缺失（code 或 state）";
    loading.value = false;
    return;
  }

  try {
    await handleCallback(code, state);
    router.replace({ name: "quickActions" });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "回调处理失败";
    loading.value = false;
  }
});
</script>

<template>
  <div class="view auth-callback-view">
    <div class="auth-callback-content">
      <template v-if="loading">
        <div class="auth-loading">
          <div class="spinner"></div>
          <p>正在完成登录...</p>
        </div>
      </template>
      <template v-else-if="errorMsg">
        <div class="auth-error">
          <p class="error-icon">❌</p>
          <p class="error-message">{{ errorMsg }}</p>
          <button class="btn btn-primary" @click="router.replace({ name: 'home' })">返回首页</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.auth-callback-view {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
}

.auth-callback-content {
  text-align: center;
  padding: 2rem;
}

.auth-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color, #444);
  border-top-color: var(--accent-color, #4af);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.auth-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.error-icon {
  font-size: 3rem;
}

.error-message {
  color: var(--error-color, #f44);
  word-break: break-word;
}

.btn {
  padding: 0.5rem 1.5rem;
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

.btn-primary {
  background: var(--accent-color, #4af);
  border-color: var(--accent-color, #4af);
  color: #fff;
}

.btn-primary:hover {
  opacity: 0.9;
}
</style>
