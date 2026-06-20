<script setup lang="ts">
import { computed } from "vue";
import { useRobotStore } from "@/stores/robot";

const props = defineProps<{
  messageId: string;
}>();

const emit = defineEmits<{
  close: [];
  markUnread: [];
}>();

const robotStore = useRobotStore();

const message = computed(() => {
  return robotStore.messages.find((m) => m.id === props.messageId) ?? null;
});

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog" style="max-width: 560px">
      <template v-if="message">
        <h3>{{ message.subject }}</h3>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px">
          {{ fmtTime(message.time) }} · {{ message.source }} ·
          <span v-if="message.read" style="color: var(--text-muted)">已读</span>
          <span v-else style="color: var(--accent)">未读</span>
        </div>
        <div style="color: var(--text-primary); line-height: 1.7; white-space: pre-wrap">{{ message.body }}</div>
        <div class="dialog-actions" style="margin-top: 20px">
          <button class="btn-secondary" @click="emit('close')">关闭</button>
          <button class="btn-primary" @click="emit('markUnread')">标记未读</button>
        </div>
      </template>
      <template v-else>
        <p style="color: var(--text-muted)">消息不存在</p>
        <div class="dialog-actions">
          <button class="btn-secondary" @click="emit('close')">关闭</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 360px;
  max-width: 480px;
}
.dialog h3 {
  margin-bottom: 16px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.btn-secondary,
.btn-primary {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
}
.btn-secondary {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background: var(--bg-hover);
}
.btn-primary {
  border: none;
  background: var(--accent);
  color: var(--bg-primary);
}
.btn-primary:hover {
  opacity: 0.9;
}
</style>
