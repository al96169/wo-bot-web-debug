<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import { useRobotStore } from "@/stores/robot";

const appStore = useAppStore();
const robotStore = useRobotStore();

function goToSoftware() {
  appStore.setView("software");
}

function dismiss() {
  robotStore.dismissSoftwareUpdateBanner();
}
</script>

<template>
  <div
    v-if="robotStore.softwareUpdatesAvailable.length > 0 && !robotStore.softwareUpdateBannerDismissed"
    class="update-banner"
  >
    <div class="update-banner-icon">🎁</div>
    <div class="update-banner-text">
      发现 <strong>{{ robotStore.softwareUpdatesAvailable.length }}</strong> 个可更新软件：
      <template v-for="(u, i) in robotStore.softwareUpdatesAvailable" :key="u.name">
        {{ u.display_name || u.name }}<template v-if="i < robotStore.softwareUpdatesAvailable.length - 1">、</template>
      </template>
    </div>
    <button class="update-banner-action" @click="goToSoftware">去升级</button>
    <button class="update-banner-close" @click="dismiss" title="关闭">×</button>
  </div>
</template>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(135deg, #fff7e6, #ffe7ba);
  border-bottom: 2px solid #fa8c16;
  color: #ad4e00;
  font-size: 13px;
  flex-shrink: 0;
  z-index: 100;
}
.update-banner-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.update-banner-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.update-banner-action {
  padding: 4px 14px;
  background: #fa8c16;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.update-banner-action:hover {
  background: #e0780e;
}
.update-banner-close {
  background: none;
  border: none;
  color: #ad4e00;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  opacity: 0.6;
}
.update-banner-close:hover {
  opacity: 1;
}
</style>
