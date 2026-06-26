<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, onErrorCaptured } from "vue";
import { useAppStore } from "@/stores/app";
import { useRobotStore } from "@/stores/robot";
import { useWebSocket } from "@/composables/useWebSocket";

const appStore = useAppStore();
const robotStore = useRobotStore();
const { sendMusicCommand, sendServiceControl } = useWebSocket();

// ---- 响应式状态 ----
const music = computed(() => robotStore.musicStatus);
const songs = computed(() => robotStore.musicSongs);
const isWsConnected = computed(() => appStore.connection === "connected");
const isMusicServiceRunning = computed(() =>
  robotStore.services.some(
    (s) => s.service_id === "music_player" && s.status === "running"
  )
);

// 标签页状态
type TabKey = "local" | "playlist" | "stream";
const activeTab = ref<TabKey>("local");
// 添加到播放队列的反馈消息
const toastMsg = ref("");
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(msg: string) {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMsg.value = ""; }, 2000);
}

// 是否显示底部播放栏（本地播放需要 current_track；推流播放只需要 status 为 playing）
const showPlayerBar = computed(() => {
  const isActive = music.value?.status === "playing" || music.value?.status === "paused";
  if (!isActive) return false;
  // DLNA/AirPlay 推流播放：status 为 playing 就显示（active_source 可能因时序稍后设置）
  if (music.value?.status === "playing" && !music.value?.current_track) {
    return true;
  }
  if (music.value?.active_source === "dlna" || music.value?.active_source === "airplay") {
    return true;
  }
  // 本地播放：需要当前曲目信息
  return music.value?.current_track != null;
});

// 是否为远程推流源（DLNA/AirPlay），这些源无法控制进度/上下一首/暂停
const isRemoteSource = computed(() => {
  const src = music.value?.active_source;
  if (src === "dlna" || src === "airplay") return true;
  // active_source 可能因时序尚未设置，但播放中且无曲目信息就是远程推流
  if (music.value?.status === "playing" && !music.value?.current_track) return true;
  return false;
});

// 格式化
function formatTime(seconds: number): string {
  if (!seconds || seconds < 0 || seconds === Infinity) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "--";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const progressPercent = computed(() => {
  const track = music.value?.current_track;
  if (!track) return 0;
  const dur = track.duration || estimatedDuration.value;
  if (dur <= 0) return 0;
  return Math.min(100, (music.value.position / dur) * 100);
});

const estimatedDuration = computed(() => {
  const track = music.value?.current_track;
  if (!track) return 0;
  // 优先使用 ffprobe 检测的实际时长
  if (track.duration && track.duration > 0) return track.duration;
  // 回退到文件大小估算（1MB ≈ 60秒）
  if (track.size) return (track.size / (1024 * 1024)) * 60;
  return 0;
});

const displayDuration = computed(() => {
  return estimatedDuration.value || 0;
});

// ---- 操作 ----
function playSong(filename: string) {
  sendMusicCommand("music_play", { filename });
}

function togglePlay() {
  if (music.value?.status === "playing") {
    sendMusicCommand("music_pause", {});
  } else if (music.value?.status === "paused") {
    sendMusicCommand("music_resume", {});
  } else if (songs.value.length > 0) {
    playSong(songs.value[0].filename);
  }
}

function stopMusic() {
  sendMusicCommand("music_stop", {});
}

function nextTrack() {
  sendMusicCommand("music_next", {});
}

function prevTrack() {
  sendMusicCommand("music_previous", {});
}

function seekMusic(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const dur = displayDuration.value;
  if (dur <= 0) return;
  const position = ratio * dur;
  sendMusicCommand("music_seek", { position });
}

function setVolume(val: number) {
  sendMusicCommand("music_volume", { volume: Math.round(val) });
}

function addToPlaylist(filename: string) {
  const song = songs.value.find((s) => s.filename === filename);
  sendMusicCommand("music_playlist_add", { filename });
  showToast(`已添加: ${song?.name || filename}`);
}

function removeFromPlaylist(index: number) {
  sendMusicCommand("music_playlist_remove", { index });
}

function clearPlaylist() {
  sendMusicCommand("music_playlist_clear", {});
}

function refreshSongs() {
  sendMusicCommand("music_list", {});
}

function startMusicService() {
  sendServiceControl("music_player", "start");
}

// ---- 生命周期 ----
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  refreshSongs();
  refreshTimer = setInterval(() => {
    sendMusicCommand("music_status", {});
  }, 2000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});

onErrorCaptured((err, _instance, info) => {
  console.error("[MusicView] 渲染异常:", err, "| info:", info);
  return false;
});
</script>

<template>
  <div class="music-view">
    <!-- 连接/服务提示 -->
    <div v-if="!isWsConnected || (isWsConnected && !isMusicServiceRunning)" class="banner-top">
      <div v-if="!isWsConnected" class="service-banner disconnect">
        <span class="banner-icon">🔌</span>
        <span>与机器人连接已断开</span>
      </div>
      <div v-else-if="!isMusicServiceRunning" class="service-banner">
        <span class="banner-icon">⚠️</span>
        <span>音乐播放服务未运行</span>
        <button class="btn-sm primary" @click="startMusicService">▶ 启动</button>
      </div>
    </div>

    <!-- Toast 反馈 -->
    <Transition name="toast-fade">
      <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
    </Transition>

    <!-- ---- Tab 导航 ---- -->
    <div class="tab-nav">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'local' }"
        @click="activeTab = 'local'"
      >
        🎵 本地音乐
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'playlist' }"
        @click="activeTab = 'playlist'"
      >
        📋 播放列表
        <span v-if="music.playlist?.length" class="tab-badge">{{ music.playlist.length }}</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'stream' }"
        @click="activeTab = 'stream'"
      >
        📡 投播服务
      </button>
    </div>

    <!-- ---- Tab: 本地音乐 ---- -->
    <div v-if="activeTab === 'local'" class="tab-content">
      <div class="section-header">
        <span>共 {{ songs.length }} 首</span>
        <button class="btn-sm" @click="refreshSongs">🔄 刷新</button>
      </div>
      <div v-if="songs.length > 0" class="song-list scrollable">
        <div
          v-for="song in songs"
          :key="song.filename"
          class="song-row"
          :class="{ active: music.current_track?.filename === song.filename }"
        >
          <div class="song-main" @click="playSong(song.filename)">
            <span class="song-icon">{{
              music.current_track?.filename === song.filename && music.status === "playing"
                ? "🔊"
                : "🎵"
            }}</span>
            <div class="song-text">
              <span class="song-title">{{ song.name }}</span>
              <span class="song-sub">{{ (song.format || "").toUpperCase() }} · {{ formatSize(song.size) }}</span>
            </div>
          </div>
          <button class="btn-icon-sm" title="添加到队列" @click="addToPlaylist(song.filename)">➕</button>
        </div>
      </div>
      <div v-else class="empty-hint">
        <p>暂无歌曲</p>
        <p class="sub">将音乐文件放入机器人的 ~/media/music 目录</p>
      </div>
    </div>

    <!-- ---- Tab: 播放列表 ---- -->
    <div v-if="activeTab === 'playlist'" class="tab-content">
      <div v-if="music.playlist?.length" class="section-header">
        <span>共 {{ music.playlist.length }} 首</span>
        <button class="btn-sm danger" @click="clearPlaylist">清空</button>
      </div>
      <div v-if="music.playlist?.length" class="song-list scrollable">
        <div
          v-for="(track, idx) in music.playlist"
          :key="idx"
          class="song-row"
          :class="{ active: music.current_track?.filename === track.filename }"
        >
          <div class="song-main" @click="playSong(track.filename)">
            <span class="song-idx">{{ idx + 1 }}</span>
            <span class="song-title">{{ track.name }}</span>
          </div>
          <button class="btn-icon-sm" title="移除" @click="removeFromPlaylist(idx)">✖</button>
        </div>
      </div>
      <div v-else class="empty-hint">
        <p>播放列表为空</p>
        <p class="sub">从本地音乐中添加歌曲到播放队列</p>
      </div>
    </div>

    <!-- ---- Tab: 投播服务状态 ---- -->
    <div v-if="activeTab === 'stream'" class="tab-content">
      <div class="stream-list">
        <div v-for="svc in ['dlna', 'airplay', 'rtmp']" :key="svc" class="stream-card">
          <div class="stream-head">
            <span class="stream-name">{{ svc === 'dlna' ? 'DLNA / UPnP' : svc === 'airplay' ? 'AirPlay' : 'RTMP / HLS' }}</span>
            <span
              class="stream-status"
              :class="{ online: (music.active_services || []).includes(svc) }"
            >
              {{ (music.active_services || []).includes(svc) ? '● 运行中' : '○ 未启动' }}
            </span>
          </div>
          <div class="stream-detail">
            <span v-if="svc === 'dlna'">设备名: Wo-Bot · 端口: 49452</span>
            <span v-else-if="svc === 'airplay'">设备名: Wo-Bot · 协议: RAOP</span>
            <span v-else>地址: rtmp://192.168.1.47/live/wobot</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ---- 底部播放栏 ---- -->
    <div v-if="showPlayerBar" class="player-bar">
      <!-- 进度条：远程源不可拖动 -->
      <div
        class="bar-progress"
        :class="{ readonly: isRemoteSource }"
        @click="!isRemoteSource && seekMusic($event)"
      >
        <div class="bar-fill" :style="{ width: progressPercent + '%' }"></div>
      </div>
      <!-- 信息 + 控制 -->
      <div class="bar-row">
        <div class="bar-info">
          <div class="bar-cover">{{ music.active_source === 'dlna' ? '📡' : music.active_source === 'airplay' ? '🍎' : '🎵' }}</div>
          <div class="bar-text">
            <!-- DLNA/AirPlay 播放时显示来源信息 -->
            <div v-if="music.active_source === 'dlna'" class="bar-title">DLNA 推流播放中</div>
            <div v-else-if="music.active_source === 'airplay'" class="bar-title">AirPlay 推流播放中</div>
            <div v-else-if="isRemoteSource && !music.active_source" class="bar-title">推流播放中</div>
            <div v-else class="bar-title">{{ music.current_track?.name || "--" }}</div>
            <div class="bar-time">
              <template v-if="isRemoteSource || music.active_source === 'dlna' || music.active_source === 'airplay'">
                {{ formatTime(music.position) }}
                <span class="source-tag">{{ music.active_source === 'dlna' ? 'DLNA' : music.active_source === 'airplay' ? 'AirPlay' : '推流' }}</span>
              </template>
              <template v-else>
                {{ formatTime(music.position) }} / {{ formatTime(displayDuration) }}
              </template>
            </div>
          </div>
        </div>
        <div class="bar-ctrls">
          <!-- 远程源（DLNA/AirPlay）无法控制播放，不显示任何按钮 -->
          <template v-if="!isRemoteSource">
            <button class="ctrl-btn-sm" title="上一首" @click="prevTrack">⏮</button>
            <button class="ctrl-btn-sm play-btn-sm" :title="music.status === 'playing' ? '暂停' : '播放'" @click="togglePlay">
              {{ music.status === "playing" ? "⏸" : "▶️" }}
            </button>
            <button class="ctrl-btn-sm" title="下一首" @click="nextTrack">⏭</button>
            <button class="ctrl-btn-sm" title="停止" @click="stopMusic">⏹</button>
          </template>
        </div>
        <div class="bar-volume">
          <span class="vol-icon">🔊</span>
          <input
            type="range"
            min="0"
            max="100"
            :value="music.volume"
            class="vol-slider"
            @input="(e) => setVolume(Number((e.target as HTMLInputElement).value))"
          />
          <span class="vol-val">{{ music.volume }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.music-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding-bottom: 0;
  position: relative;
  overflow: hidden;
}

/* ---- 顶部提示 ---- */
.banner-top {
  flex-shrink: 0;
  padding: 0 16px 8px;
}
.service-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 193, 7, 0.08);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 8px;
  font-size: 13px;
}
.banner-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.service-banner.disconnect {
  background: rgba(255, 71, 87, 0.08);
  border-color: rgba(255, 71, 87, 0.3);
}
.btn-sm {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.btn-sm:hover {
  background: var(--bg-hover);
}
.btn-sm.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  margin-left: auto;
}
.btn-sm.danger {
  color: var(--danger);
}
.btn-sm.danger:hover {
  background: rgba(255, 71, 87, 0.1);
}

/* ---- Toast ---- */
.toast {
  position: fixed;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 999;
  padding: 8px 20px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 13px;
  border-radius: 20px;
  pointer-events: none;
  white-space: nowrap;
}
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.3s;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
}

/* ---- Tab 导航 ---- */
.tab-nav {
  display: flex;
  gap: 0;
  padding: 0 16px 0;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}
.tab-btn {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  position: relative;
  transition: color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.tab-btn:hover {
  color: var(--text-secondary);
}
.tab-btn.active {
  color: var(--text-primary);
  font-weight: 600;
}
.tab-btn.active::after {
  content: "";
  position: absolute;
  bottom: -1px;
  left: 16px;
  right: 16px;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
}
.tab-badge {
  font-size: 11px;
  background: var(--accent);
  color: #000;
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 18px;
  text-align: center;
}

/* ---- Tab 内容 ---- */
.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 16px 0;
  overflow: hidden;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* 歌曲列表 */
.scrollable {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.song-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.song-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  transition: border-color 0.15s;
}
.song-row:hover {
  border-color: var(--accent);
}
.song-row.active {
  border-color: var(--accent);
  background: rgba(0, 212, 255, 0.06);
}
.song-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.song-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.song-idx {
  font-size: 13px;
  color: var(--text-muted);
  min-width: 22px;
  text-align: center;
  flex-shrink: 0;
}
.song-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.song-title {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-sub {
  font-size: 11px;
  color: var(--text-muted);
}
.btn-icon-sm {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.btn-icon-sm:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 空状态 */
.empty-hint {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 14px;
  gap: 4px;
}
.empty-hint .sub {
  font-size: 12px;
  opacity: 0.7;
}

/* ---- 投播服务 ---- */
.stream-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stream-card {
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
}
.stream-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.stream-name {
  font-size: 14px;
  font-weight: 600;
}
.stream-status {
  font-size: 12px;
  color: var(--text-muted);
}
.stream-status.online {
  color: var(--success);
}
.stream-detail {
  font-size: 12px;
  color: var(--text-muted);
}

/* ---- 底部播放栏 ---- */
.player-bar {
  flex-shrink: 0;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  padding: 0;
}
.bar-progress {
  height: 3px;
  background: var(--bg-tertiary);
  cursor: pointer;
}
.bar-progress.readonly {
  cursor: default;
}
.bar-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s linear;
  border-radius: 0 2px 2px 0;
}
.bar-row {
  display: flex;
  align-items: center;
  padding: 8px 14px;
  gap: 12px;
}
.bar-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.bar-cover {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.bar-text {
  min-width: 0;
  flex: 1;
}
.bar-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.bar-time {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
}
.source-tag {
  display: inline-block;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--accent);
  color: #000;
  margin-left: 4px;
  vertical-align: middle;
  font-weight: 600;
}
.bar-ctrls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.ctrl-btn-sm {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.ctrl-btn-sm:hover {
  border-color: var(--accent);
}
.ctrl-btn-sm.play-btn-sm {
  width: 40px;
  height: 40px;
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-size: 16px;
}
.bar-volume {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  max-width: 140px;
}
.vol-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.vol-slider {
  width: 60px;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-tertiary);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.vol-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}
.vol-val {
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 24px;
  text-align: right;
}
</style>
