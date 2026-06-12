<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const mapContainer = ref<HTMLDivElement | null>(null)
let mapInstance: unknown = null
const noGps = ref(false)

onMounted(() => {
  // Check if Leaflet is available
  if (typeof window !== 'undefined' && (window as Record<string, unknown>).L) {
    const L = (window as unknown as { L: Record<string, unknown> }).L
    if (mapContainer.value) {
      mapInstance = (L as Record<string, (id: string) => unknown>).map(mapContainer.value, {
        center: [39.9042, 116.4074],
        zoom: 12,
        zoomControl: false,
      })
      const tileLayer = (L as Record<string, (url: string, opts: Record<string, unknown>) => unknown>).tileLayer(
        'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
        { subdomains: ['1', '2', '3', '4'], maxZoom: 18 }
      )
      ;(tileLayer as Record<string, (m: unknown) => void>).addTo(mapInstance)

      const zoomControl = (L as Record<string, (opts: Record<string, string>) => unknown>).control?.zoom?.({ position: 'topright' })
      if (zoomControl) {
        (zoomControl as Record<string, (m: unknown) => void>).addTo?.(mapInstance)
      }
    }
  } else {
    noGps.value = true
  }
})

onUnmounted(() => {
  if (mapInstance) {
    const m = mapInstance as { remove: () => void }
    m.remove()
    mapInstance = null
  }
})
</script>

<template>
  <div class="view active">
    <div class="map-layout" v-if="!noGps">
      <div class="map-container" ref="mapContainer"></div>
      <div class="map-pip">
        <div class="map-pip-placeholder">📷 摄像头</div>
      </div>
    </div>
    <div class="map-no-gps" v-else>
      <div class="empty-state">设备暂不支持地图功能</div>
    </div>
  </div>
</template>

<style scoped>
.view { display: none; }
.view.active { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow-y: auto; }
.map-layout { position: relative; width: 100%; height: 100%; }
.map-container { width: 100%; height: 100%; border-radius: var(--radius-md); overflow: hidden; }
.map-pip {
  position: absolute; top: 16px; left: 16px; width: 25%; min-width: 200px;
  aspect-ratio: 4/3; background: var(--bg-card); border: 2px solid var(--border);
  border-radius: var(--radius-md); overflow: hidden; z-index: 1000;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
.map-pip-placeholder {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; color: var(--text-muted); font-size: 14px;
}
.map-no-gps { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.empty-state { text-align: center; padding: 48px; color: var(--text-muted); }
</style>
