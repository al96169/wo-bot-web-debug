<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRobotStore } from '@/stores/robot'

const appStore = useAppStore()
const robotStore = useRobotStore()

const sshInput = ref('')

function switchTab(tab: 'cmdLog' | 'ssh') {
  appStore.bottomPanelTab = tab
  if (!appStore.bottomPanelExpanded) {
    appStore.bottomPanelExpanded = true
  }
}

function togglePanel() {
  appStore.bottomPanelExpanded = !appStore.bottomPanelExpanded
}

function clearCmdLogs() {
  robotStore.clearCmdLogs()
}

function handleSSHConnect() {
  appStore.sshConnected = true
  robotStore.addSSHOutput({ type: 'cmd', text: 'ssh wo-bot@192.168.1.100' })
  robotStore.addSSHOutput({ type: 'out', text: 'Welcome to wo-bot #001 (Ubuntu 22.04 LTS)' })
  robotStore.addSSHOutput({ type: 'out', text: 'Last login: Sun Jun  2 10:30:15 2026 from 192.168.1.50' })
}

function handleSSHDisconnect() {
  appStore.sshConnected = false
  robotStore.clearSSHOutput()
}

function sendSSHCommand() {
  const cmd = sshInput.value.trim()
  if (!cmd) return
  robotStore.addSSHOutput({ type: 'cmd', text: cmd })
  // Mock response
  if (cmd === 'ls') {
    robotStore.addSSHOutput({ type: 'out', text: 'Desktop  Documents  Downloads  Music  Pictures  Videos  workspace' })
  } else if (cmd.startsWith('echo')) {
    robotStore.addSSHOutput({ type: 'out', text: cmd.substring(5) })
  } else if (cmd === 'whoami') {
    robotStore.addSSHOutput({ type: 'out', text: 'wo-bot' })
  } else if (cmd === 'uptime') {
    robotStore.addSSHOutput({ type: 'out', text: '10:35:22 up 3 days, 7:42, 1 user, load average: 0.45, 0.32, 0.28' })
  } else {
    robotStore.addSSHOutput({ type: 'err', text: `bash: ${cmd}: command not found` })
  }
  sshInput.value = ''
}

function handleSSHInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    sendSSHCommand()
  }
}

function addMockCmdLogs() {
  if (robotStore.cmdLogs.length === 0) {
    robotStore.addCmdLog({ time: '10:30:15', direction: 'send', type: 'CMD', data: '{"cmd":"status"}' })
    robotStore.addCmdLog({ time: '10:30:15', direction: 'recv', type: 'ACK', data: '{"ok":true,"data":{"battery":78}}' })
    robotStore.addCmdLog({ time: '10:30:16', direction: 'send', type: 'CMD', data: '{"cmd":"move","dir":"forward","speed":50}' })
    robotStore.addCmdLog({ time: '10:30:16', direction: 'recv', type: 'ACK', data: '{"ok":true}' })
  }
}
addMockCmdLogs()
</script>

<template>
  <div class="bottom-panel" :class="{ expanded: appStore.bottomPanelExpanded }">
    <div class="bottom-tab-bar">
      <div class="bottom-tab-buttons">
        <button
          class="bottom-tab"
          :class="{ active: appStore.bottomPanelTab === 'cmdLog' }"
          @click="switchTab('cmdLog')"
        >📡 控制指令</button>
        <button
          class="bottom-tab"
          :class="{ active: appStore.bottomPanelTab === 'ssh' }"
          @click="switchTab('ssh')"
        >💻 SSH 终端 <span class="ssh-dot" :class="{ connected: appStore.sshConnected }"></span></button>
      </div>
      <button class="bottom-panel-toggle" @click="togglePanel" title="折叠面板">━</button>
    </div>
    <div class="bottom-panel-content">
      <!-- Cmd Log Pane -->
      <div class="bottom-panel-pane" :class="{ active: appStore.bottomPanelTab === 'cmdLog' }">
        <div class="pane-toolbar">
          <button @click="clearCmdLogs">清空</button>
        </div>
        <div class="cmd-log-container">
          <div v-if="robotStore.cmdLogs.length === 0" class="empty-state" style="padding: 24px;">暂无指令记录</div>
          <div
            v-for="(entry, idx) in robotStore.cmdLogs"
            :key="idx"
            class="cmd-log-entry"
          >
            <span class="cmd-log-time">{{ entry.time }}</span>
            <span class="cmd-log-dir" :class="entry.direction">{{ entry.direction === 'send' ? '↑' : '↓' }}</span>
            <span class="cmd-log-type">{{ entry.type }}</span>
            <span class="cmd-log-data">{{ entry.data }}</span>
          </div>
        </div>
      </div>
      <!-- SSH Pane -->
      <div class="bottom-panel-pane" :class="{ active: appStore.bottomPanelTab === 'ssh' }">
        <div class="pane-toolbar">
          <span class="ssh-status" style="display: flex; align-items: center; gap: 6px;">
            <span :style="{ width: '8px', height: '8px', borderRadius: '50%', background: appStore.sshConnected ? 'var(--success)' : 'var(--danger)', display: 'inline-block' }"></span>
            <span>{{ appStore.sshConnected ? '已连接' : '未连接' }}</span>
          </span>
          <div style="display: flex; gap: 8px;">
            <button v-if="!appStore.sshConnected" @click="handleSSHConnect">连接</button>
            <button v-else @click="handleSSHDisconnect">断开</button>
          </div>
        </div>
        <div class="ssh-terminal-output">
          <div v-if="robotStore.sshOutput.length === 0" style="color: var(--text-muted); padding: 8px;">
            点击"连接"按钮开始SSH会话
          </div>
          <div v-for="(entry, idx) in robotStore.sshOutput" :key="idx">
            <div v-if="entry.type === 'cmd'" class="ssh-cmd">{{ entry.text }}</div>
            <div v-else-if="entry.type === 'out'" class="ssh-out">{{ entry.text }}</div>
            <div v-else-if="entry.type === 'err'" class="ssh-err">{{ entry.text }}</div>
          </div>
        </div>
        <div class="ssh-input-bar">
          <input
            type="text"
            v-model="sshInput"
            placeholder="输入SSH命令..."
            :disabled="!appStore.sshConnected"
            @keydown="handleSSHInputKeydown"
          />
          <button :disabled="!appStore.sshConnected || !sshInput.trim()" @click="sendSSHCommand">发送</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bottom-panel {
  border-top: 1px solid var(--border); flex-shrink: 0;
  display: flex; flex-direction: column;
}
.bottom-tab-bar {
  display: flex; align-items: center; justify-content: space-between;
  height: 32px; padding: 0 12px; background: var(--bg-tertiary);
  cursor: pointer; flex-shrink: 0;
}
.bottom-tab-buttons { display: flex; gap: 0; }
.bottom-tab {
  padding: 4px 14px; border: none; background: transparent; color: var(--text-muted);
  font-size: 12px; cursor: pointer; border-bottom: 2px solid transparent;
  transition: all 0.15s; white-space: nowrap;
}
.bottom-tab:hover { color: var(--text-primary); }
.bottom-tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }
.bottom-tab .ssh-dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: var(--danger); margin-left: 4px; vertical-align: middle;
}
.bottom-tab .ssh-dot.connected { background: var(--success); }
.bottom-panel-toggle {
  border: none; background: transparent; color: var(--text-muted);
  cursor: pointer; font-size: 14px; padding: 2px 6px; line-height: 1;
}
.bottom-panel-toggle:hover { color: var(--text-primary); }
.bottom-panel-content {
  display: none; height: 250px; max-height: 50vh; overflow: hidden;
  border-top: 1px solid var(--border);
}
.bottom-panel.expanded .bottom-panel-content { display: flex; }
.bottom-panel-pane {
  display: none; flex-direction: column; width: 100%; height: 100%;
}
.bottom-panel-pane.active { display: flex; }
.pane-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border);
  font-size: 12px; flex-shrink: 0; gap: 8px;
}
.pane-toolbar button {
  padding: 2px 8px; font-size: 11px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: var(--bg-tertiary); color: var(--text-secondary);
  cursor: pointer;
}
.pane-toolbar button:hover { background: var(--bg-hover); }
.cmd-log-container {
  flex: 1; overflow-y: auto; padding: 8px 16px;
  font-family: 'SF Mono', Monaco, monospace; font-size: 12px;
}
.cmd-log-entry { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
.cmd-log-time { color: var(--text-muted); margin-right: 8px; }
.cmd-log-dir { margin-right: 6px; }
.cmd-log-dir.send { color: var(--accent); }
.cmd-log-dir.recv { color: var(--success); }
.cmd-log-type { color: var(--warning); margin-right: 8px; }
.cmd-log-data { color: var(--text-secondary); word-break: break-all; }
.ssh-terminal-output {
  flex: 1; overflow-y: auto; padding: 8px 12px; font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px; background: var(--bg-primary); white-space: pre-wrap; word-break: break-all;
}
.ssh-input-bar {
  display: flex; gap: 0; border-top: 1px solid var(--border); background: var(--bg-secondary);
}
.ssh-input-bar input {
  flex: 1; padding: 8px 12px; border: none; background: transparent;
  color: var(--text-primary); font-family: 'SF Mono', Monaco, monospace; font-size: 13px; outline: none;
}
.ssh-input-bar input::placeholder { color: var(--text-muted); }
.ssh-input-bar button {
  padding: 8px 16px; border: none; background: var(--accent);
  color: var(--bg-primary); cursor: pointer; font-size: 13px; font-weight: 500;
}
.ssh-input-bar button:hover { background: #00b8e0; }
.ssh-input-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
.ssh-cmd { color: var(--accent); margin-bottom: 1px; }
.ssh-cmd::before { content: '$ '; opacity: 0.5; }
.ssh-out { color: var(--text-primary); margin-bottom: 1px; white-space: pre-wrap; word-break: break-all; }
.ssh-err { color: var(--danger); margin-bottom: 1px; white-space: pre-wrap; word-break: break-all; }
.empty-state { text-align: center; padding: 48px; color: var(--text-muted); }
</style>
