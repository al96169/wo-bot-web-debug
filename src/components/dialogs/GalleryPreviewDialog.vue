<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import type { GalleryItem } from "@/types";
import { useWebSocket, onChunkedDownload } from "@/composables/useWebSocket";

const props = defineProps<{
  item: GalleryItem;
}>();

const emit = defineEmits<{
  close: [];
  download: [fileName: string];
}>();

const { requestMediaDownload } = useWebSocket();

const isVideo = computed(() => props.item.type === "video");
const videoBlobUrl = ref<string | null>(null);
const videoLoading = ref(false);
const downloadProgress = ref(0);

/** 缩略图 data URI */
const thumbSrc = computed(() => {
  if (props.item.thumbnail_base64) {
    return `data:image/jpeg;base64,${props.item.thumbnail_base64}`;
  }
  return null;
});

/** 监听分块下载完成 */
let _unregisterChunked: (() => void) | null = null;

watch(
  () => props.item,
  (item) => {
    if (!item || item.type !== "video") return;
    // 请求视频文件（后端会分块发送）
    videoLoading.value = true;
    videoBlobUrl.value = null;
    downloadProgress.value = 0;
    requestMediaDownload(item.name);

    // 注册分块下载完成回调
    _unregisterChunked?.();
    _unregisterChunked = onChunkedDownload(item.name, (blobUrl) => {
      videoBlobUrl.value = blobUrl;
      videoLoading.value = false;
      downloadProgress.value = 100;
    });
  },
  { immediate: true },
);

onUnmounted(() => {
  _unregisterChunked?.();
  if (videoBlobUrl.value) URL.revokeObjectURL(videoBlobUrl.value);
});

function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(s?: number): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

function onDownload() {
  emit("download", props.item.name);
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog gallery-preview-dialog">
      <div class="gallery-preview-header">
        <span class="preview-title" :title="item.name">
          {{ isVideo ? "🎬" : "📷" }} {{ item.name }}
        </span>
        <div class="preview-actions">
          <button class="btn-secondary" @click="onDownload">⬇️ 下载</button>
          <button class="btn-secondary" @click="emit('close')">关闭</button>
        </div>
      </div>
      <div class="gallery-preview-meta">
        <span>{{ isVideo ? "视频" : "照片" }}</span>
        <span v-if="item.camera_id !== undefined">摄像头 {{ item.camera_id }}</span>
        <span>{{ formatSize(item.file_size) }}</span>
        <span v-if="isVideo && item.duration_s">时长 {{ formatDuration(item.duration_s) }}</span>
        <span>{{ item.timestamp }}</span>
      </div>
      <div class="gallery-preview-body">
        <!-- 图片预览 -->
        <template v-if="!isVideo">
          <img v-if="thumbSrc" :src="thumbSrc" alt="Preview" />
          <div v-else class="preview-empty">📷 暂无预览图</div>
        </template>
        <!-- 视频预览 -->
        <template v-else>
          <video
            v-if="videoBlobUrl"
            :src="videoBlobUrl"
            :poster="thumbSrc || undefined"
            controls
            autoplay
            class="preview-video"
          ></video>
          <div v-else-if="videoLoading" class="preview-empty">
            <img v-if="thumbSrc" :src="thumbSrc" alt="cover" class="preview-cover" />
            <p>⏳ 正在加载视频...</p>
          </div>
          <div v-else class="preview-empty">
            <img v-if="thumbSrc" :src="thumbSrc" alt="cover" class="preview-cover" />
            <p>🎬 视频封面</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
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
  display: flex;
  flex-direction: column;
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
  margin-bottom: 8px;
  gap: 12px;
}
.preview-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.preview-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.gallery-preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.gallery-preview-body {
  text-align: center;
  overflow: auto;
}
.gallery-preview-body img {
  max-width: 100%;
  max-height: 65vh;
  border-radius: var(--radius-md);
  object-fit: contain;
}
.preview-video {
  max-width: 100%;
  max-height: 65vh;
  border-radius: var(--radius-md);
  background: #000;
}
.preview-empty {
  color: var(--text-muted);
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.preview-cover {
  max-width: 100%;
  max-height: 40vh;
  border-radius: var(--radius-md);
}
.btn-secondary {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  white-space: nowrap;
}
.btn-secondary:hover {
  background: var(--bg-hover);
  border-color: var(--accent);
}
</style>
