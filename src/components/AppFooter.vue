<script setup lang="ts"></script>

<template>
  <footer class="app-footer">
    <span class="project-name">wo-bot Web Debug</span>
    <span class="footer-divider">·</span>
    <span>v1.1.0</span>
    <span class="footer-divider">·</span>
    <a href="https://github.com/antonioliang/wo-bot" target="_blank" rel="noopener" class="github-link">GitHub ↗</a>
    <span class="footer-divider">·</span>
    <span>© 2024 wo-bot</span>
  </footer>
</template>

<style scoped>
.app-footer {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 20px;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
