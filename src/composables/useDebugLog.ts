import { useAppStore } from "../stores/app";

/* ============================================================
 * wo-bot-web-debug - Debug 日志
 *
 * 仅在 appStore.debugMode 为 true 时输出到浏览器控制台，
 * 支持不同级别的日志（debug/info/warn/error）
 * ============================================================ */

export function useDebugLog() {
  const appStore = useAppStore();

  function debug(tag: string, ...args: unknown[]): void {
    if (appStore.debugMode) {
      console.log(`[Debug:${tag}]`, ...args);
    }
  }

  function info(tag: string, ...args: unknown[]): void {
    if (appStore.debugMode) {
      console.info(`[Info:${tag}]`, ...args);
    }
  }

  function warn(tag: string, ...args: unknown[]): void {
    if (appStore.debugMode) {
      console.warn(`[Warn:${tag}]`, ...args);
    }
  }

  function error(tag: string, ...args: unknown[]): void {
    // error 级别始终输出到控制台，不受 debugMode 限制
    console.error(`[Error:${tag}]`, ...args);
  }

  return { debug, info, warn, error };
}
