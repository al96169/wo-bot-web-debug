<script setup lang="ts">
import { ref, computed } from "vue";
import { useRobotStore } from "@/stores/robot";
import MessageDetailDialog from "@/components/dialogs/MessageDetailDialog.vue";
import type { Message } from "@/types";

const robotStore = useRobotStore();

const searchQuery = ref("");
const detailMessageId = ref<string | null>(null);

const filteredMessages = computed(() => {
  let msgs = [...robotStore.messages];
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    msgs = msgs.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        (m.source ?? "").toLowerCase().includes(q),
    );
  }
  return msgs;
});

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function openDetail(msg: Message) {
  robotStore.selectedMessageId = msg.id;
  detailMessageId.value = msg.id;
  // Mark as read
  robotStore.markMessageRead(msg.id, true);
}

function closeDetail() {
  detailMessageId.value = null;
  robotStore.selectedMessageId = null;
}

function markUnread() {
  if (detailMessageId.value) {
    robotStore.markMessageRead(detailMessageId.value, false);
  }
  closeDetail();
}
</script>

<template>
  <div class="view active">
    <h2>消息</h2>
    <div class="messages-layout">
      <div class="messages-list-panel messages-full">
        <div class="messages-search">
          <input v-model="searchQuery" type="text" placeholder="搜索消息..." />
        </div>
        <div class="messages-list">
          <div v-if="filteredMessages.length === 0" class="empty-state">暂无消息</div>
          <div
            v-for="msg in filteredMessages"
            :key="msg.id"
            class="message-item"
            :class="{ unread: !msg.read, active: robotStore.selectedMessageId === msg.id }"
            @click="openDetail(msg)"
          >
            <div class="message-item-header">
              <span class="message-item-subject">{{ msg.subject }}</span>
              <span class="message-item-time">{{ fmtTime(msg.time) }}</span>
            </div>
            <div class="message-item-summary">
              {{ msg.summary || msg.body.slice(0, 60) }}{{ (msg.summary || msg.body).length > 60 ? "..." : "" }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <MessageDetailDialog
      v-if="detailMessageId"
      :message-id="detailMessageId"
      @close="closeDetail"
      @mark-unread="markUnread"
    />
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
.messages-layout {
  display: flex;
  gap: 16px;
  height: 100%;
}
.messages-list-panel {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.messages-list-panel.messages-full {
  width: 100%;
  flex: 1;
}
.messages-search input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
}
.messages-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.message-item {
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
}
.message-item:hover {
  border-color: var(--accent);
}
.message-item.active {
  border-color: var(--accent);
  background: rgba(0, 212, 255, 0.06);
}
.message-item.unread {
  border-left: 3px solid var(--accent);
}
.message-item-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.message-item-subject {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}
.message-item-time {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.message-item-summary {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
