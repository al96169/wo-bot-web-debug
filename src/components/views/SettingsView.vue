<script setup lang="ts">
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

function handleThemeChange(e: Event) {
  const target = e.target as HTMLSelectElement
  appStore.theme = target.value as 'dark' | 'light' | 'auto'
  appStore.applyTheme()
}

function handleLogLevelChange(e: Event) {
  const target = e.target as HTMLSelectElement
  // TODO: 接入 robotStore 过滤日志输出
  localStorage.setItem('app-log-level', target.value)
}
</script>

<template>
  <div class="view active">
    <h2>设置</h2>
    <div class="settings-list">
      <div class="setting-item">
        <label>主题</label>
        <select :value="appStore.theme" @change="handleThemeChange">
          <option value="auto">跟随系统</option>
          <option value="dark">深色</option>
          <option value="light">明亮</option>
        </select>
      </div>
      <div class="setting-item">
        <label>日志级别</label>
        <select @change="handleLogLevelChange">
          <option value="debug">Debug</option>
          <option value="info" selected>Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { display: none; }
.view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
h2 { margin-bottom: 16px; font-size: 22px; }
.settings-list { display: flex; flex-direction: column; gap: 8px; max-width: 500px; }
.setting-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.setting-item label:first-child { font-size: 14px; }
.setting-item select {
  padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-secondary); color: var(--text-primary); font-size: 13px;
}
</style>
