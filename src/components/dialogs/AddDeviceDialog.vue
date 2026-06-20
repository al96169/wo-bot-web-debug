<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  close: [];
  confirm: [ip: string, port: number, name: string];
}>();

const ip = ref("192.168.1.");
const port = ref(8765);
const name = ref("");

function handleCancel() {
  emit("close");
}

function handleConfirm() {
  emit("confirm", ip.value, port.value, name.value);
}
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog">
      <h3>手动连接设备</h3>
      <div class="form-group">
        <label>IP 地址</label>
        <input v-model="ip" type="text" placeholder="192.168.1.100" />
      </div>
      <div class="form-group">
        <label>端口</label>
        <input v-model.number="port" type="number" placeholder="8765" />
      </div>
      <div class="form-group">
        <label>名称（可选）</label>
        <input v-model="name" type="text" placeholder="我的机器人" />
      </div>
      <div class="dialog-actions">
        <button class="btn-secondary" @click="handleCancel">取消</button>
        <button class="btn-primary" @click="handleConfirm">连接</button>
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
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.form-group input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
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
