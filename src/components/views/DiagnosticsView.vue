<script setup lang="ts">
import { computed } from "vue";
import { useAppStore } from "@/stores/app";
import { useWebSocket } from "@/composables/useWebSocket";

/**
 * 硬件诊断页
 *
 * 数据来自**独立诊断子服务**（systemd: wobot-diagnostics），
 * 由主服务经 WebSocket 推送（本项目约定，前端不做 REST 轮询）。
 *
 * 排版对齐 StatusView：分区标题 + run-card 统计卡 + 明细列表。
 */
const appStore = useAppStore();
const { sendWheelSelftest } = useWebSocket();

interface DiagCheck {
  name: string;
  kind: string;
  status: "ok" | "warn" | "fail";
  failure_class?: "hw" | "link" | "cfg" | null;
  detail: string;
}

const report = computed(() => appStore.diagnostics as Record<string, unknown> | null);
const offline = computed(() => Boolean(report.value && report.value.error));
const checks = computed<DiagCheck[]>(() => {
  const list = report.value?.checks;
  return Array.isArray(list) ? (list as DiagCheck[]) : [];
});
const counts = computed(() => {
  const c = report.value?.counts as Record<string, number> | undefined;
  return {
    ok: c?.ok ?? checks.value.filter((x) => x.status === "ok").length,
    warn: c?.warn ?? checks.value.filter((x) => x.status === "warn").length,
    fail: c?.fail ?? checks.value.filter((x) => x.status === "fail").length,
  };
});
const overall = computed(() => String(report.value?.overall ?? "unknown"));

const FAILURE_LABELS: Record<string, string> = {
  hw: "硬件",
  link: "数据链",
  cfg: "配置",
};

const STATUS_LABELS: Record<string, string> = {
  ok: "正常",
  warn: "注意",
  fail: "异常",
};

function statusIcon(s: string): string {
  if (s === "ok") return "✅";
  if (s === "warn") return "⚠️";
  return "🔴";
}
</script>

<template>
  <div class="view active">
    <h2>🩺 硬件诊断</h2>
    <div class="status-detailed">
      <div class="status-section">
        <h3>
          整机检查
          <span class="diag-overall" :class="'diag-' + overall">{{ STATUS_LABELS[overall] || overall }}</span>
        </h3>

        <div class="diag-actions">
          <button class="diag-btn" @click="sendWheelSelftest()">🔧 轮子自检（会短暂移动）</button>
          <span class="diag-hint">用于发现"静止时看不出来"的卡滞轮子：会前进约 24cm 并对比四轮编码器增量</span>
        </div>
        <div v-if="appStore.wheelSelftest" class="diag-selftest">
          <p>
            自检结果：<b :class="appStore.wheelSelftest.ok ? 'diag-ok' : 'diag-fail'">
              {{ appStore.wheelSelftest.ok ? "全部正常" : "有轮子未转动" }}
            </b>
            <span v-if="(appStore.wheelSelftest.bad_wheels as string[])?.length">
              — {{ (appStore.wheelSelftest.bad_wheels as string[]).join(", ") }}
            </span>
          </p>
          <div
            v-for="r in (appStore.wheelSelftest.rows as any[]) || []"
            :key="r.wheel"
            class="diag-row"
            :class="r.ok ? 'diag-row-ok' : 'diag-row-fail'"
          >
            <span class="diag-icon">{{ r.ok ? "✅" : "🔴" }}</span>
            <span class="diag-name">{{ r.wheel }}</span>
            <span class="diag-detail">Δ{{ r.delta }}</span>
          </div>
          <p v-if="appStore.wheelSelftest.note" class="diag-hint">{{ appStore.wheelSelftest.note }}</p>
        </div>
        <p v-if="offline" class="diag-offline">
          诊断子服务不可达：{{ report?.error }}<br />
          <span class="diag-hint"
            >（主服务仍在运行；诊断服务是独立进程，可单独重启：systemctl restart wobot-diagnostics）</span
          >
        </p>

        <p v-else-if="!report" class="diag-hint">等待诊断数据…（诊断服务每 2 秒推送一次）</p>

        <template v-else>
          <div class="status-run-cards diag-cards">
            <div class="run-card">
              <div class="run-card-icon">✅</div>
              <div class="run-card-value">{{ counts.ok }}</div>
              <div class="run-card-label">正常</div>
            </div>
            <div class="run-card">
              <div class="run-card-icon">⚠️</div>
              <div class="run-card-value">{{ counts.warn }}</div>
              <div class="run-card-label">注意</div>
            </div>
            <div class="run-card">
              <div class="run-card-icon">🔴</div>
              <div class="run-card-value">{{ counts.fail }}</div>
              <div class="run-card-label">异常</div>
            </div>
          </div>

          <div class="diag-list">
            <div v-for="c in checks" :key="c.name" class="diag-row" :class="'diag-row-' + c.status">
              <span class="diag-icon">{{ statusIcon(c.status) }}</span>
              <span class="diag-name">{{ c.name }}</span>
              <span class="diag-badge" :class="'diag-' + c.status">{{ STATUS_LABELS[c.status] || c.status }}</span>
              <span v-if="c.failure_class" class="diag-chip">{{
                FAILURE_LABELS[c.failure_class] || c.failure_class
              }}</span>
              <span class="diag-detail">{{ c.detail }}</span>
            </div>
          </div>

          <p class="diag-hint diag-foot">
            数据源：独立诊断子服务（:8090）· 每 2 秒更新 · 失败分类：
            <b>硬件</b>=部件损坏，<b>数据链</b>=读不到（未必坏），<b>配置</b>=参数/环境问题
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diag-overall {
  margin-left: 8px;
  vertical-align: middle;
}
.diag-overall {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid currentColor;
}
/* 横排数据卡：不能用 StatusView 的 .status-run-cards（那是它的 scoped 样式，本页拿不到） */
.diag-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.diag-btn {
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
}
.diag-btn:hover {
  border-color: var(--accent, #4c6ef5);
}
.diag-selftest {
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}
.diag-row-ok {
  border-color: var(--border);
}
.diag-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.diag-cards .run-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}
.diag-cards .run-card-icon {
  font-size: 18px;
  line-height: 1;
}
.diag-cards .run-card-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
}
.diag-cards .run-card-label {
  font-size: 12px;
  color: var(--text-muted);
}
.diag-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diag-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  font-size: 13px;
}
.diag-row-fail {
  border-color: var(--danger, #e5484d);
}
.diag-row-warn {
  border-color: #d9480f;
}
.diag-icon {
  flex: 0 0 auto;
}
.diag-name {
  font-weight: 600;
  min-width: 96px;
}
.diag-badge {
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid currentColor;
}
.diag-chip {
  padding: 0 6px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
}
.diag-detail {
  color: var(--text-muted);
  white-space: normal;
  flex: 1;
}
.diag-ok {
  color: var(--success, #2f9e44);
}
.diag-warn {
  color: #d9480f;
}
.diag-fail {
  color: var(--danger, #e5484d);
}
.diag-offline {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--danger, #e5484d);
  color: var(--danger, #e5484d);
  font-size: 13px;
  line-height: 1.6;
}
.diag-hint {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
}
.diag-foot {
  margin-top: 12px;
}
</style>
