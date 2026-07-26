<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuth } from "@/composables/useAuth";
import { getAuthorizedApps, revokeApp, type AuthorizedApp } from "@/services/account";

const { isAuthenticated, login } = useAuth();

const apps = ref<AuthorizedApp[]>([]);
const loading = ref(true);
const errorMsg = ref<string | null>(null);
const revokingApp = ref<AuthorizedApp | null>(null);

async function loadApps() {
  loading.value = true;
  errorMsg.value = null;
  try {
    apps.value = await getAuthorizedApps();
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "加载授权应用列表失败";
  } finally {
    loading.value = false;
  }
}

async function confirmRevoke() {
  if (!revokingApp.value) return;
  try {
    await revokeApp(revokingApp.value.grantId);
    apps.value = apps.value.filter((a) => a.grantId !== revokingApp.value?.grantId);
    revokingApp.value = null;
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : "撤销授权失败";
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN");
}

onMounted(() => {
  if (isAuthenticated.value) {
    loadApps();
  } else {
    loading.value = false;
  }
});
</script>

<template>
  <div class="view cloud-apps-view">
    <h2>🔐 授权应用</h2>

    <!-- 未登录 -->
    <div v-if="!isAuthenticated" class="not-logged-in">
      <p>请先登录以查看授权应用</p>
      <button class="btn btn-primary" @click="login">登录</button>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading" class="loading">
      <div class="spinner"></div>
      <p>加载授权应用列表...</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="errorMsg" class="error-msg">
      <p>❌ {{ errorMsg }}</p>
      <button class="btn" @click="loadApps">重试</button>
    </div>

    <!-- 应用列表 -->
    <div v-else-if="apps.length > 0" class="app-list">
      <div v-for="app in apps" :key="app.grantId" class="app-card">
        <div class="app-info">
          <div class="app-header">
            <span class="app-name">{{ app.appName }}</span>
            <span class="app-type">{{ app.appTypeLabel }}</span>
          </div>
          <div class="app-meta">
            <span v-if="app.appDescription">{{ app.appDescription }}</span>
            <span>授权时间: {{ formatTime(app.createdAt) }}</span>
            <span>Scopes: {{ app.scopes.join(", ") }}</span>
          </div>
        </div>
        <div class="app-actions">
          <button class="btn btn-sm btn-danger" @click="revokingApp = app">撤销授权</button>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <p>📭 还没有授权的应用</p>
      <p class="hint">当你授权第三方应用访问你的帐号时，会在这里显示</p>
    </div>

    <!-- 撤销确认弹窗 -->
    <div v-if="revokingApp" class="modal-overlay" @click.self="revokingApp = null">
      <div class="modal">
        <h3>确认撤销授权</h3>
        <p>确定要撤销「{{ revokingApp.appName }}」的授权吗？</p>
        <p class="hint">撤销后该应用将无法再访问你的帐号信息，需要重新授权才能使用。</p>
        <div class="modal-actions">
          <button class="btn" @click="revokingApp = null">取消</button>
          <button class="btn btn-danger" @click="confirmRevoke">确认撤销</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cloud-apps-view {
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

.app-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.app-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  background: var(--bg-secondary, #1a1a1a);
}

.app-info {
  flex: 1;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.app-name {
  font-size: 1.1rem;
  font-weight: 500;
}

.app-type {
  font-size: 0.8rem;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-hover, #333);
  color: var(--text-secondary, #aaa);
}

.app-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.8rem;
  color: var(--text-secondary, #888);
}

.app-actions {
  display: flex;
  gap: 0.5rem;
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
