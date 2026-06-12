import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import mdnsDiscovery from './src/plugins/mdnsDiscovery'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), mdnsDiscovery()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 9093,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 9093,
    },
  },
})
