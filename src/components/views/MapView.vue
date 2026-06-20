<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";

const mapContainer = ref<HTMLDivElement | null>(null);
let mapInstance: any = null;
const noGps = ref(false);

onMounted(() => {
  // Leaflet 通过 CDN 动态加载，无类型声明
  const win = window as any;
  if (win.L && mapContainer.value) {
    const L = win.L;
    mapInstance = L.map(mapContainer.value, {
      center: [39.9042, 116.4074],
      zoom: 12,
      zoomControl: false,
    });
    const tileLayer = L.tileLayer(
      "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
      { subdomains: ["1", "2", "3", "4"], maxZoom: 18 },
    );
    tileLayer.addTo(mapInstance);

    const zoomControl = L.control?.zoom?.({ position: "topright" });
    if (zoomControl) {
      zoomControl.addTo?.(mapInstance);
    }
  } else {
    noGps.value = true;
  }
});

onUnmounted(() => {
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
});
</script>

<template>
  <div class="view active">
    <div v-if="!noGps" class="map-layout">
      <div ref="mapContainer" class="map-container"></div>
      <div class="map-pip">
        <div class="map-pip-placeholder">📷 摄像头</div>
      </div>
    </div>
    <div v-else class="map-no-gps">
      <div class="empty-state">设备暂不支持地图功能</div>
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
.map-layout {
  position: relative;
  width: 100%;
  height: 100%;
}
.map-container {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-md);
  overflow: hidden;
}
.map-pip {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 25%;
  min-width: 200px;
  aspect-ratio: 4/3;
  background: var(--bg-card);
  border: 2px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  z-index: 1000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.map-pip-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-muted);
  font-size: 14px;
}
.map-no-gps {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.empty-state {
  text-align: center;
  padding: 48px;
  color: var(--text-muted);
}
</style>
