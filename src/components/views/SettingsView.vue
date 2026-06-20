<script setup lang="ts">
import { useAppStore } from "@/stores/app";

const appStore = useAppStore();

function handleThemeChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  appStore.theme = target.value as "dark" | "light" | "auto";
  appStore.applyTheme();
}

function handleLogLevelChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  // TODO: 接入 robotStore 过滤日志输出
  localStorage.setItem("app-log-level", target.value);
}

function handleDebugModeChange(e: Event) {
  const target = e.target as HTMLInputElement;
  appStore.debugMode = target.checked;
  appStore.saveSettings();
  if (appStore.debugMode) {
    console.log("[Debug] 调试模式已开启，将在控制台输出调试日志");
  }
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
      <div class="setting-item">
        <label>Debug 模式</label>
        <div class="setting-toggle">
          <span class="setting-hint">开启后在浏览器控制台输出调试日志</span>
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="appStore.debugMode"
              @change="handleDebugModeChange"
            />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  display: none;
}
.view.active {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
h2 {
  margin-bottom: 16px;
  font-size: 22px;
}
.settings-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 500px;
}
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.setting-item label:first-child {
  font-size: 14px;
}
.setting-item select {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
}

/* Toggle Switch */
.setting-toggle {
  display: flex;
  align-items: center;
  gap: 12px;
}
.setting-hint {
  font-size: 12px;
  color: var(--text-muted);
}
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
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
  transition: all 0.3s;
}
.toggle-slider::before {
  content: "";
  position: absolute;
  height: 18px;
  width: 18px;
  left: 2px;
  bottom: 2px;
  background: var(--text-muted);
  border-radius: 50%;
  transition: all 0.3s;
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--accent);
  border-color: var(--accent);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(20px);
  background: #fff;
}
</style>
