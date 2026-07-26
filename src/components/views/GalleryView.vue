<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useAppStore } from "@/stores/app";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket, onChunkedDownload } from "@/composables/useWebSocket";
import GalleryPreviewDialog from "@/components/dialogs/GalleryPreviewDialog.vue";
import type { GalleryItem } from "@/types";

const appStore = useAppStore();
const robotStore = useRobotStore();
const { requestGalleryList, sendGalleryDelete, requestMediaDownload } = useWebSocket();

/** 布局模式：grid 网格 / list 列表 */
const layoutMode = ref<"grid" | "list">("grid");
/** 媒体类型筛选 */
const filterType = ref<"all" | "photo" | "video">("all");
/** 多选模式 */
const multiSelectMode = ref(false);
/** 选中的文件名集合 */
const selectedNames = ref<Set<string>>(new Set());
/** 预览项 */
const previewItem = ref<GalleryItem | null>(null);

/** 滚动容器引用（用于分页加载） */
const scrollRef = ref<HTMLElement | null>(null);

const showBatchActions = computed(() => multiSelectMode.value && selectedNames.value.size > 0);

/** 存储空间信息 */
const storage = computed(() => robotStore.galleryStorage);
const storageUsedPercent = computed(() => {
  if (!storage.value || !storage.value.total_bytes) return 0;
  return Math.round((storage.value.used_bytes / storage.value.total_bytes) * 100);
});

function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(s?: number): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

/** 缩略图 data URI */
function thumbSrc(item: GalleryItem): string | undefined {
  if (item.thumbnail_base64) {
    return `data:image/jpeg;base64,${item.thumbnail_base64}`;
  }
  return undefined;
}

/** 刷新列表（首页） */
function refreshList(): void {
  robotStore.resetGallery();
  robotStore.setGalleryLoading(true);
  requestGalleryList(filterType.value, 1, robotStore.galleryPageSize);
}

/** 切换筛选类型 */
function changeFilter(type: "all" | "photo" | "video"): void {
  if (filterType.value === type) return;
  filterType.value = type;
  refreshList();
}

/** 加载更多（下一页） */
function loadMore(): void {
  if (robotStore.galleryLoading || !robotStore.galleryHasMore) return;
  const nextPage = robotStore.galleryPage + 1;
  robotStore.setGalleryLoading(true);
  requestGalleryList(filterType.value, nextPage, robotStore.galleryPageSize);
}

/** 滚动事件：接近底部时加载更多 */
function onScroll(): void {
  const el = scrollRef.value;
  if (!el) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    loadMore();
  }
}

/* ---- 多选 ---- */
function toggleMultiSelect(): void {
  multiSelectMode.value = !multiSelectMode.value;
  selectedNames.value = new Set();
}

function toggleSelect(name: string): void {
  const s = new Set(selectedNames.value);
  if (s.has(name)) {
    s.delete(name);
  } else {
    s.add(name);
  }
  selectedNames.value = s;
}

function selectAll(): void {
  selectedNames.value = new Set(robotStore.gallery.map((g) => g.name));
}

function clearSelection(): void {
  selectedNames.value = new Set();
}

/* ---- 预览 ---- */
function openPreview(item: GalleryItem): void {
  if (multiSelectMode.value) {
    toggleSelect(item.name);
    return;
  }
  previewItem.value = item;
}

function closePreview(): void {
  previewItem.value = null;
}

/** 预览对话框中的下载 */
function onPreviewDownload(fileName: string): void {
  downloadFile(fileName);
}

/* ---- 下载 ---- */
/**
 * 下载单个文件：通过 DC 分块传输
 */
function downloadFile(fileName: string): void {
  appStore.showToast(`正在下载: ${fileName}`, "info");
  // 注册分块下载完成回调
  onChunkedDownload(fileName, (blobUrl) => {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // 延迟释放 blob URL
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    appStore.showToast(`下载完成: ${fileName}`, "success");
  });
  requestMediaDownload(fileName);
}

/** 批量下载选中的文件 */
function downloadSelected(): void {
  const names = Array.from(selectedNames.value);
  if (names.length === 0) return;
  for (const name of names) {
    requestMediaDownload(name);
  }
  appStore.showToast(`正在下载 ${names.length} 个文件`, "info");
}

/* ---- 删除 ---- */
function deleteSelected(): void {
  const names = Array.from(selectedNames.value);
  if (names.length === 0) return;
  if (!confirm(`确定删除选中的 ${names.length} 个文件？删除后不可恢复。`)) return;
  sendGalleryDelete(names);
  selectedNames.value = new Set();
}

function deleteSingle(item: GalleryItem): void {
  if (!confirm(`确定删除 ${item.name}？删除后不可恢复。`)) return;
  sendGalleryDelete([item.name]);
}

onMounted(() => {
  refreshList();
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.addEventListener("scroll", onScroll);
    }
  });
});

onUnmounted(() => {
  if (scrollRef.value) {
    scrollRef.value.removeEventListener("scroll", onScroll);
  }
});
</script>

<template>
  <div class="view active">
    <div class="gallery-layout">
      <!-- 工具栏 -->
      <div class="gallery-toolbar">
        <div class="toolbar-group">
          <button @click="refreshList" :disabled="robotStore.galleryLoading">
            {{ robotStore.galleryLoading ? "加载中..." : "🔄 刷新" }}
          </button>
          <!-- 类型筛选 -->
          <div class="filter-group">
            <button :class="{ active: filterType === 'all' }" @click="changeFilter('all')">全部</button>
            <button :class="{ active: filterType === 'photo' }" @click="changeFilter('photo')">📷 照片</button>
            <button :class="{ active: filterType === 'video' }" @click="changeFilter('video')">🎬 视频</button>
          </div>
        </div>
        <div class="toolbar-group">
          <!-- 布局切换 -->
          <div class="layout-toggle">
            <button :class="{ active: layoutMode === 'grid' }" @click="layoutMode = 'grid'" title="网格布局">▦</button>
            <button :class="{ active: layoutMode === 'list' }" @click="layoutMode = 'list'" title="列表布局">☰</button>
          </div>
          <button :class="{ active: multiSelectMode }" @click="toggleMultiSelect">☑️ 多选</button>
          <template v-if="multiSelectMode">
            <button @click="selectAll">全选</button>
            <button v-if="selectedNames.size > 0" @click="clearSelection">取消选择</button>
          </template>
          <button v-if="showBatchActions" class="btn-download" @click="downloadSelected">
            ⬇️ 下载 ({{ selectedNames.size }})
          </button>
          <button v-if="showBatchActions" class="btn-danger" @click="deleteSelected">
            🗑️ 删除 ({{ selectedNames.size }})
          </button>
        </div>
        <span class="gallery-count">{{ robotStore.gallery.length }} / {{ robotStore.galleryTotal }} 项</span>
      </div>

      <!-- 存储空间信息 -->
      <div v-if="storage" class="storage-info">
        <span class="storage-label">存储空间</span>
        <div class="storage-bar">
          <div class="storage-bar-fill" :style="{ width: storageUsedPercent + '%' }"></div>
        </div>
        <span class="storage-detail">
          {{ formatSize(storage.used_bytes) }} / {{ formatSize(storage.total_bytes) }} （剩余
          {{ formatSize(storage.available_bytes) }}）
        </span>
      </div>

      <!-- 列表区域 -->
      <div ref="scrollRef" class="gallery-scroll">
        <!-- 空状态 -->
        <div v-if="!robotStore.galleryLoading && robotStore.gallery.length === 0" class="empty-state">
          <p>📂 暂无媒体文件</p>
          <p class="hint">在遥控面板拍照或录像后，文件会显示在这里</p>
        </div>

        <!-- 网格布局 -->
        <div v-else-if="layoutMode === 'grid'" class="gallery-grid">
          <div
            v-for="item in robotStore.gallery"
            :key="item.name"
            class="gallery-card"
            :class="{
              selected: selectedNames.has(item.name),
              'show-checkbox': multiSelectMode,
            }"
            @click="openPreview(item)"
          >
            <div
              class="gallery-checkbox"
              :class="{ checked: selectedNames.has(item.name) }"
              @click.stop="toggleSelect(item.name)"
            ></div>
            <div class="gallery-thumb">
              <img v-if="thumbSrc(item)" :src="thumbSrc(item)" alt="thumbnail" />
              <span v-else>{{ item.type === "video" ? "🎬" : "📷" }}</span>
              <span v-if="item.type === 'video'" class="thumb-badge">▶</span>
              <span v-if="item.duration_s" class="thumb-duration">{{ formatDuration(item.duration_s) }}</span>
            </div>
            <div class="gallery-card-info">
              <div class="gallery-card-name" :title="item.name">{{ item.name }}</div>
              <div class="gallery-card-meta">
                <span>{{ formatSize(item.file_size) }}</span>
                <span>{{ item.timestamp }}</span>
              </div>
            </div>
            <button v-if="!multiSelectMode" class="card-delete-btn" @click.stop="deleteSingle(item)" title="删除">
              ✕
            </button>
          </div>
        </div>

        <!-- 列表布局 -->
        <div v-else class="gallery-list">
          <div
            v-for="item in robotStore.gallery"
            :key="item.name"
            class="gallery-list-item"
            :class="{ selected: selectedNames.has(item.name), 'show-checkbox': multiSelectMode }"
            @click="openPreview(item)"
          >
            <div
              class="gallery-checkbox"
              :class="{ checked: selectedNames.has(item.name) }"
              @click.stop="toggleSelect(item.name)"
            ></div>
            <div class="list-thumb">
              <img v-if="thumbSrc(item)" :src="thumbSrc(item)" alt="thumbnail" />
              <span v-else>{{ item.type === "video" ? "🎬" : "📷" }}</span>
              <span v-if="item.type === 'video'" class="thumb-badge">▶</span>
            </div>
            <div class="list-info">
              <div class="list-name" :title="item.name">{{ item.name }}</div>
              <div class="list-meta">
                <span>{{ item.type === "video" ? "视频" : "照片" }}</span>
                <span v-if="item.camera_id !== undefined">摄像头 {{ item.camera_id }}</span>
                <span>{{ formatSize(item.file_size) }}</span>
                <span v-if="item.duration_s">{{ formatDuration(item.duration_s) }}</span>
                <span>{{ item.timestamp }}</span>
              </div>
            </div>
            <div class="list-actions" v-if="!multiSelectMode">
              <button class="list-action-btn" @click.stop="downloadFile(item.name)" title="下载">⬇️</button>
              <button class="list-action-btn danger" @click.stop="deleteSingle(item)" title="删除">🗑️</button>
            </div>
          </div>
        </div>

        <!-- 加载更多提示 -->
        <div v-if="robotStore.galleryLoading" class="load-more-tip">加载中...</div>
        <div v-else-if="!robotStore.galleryHasMore && robotStore.gallery.length > 0" class="load-more-tip">
          没有更多了
        </div>
      </div>
    </div>

    <!-- 预览对话框 -->
    <GalleryPreviewDialog v-if="previewItem" :item="previewItem" @close="closePreview" @download="onPreviewDownload" />
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
}
.gallery-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.gallery-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.toolbar-group {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.gallery-toolbar button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.gallery-toolbar button:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.gallery-toolbar button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.gallery-toolbar button.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg-primary);
}
.filter-group,
.layout-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.filter-group button,
.layout-toggle button {
  border: none;
  border-radius: 0;
  padding: 6px 10px;
  font-size: 12px;
}
.filter-group button:not(:last-child),
.layout-toggle button:not(:last-child) {
  border-right: 1px solid var(--border);
}
.btn-download {
  border-color: var(--accent) !important;
  color: var(--accent) !important;
}
.btn-download:hover:not(:disabled) {
  background: var(--accent) !important;
  color: var(--bg-primary) !important;
}
.btn-danger {
  border-color: var(--danger) !important;
  color: var(--danger) !important;
}
.btn-danger:hover:not(:disabled) {
  background: var(--danger) !important;
  color: #fff !important;
}
.gallery-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}

/* 存储信息 */
.storage-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.storage-label {
  font-weight: 600;
  white-space: nowrap;
}
.storage-bar {
  flex: 1;
  max-width: 240px;
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}
.storage-bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
.storage-detail {
  color: var(--text-muted);
  white-space: nowrap;
}

/* 滚动区 */
.gallery-scroll {
  flex: 1;
  overflow-y: auto;
  padding-top: 12px;
  min-height: 0;
}

/* 网格布局 */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
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
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 28px;
  position: relative;
  overflow: hidden;
}
.gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.thumb-duration {
  position: absolute;
  bottom: 4px;
  right: 4px;
  font-size: 10px;
  color: #fff;
  background: rgba(0, 0, 0, 0.7);
  padding: 1px 5px;
  border-radius: 3px;
  pointer-events: none;
}
.gallery-card-info {
  padding: 6px 8px;
}
.gallery-card-name {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gallery-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 2px;
}
.card-delete-btn {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
.gallery-card:hover .card-delete-btn {
  display: flex;
}
.card-delete-btn:hover {
  background: var(--danger);
}

/* 列表布局 */
.gallery-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gallery-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 0.15s;
  position: relative;
}
.gallery-list-item:hover {
  border-color: var(--accent);
}
.gallery-list-item.selected {
  border-color: var(--accent);
  background: var(--bg-hover);
}
.gallery-list-item .gallery-checkbox {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-radius: 4px;
  background: var(--bg-card);
  cursor: pointer;
  display: none;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.gallery-list-item.show-checkbox .gallery-checkbox {
  display: flex;
}
.gallery-list-item .gallery-checkbox.checked {
  background: var(--accent);
  border-color: var(--accent);
}
.gallery-list-item .gallery-checkbox.checked::after {
  content: "\2713";
  color: var(--bg-primary);
  font-size: 12px;
  font-weight: bold;
}
.list-thumb {
  width: 64px;
  height: 48px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 20px;
  flex-shrink: 0;
  overflow: hidden;
  position: relative;
}
.list-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.list-info {
  flex: 1;
  min-width: 0;
}
.list-name {
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.list-meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  flex-wrap: wrap;
}
.list-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.list-action-btn {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  cursor: pointer;
  font-size: 13px;
}
.list-action-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}
.list-action-btn.danger:hover {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}

/* 空状态 / 加载提示 */
.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}
.empty-state .hint {
  font-size: 12px;
  margin-top: 8px;
}
.load-more-tip {
  text-align: center;
  padding: 16px;
  color: var(--text-muted);
  font-size: 12px;
}
</style>
