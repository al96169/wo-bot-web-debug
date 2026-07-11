<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useWebSocket, getClientId } from "@/composables/useWebSocket";
import { useRobotStore } from "@/stores/robot";

const robotStore = useRobotStore();
const { requestBindList, sendBindRemove } = useWebSocket();

const removeTarget = ref<string | null>(null);
const currentClientId = getClientId();

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
</script>

<template>
  <div class="client-mgmt-view">
    <div class="view-header">
      <h3>🔗 客户端管理</h3>
      <button class="btn-refresh" @click="requestBindList" title="刷新列表">🔄</button>
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
