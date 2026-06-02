<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRobotStore } from '@/stores/robot'
import type { LogEntry } from '@/types'

const robotStore = useRobotStore()

const keyword = ref('')
const levelFilter = ref('all')
const sortAsc = ref(false)
const autoScroll = ref(true)

const filteredLogs = computed(() => {
  let logs = [...robotStore.logs]
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    logs = logs.filter(l => l.message.toLowerCase().includes(kw) || l.source.toLowerCase().includes(kw))
  }
  if (levelFilter.value !== 'all') {
    logs = logs.filter(l => l.level === levelFilter.value)
  }
  if (sortAsc.value) {
    logs.reverse()
  }
  return logs
})

function clearLogs() {
  robotStore.clearLogs()
}

function exportLogs() {
  const text = filteredLogs.value.map(l => `[${l.time}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`).join('\n')
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wo-bot-logs-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="view active">
    <div class="logs-layout">
      <div class="logs-toolbar">
        <div class="logs-filter">
          <input type="text" v-model="keyword" placeholder="关键词过滤..." />
          <select v-model="levelFilter">
            <option value="all">全部等级</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div class="logs-actions">
          <button @click="sortAsc = !sortAsc" title="切换排序">
            {{ sortAsc ? '↑' : '↓' }} {{ sortAsc ? '正序' : '倒序' }}
          </button>
          <button @click="clearLogs">清空</button>
          <button @click="exportLogs">导出</button>
          <label>
            <input type="checkbox" v-model="autoScroll" /> 自动滚动
          </label>
        </div>
      </div>
      <div class="logs-container">
        <div v-if="filteredLogs.length === 0" class="empty-state">暂无日志</div>
        <div
          v-for="(log, idx) in filteredLogs"
          :key="idx"
          class="log-entry"
        >
          <span class="log-time">{{ log.time }}</span>
          <span class="log-level" :class="log.level">{{ log.level.toUpperCase() }}</span>
          <span class="log-source">{{ log.source }}</span>
          <span>{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view { display: none; }
.view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
.logs-layout { display: flex; flex-direction: column; height: 100%; }
.logs-toolbar {
  display: flex; gap: 12px; margin-bottom: 8px; align-items: center;
  justify-content: space-between; flex-wrap: wrap;
}
.logs-filter { display: flex; gap: 8px; align-items: center; }
.logs-filter input, .logs-filter select {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-card); color: var(--text-primary); font-size: 12px;
}
.logs-filter input { min-width: 180px; }
.logs-actions { display: flex; gap: 8px; align-items: center; }
.logs-actions button {
  padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-card); color: var(--text-primary); font-size: 12px; cursor: pointer;
}
.logs-actions button:hover { background: var(--bg-hover); }
.logs-actions label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.logs-container {
  flex: 1; overflow-y: auto; background: var(--bg-secondary);
  border: 1px solid var(--border); border-radius: var(--radius-md);
  padding: 12px; font-family: 'SF Mono', Monaco, monospace; font-size: 12px;
}
.log-entry {
  padding: 4px 0; border-bottom: 1px solid var(--border); font-size: 12px; line-height: 1.5;
}
.log-entry:last-child { border-bottom: none; }
.log-time { color: var(--text-muted); margin-right: 8px; }
.log-level {
  display: inline-block; padding: 1px 6px; border-radius: var(--radius-sm); font-size: 10px;
  margin-right: 8px; min-width: 40px; text-align: center;
}
.log-level.debug { background: var(--bg-tertiary); color: var(--text-muted); }
.log-level.info { background: var(--accent); color: var(--bg-primary); }
.log-level.warn { background: var(--warning); color: var(--bg-primary); }
.log-level.error { background: var(--danger); color: white; }
.log-source { color: var(--accent-secondary); margin-right: 8px; font-weight: 600; }
.empty-state { text-align: center; padding: 48px; color: var(--text-muted); }
</style>
