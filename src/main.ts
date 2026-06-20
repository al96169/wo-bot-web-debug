import { createApp } from "vue";
import { createPinia } from "pinia";
import "./style.css";
import App from "./App.vue";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.mount("#app");

// ============================================================
// 全局错误捕获：将所有未捕获错误输出到日志面板
// ============================================================

import { useRobotStore } from "@/stores/robot";

/** 安全写入日志（防止错误处理自身抛出异常导致死循环） */
function safeLog(level: "error" | "warn", source: string, message: string): void {
  try {
    const store = useRobotStore();
    store.addLog(level, source, message);
  } catch {
    // 如果 Pinia store 尚未就绪，忽略
  }
}

// 1) Vue 组件级错误
app.config.errorHandler = (err: unknown, _instance, info: string) => {
  const message = err instanceof Error ? err.message : String(err);
  safeLog("error", "Vue", `${message}${info ? ` [${info}]` : ""}`);
};

// 2) 全局未捕获 JS 运行时错误
window.addEventListener("error", (event: ErrorEvent) => {
  // 排除资源加载错误（如图片 404），只处理脚本错误
  if (!(event instanceof ErrorEvent)) return;
  const message = event.error instanceof Error ? event.error.message : event.message;
  safeLog("error", "Runtime", `${message} (${event.filename.split("/").pop()}:${event.lineno}:${event.colno})`);
});

// 3) 未处理的 Promise 拒绝
window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  safeLog("error", "Promise", message);
});

// 4) 拦截 console.error / console.warn（捕获第三方库的错误输出）
const _origError = console.error.bind(console);
const _origWarn = console.warn.bind(console);
const MAX_MSG = 500;

console.error = (...args: unknown[]): void => {
  _origError(...args);
  const msg = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
  safeLog("error", "Console", msg.length > MAX_MSG ? msg.slice(0, MAX_MSG) + "..." : msg);
};

console.warn = (...args: unknown[]): void => {
  _origWarn(...args);
  const msg = args.map((a) => String(a)).join(" ");
  safeLog("warn", "Console", msg.length > MAX_MSG ? msg.slice(0, MAX_MSG) + "..." : msg);
};
