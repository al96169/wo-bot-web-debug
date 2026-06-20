<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket } from "@/composables/useWebSocket";
import type { Software } from "@/types";

const robotStore = useRobotStore();
const { requestSoftwareList, requestSoftwareSearch, sendSoftwareAction } = useWebSocket();

// 进入页面时自动刷新已安装列表
onMounted(() => {
  if (robotStore.softwareInstalled.length === 0) {
    requestSoftwareList();
  }
});

const activeTab = ref<"installed" | "available">("installed");
const installedSearch = ref("");
const availableSearch = ref("");
const availableResults = ref<Software[]>([]);

const filteredInstalled = computed(() => {
  const sw = robotStore.softwareInstalled;
  if (!installedSearch.value) return sw;
  const q = installedSearch.value.toLowerCase();
  return sw.filter((s) => s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q));
});

function searchAvailable() {
  const q = availableSearch.value.trim();
  if (!q) {
    availableResults.value = [];
    return;
  }
  // 发送后端搜索请求，结果会更新 robotStore.softwareAvailable
  requestSoftwareSearch(q);
}

// 监听搜索结果变化，自动更新显示
watch(
  () => robotStore.softwareAvailable,
  (pkgs) => {
    if (availableSearch.value.trim()) {
      availableResults.value = pkgs;
    }
  },
);

function handleAction(sw: Software, action: string) {
  robotStore.addLog("info", "Software", `${action} ${sw.name}`);
  robotStore.addCmdLog({
    time: new Date().toLocaleTimeString(),
    direction: "send",
    type: `software_${action}`,
    data: sw.name,
  });
  sendSoftwareAction(action, sw.name);
}

function refreshInstalled() {
  installedSearch.value = "";
  requestSoftwareList();
}
</script>

<template>
  <div class="view active">
    <h2>软件管理</h2>
    <div class="software-layout">
      <div class="software-tabs">
        <button class="tab-btn" :class="{ active: activeTab === 'installed' }" @click="activeTab = 'installed'">
          已安装
        </button>
        <button class="tab-btn" :class="{ active: activeTab === 'available' }" @click="activeTab = 'available'">
          软件搜索
        </button>
      </div>
      <div class="software-content">
        <!-- Installed Tab -->
        <div class="tab-panel" :class="{ active: activeTab === 'installed' }">
          <div class="software-toolbar">
            <input v-model="installedSearch" type="text" placeholder="搜索已安装软件..." />
            <button @click="refreshInstalled">刷新</button>
          </div>
          <div class="software-list">
            <div v-if="filteredInstalled.length === 0" class="empty-state">无匹配软件</div>
            <div v-for="sw in filteredInstalled" :key="sw.name" class="software-card">
              <div class="software-card-icon">{{ sw.icon }}</div>
              <div class="software-card-info">
                <div class="software-card-name">{{ sw.name }}</div>
                <div class="software-card-meta">
                  {{ sw.version }} &middot; {{ sw.size }} &middot; {{ sw.description }}
                </div>
              </div>
              <div class="software-card-actions">
                <button class="uninstall" @click="handleAction(sw, 'uninstall')">卸载</button>
                <button class="upgrade" @click="handleAction(sw, 'upgrade')">升级</button>
              </div>
            </div>
          </div>
        </div>
        <!-- Available Tab -->
        <div class="tab-panel" :class="{ active: activeTab === 'available' }">
          <div class="software-toolbar">
            <input
              v-model="availableSearch"
              type="text"
              placeholder="搜索互联网软件包..."
              @keydown.enter="searchAvailable"
            />
            <button @click="searchAvailable">搜索</button>
          </div>
          <div class="software-list">
            <div v-if="availableResults.length === 0 && !availableSearch" class="empty-state">输入关键词搜索软件</div>
            <div v-else-if="availableResults.length === 0" class="empty-state">无搜索结果</div>
            <div v-for="sw in availableResults" :key="sw.name" class="software-card">
              <div class="software-card-icon">{{ sw.icon }}</div>
              <div class="software-card-info">
                <div class="software-card-name">{{ sw.name }}</div>
                <div class="software-card-meta">
                  {{ sw.version }} &middot; {{ sw.size }} &middot; {{ sw.description }}
                </div>
              </div>
              <div class="software-card-actions">
                <button class="install" @click="handleAction(sw, 'install')">安装</button>
              </div>
            </div>
          </div>
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
.software-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.software-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}
.tab-btn.active {
  background: var(--accent);
  color: var(--bg-primary);
}
.software-content {
  flex: 1;
  overflow: hidden;
}
.software-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.software-toolbar input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
}
.software-toolbar button {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}
.software-toolbar button:hover {
  background: var(--bg-hover);
}
.software-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  flex: 1;
}
.tab-panel {
  display: none;
  height: 100%;
}
.tab-panel.active {
  display: flex;
  flex-direction: column;
}
.software-card {
  padding: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 16px;
}
.software-card-icon {
  font-size: 28px;
}
.software-card-info {
  flex: 1;
}
.software-card-name {
  font-weight: 600;
  font-size: 14px;
}
.software-card-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.software-card-actions {
  display: flex;
  gap: 8px;
}
.software-card-actions button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}
.software-card-actions button:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.software-card-actions button.install {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}
.software-card-actions button.uninstall {
  color: var(--danger);
  border-color: var(--danger);
}
.software-card-actions button.upgrade {
  color: var(--warning);
  border-color: var(--warning);
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
