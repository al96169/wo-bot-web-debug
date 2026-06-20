<script setup lang="ts">
const props = defineProps<{
  name: string;
  url: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog gallery-preview-dialog">
      <div class="gallery-preview-header">
        <span>{{ name }}</span>
        <button class="btn-secondary" @click="emit('close')">关闭</button>
      </div>
      <div class="gallery-preview-body">
        <div v-if="!url" style="color: var(--text-muted); padding: 60px 40px">📷 图片预览</div>
        <img v-else :src="url" alt="Preview" />
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
.gallery-preview-dialog {
  max-width: 90vw;
  max-height: 90vh;
  min-width: auto;
  padding: 16px;
}
.dialog {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  min-width: 360px;
  max-width: 480px;
}
.gallery-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.gallery-preview-header span {
  font-size: 14px;
  font-weight: 600;
}
.gallery-preview-body {
  text-align: center;
}
.gallery-preview-body img {
  max-width: 100%;
  max-height: 70vh;
  border-radius: var(--radius-md);
}
.btn-secondary {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background: var(--bg-hover);
}
</style>
