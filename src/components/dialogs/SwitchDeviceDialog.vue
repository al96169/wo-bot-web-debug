<script setup lang="ts">
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const props = defineProps<{
  deviceName: string;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog">
      <h3>确认切换设备</h3>
      <p style="margin-bottom: 16px; color: var(--text-secondary)">
        确定要断开当前连接并切换到 <strong>{{ deviceName }}</strong> 吗？
      </p>
      <div class="dialog-actions">
        <button class="btn-secondary" @click="emit('close')">取消</button>
        <button class="btn-primary" @click="emit('confirm')">确认切换</button>
      </div>
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
