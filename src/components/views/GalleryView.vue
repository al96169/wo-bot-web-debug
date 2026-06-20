<script setup lang="ts">
import { ref, computed } from "vue";
import { useRobotStore } from "@/stores/robot";
import GalleryPreviewDialog from "@/components/dialogs/GalleryPreviewDialog.vue";
import type { GalleryItem } from "@/types";

const robotStore = useRobotStore();

const selectedItems = ref<Set<string>>(new Set());
const multiSelectMode = ref(false);
const previewItem = ref<GalleryItem | null>(null);

const showDownloadBtn = computed(() => multiSelectMode.value && selectedItems.value.size > 0);

function toggleMultiSelect() {
  multiSelectMode.value = !multiSelectMode.value;
  selectedItems.value = new Set();
}

function toggleSelect(id: string) {
  if (!multiSelectMode.value) return;
  const s = new Set(selectedItems.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  selectedItems.value = s;
}

function openPreview(item: GalleryItem) {
  if (multiSelectMode.value) {
    toggleSelect(item.id);
    return;
  }
  previewItem.value = item;
}

function closePreview() {
  previewItem.value = null;
}

function downloadSelected() {
  // Mock download
  alert(`下载 ${selectedItems.value.size} 个文件`);
}
</script>

<template>
  <div class="view active">
    <div class="gallery-layout">
      <div class="gallery-toolbar">
        <button @click="() => {}">🔄 刷新</button>
        <button :class="{ active: multiSelectMode }" @click="toggleMultiSelect">☑️ 多选</button>
        <button v-if="showDownloadBtn" @click="downloadSelected">⬇️ 下载选中</button>
        <span class="gallery-count">{{ robotStore.gallery.length }} 项</span>
      </div>
      <div class="gallery-grid">
        <div v-if="robotStore.gallery.length === 0" class="empty-state">暂无图片</div>
        <div
          v-for="item in robotStore.gallery"
          :key="item.id"
          class="gallery-card"
          :class="{
            selected: selectedItems.has(item.id),
            'show-checkbox': multiSelectMode,
          }"
          @click="openPreview(item)"
        >
          <div
            class="gallery-checkbox"
            :class="{ checked: selectedItems.has(item.id) }"
            @click.stop="toggleSelect(item.id)"
          ></div>
          <div class="gallery-thumb">
            {{ item.name.endsWith(".mp4") ? "🎬" : "📷" }}
          </div>
          <div class="gallery-card-info">
            <div class="gallery-card-name">{{ item.name }}</div>
          </div>
        </div>
      </div>
    </div>

    <GalleryPreviewDialog v-if="previewItem" :name="previewItem.name" :url="previewItem.url" @close="closePreview" />
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
.gallery-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.gallery-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.gallery-toolbar button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}
.gallery-toolbar button:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.gallery-toolbar button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}
.gallery-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}
.gallery-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  padding-top: 12px;
  align-content: start;
}
.gallery-card {
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
  position: relative;
}
.gallery-card:hover {
  border-color: var(--accent);
}
.gallery-card.selected {
  border-color: var(--accent);
}
.gallery-card .gallery-checkbox {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-radius: 4px;
  background: var(--bg-card);
  z-index: 2;
  display: none;
  cursor: pointer;
}
.gallery-card.show-checkbox .gallery-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
}
.gallery-card .gallery-checkbox.checked {
  background: var(--accent);
  border-color: var(--accent);
}
.gallery-card .gallery-checkbox.checked::after {
  content: "\2713";
  color: var(--bg-primary);
  font-size: 12px;
  font-weight: bold;
}
.gallery-thumb {
  width: 100%;
  aspect-ratio: 4/3;
  object-fit: cover;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 24px;
}
.gallery-card-info {
  padding: 8px 10px;
}
.gallery-card-name {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
