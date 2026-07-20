import { ref, computed } from "vue";
import {
  generatePkce,
  generateState,
  savePkceSession,
  loadPkceSession,
  clearPkceSession,
  type PkceSession,
} from "@/utils/pkce";

/* ============================================================
 * useAuth - 自定义授权流程
 *
 * 通过 wo-bot-web 用户中心的 /app-new-bind 页面进行授权，
 * 由 wo-bot-device-api 的 /api/oauth/* 端点处理 token 签发。
 *
 * 流程：
 * 1. login() → 跳转 wo-bot-web /app-new-bind（带 PKCE + state）
 * 2. 用户在 wo-bot-web 确认授权 → wo-bot-device-api 生成授权码
 * 3. wo-bot-web 回调 web-debug 的 /auth/callback（带 code + state）
 * 4. handleCallback() → 用 code 换 token（POST /api/oauth/token）
 * 5. fetchUserInfo() → 获取用户信息（GET /api/oauth/userinfo）
 * ============================================================ */

/** wo-bot-web 用户中心地址（授权页面入口） */
const AUTH_WEB_URL = import.meta.env.VITE_AUTH_WEB_URL || "";

/** 设备管理 API 地址（token 交换、用户信息、设备管理） */
const API_BASE = import.meta.env.VITE_API_BASE || "";

/** 应用标识（用于授权页面展示和授权码生成） */
const APP_ID = import.meta.env.VITE_APP_ID || "wo-bot-web-debug";

/** Token 存储键 */
const STORAGE_KEYS = {
  accessToken: "wobot_access_token",
  refreshToken: "wobot_refresh_token",
  tokenExpiresAt: "wobot_token_expires_at",
  user: "wobot_user",
} as const;

/** 刷新提前量（5 分钟） */
const REFRESH_THRESHOLD = 5 * 60 * 1000;

export interface UserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

// ---- 模块级响应式状态 ----
const accessToken = ref<string | null>(localStorage.getItem(STORAGE_KEYS.accessToken));
const refreshToken = ref<string | null>(localStorage.getItem(STORAGE_KEYS.refreshToken));
const tokenExpiresAt = ref<number>(parseInt(localStorage.getItem(STORAGE_KEYS.tokenExpiresAt) || "0", 10));
const user = ref<UserInfo | null>(
  (() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.user);
      return raw ? (JSON.parse(raw) as UserInfo) : null;
    } catch {
      return null;
    }
  })(),
);

let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** 是否已认证 */
const isAuthenticated = computed(() => !!accessToken.value && Date.now() < tokenExpiresAt.value);

/** 构造授权页面 URL（跳转到 wo-bot-web 的 /app-new-bind） */
function getAuthorizeUrl(codeChallenge: string, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: APP_ID,
    redirect_uri: redirectUri,
    scope: "devices apps",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${AUTH_WEB_URL}/app-new-bind?${params.toString()}`;
}

/** 存储 token 到 localStorage */
function storeTokens(access: string, refresh: string | null, expiresIn: number): void {
  accessToken.value = access;
  refreshToken.value = refresh;
  tokenExpiresAt.value = Date.now() + expiresIn * 1000;

  localStorage.setItem(STORAGE_KEYS.accessToken, access);
  if (refresh) localStorage.setItem(STORAGE_KEYS.refreshToken, refresh);
  localStorage.setItem(STORAGE_KEYS.tokenExpiresAt, tokenExpiresAt.value.toString());

  scheduleRefresh();
}

/** 存储 user 到 localStorage */
function storeUser(u: UserInfo): void {
  user.value = u;
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(u));
}

/** 清除所有 token 和用户信息 */
function clearTokens(): void {
  accessToken.value = null;
  refreshToken.value = null;
  tokenExpiresAt.value = 0;
  user.value = null;

  localStorage.removeItem(STORAGE_KEYS.accessToken);
  localStorage.removeItem(STORAGE_KEYS.refreshToken);
  localStorage.removeItem(STORAGE_KEYS.tokenExpiresAt);
  localStorage.removeItem(STORAGE_KEYS.user);

  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }
}

/** 安排自动刷新 token */
function scheduleRefresh(): void {
  if (_refreshTimer) {
    clearTimeout(_refreshTimer);
    _refreshTimer = null;
  }

  if (!refreshToken.value) return;

  // 在过期前 5 分钟刷新
  const delay = tokenExpiresAt.value - Date.now() - REFRESH_THRESHOLD;
  if (delay <= 0) {
    refresh();
    return;
  }

  _refreshTimer = setTimeout(() => {
    refresh();
  }, delay);
}

/** 发起授权流程：跳转到 wo-bot-web 用户中心的授权页面 */
async function login(): Promise<void> {
  const { code_verifier, code_challenge } = await generatePkce();
  const state = generateState();
  const redirectUri = window.location.origin + "/auth/callback";

  const session: PkceSession = {
    code_verifier,
    state,
    redirect_uri: redirectUri,
    created_at: Date.now(),
  };
  savePkceSession(session);

  const authUrl = getAuthorizeUrl(code_challenge, state, redirectUri);
  window.location.href = authUrl;
}

/** 处理授权回调：用授权码换取 token */
async function handleCallback(code: string, state: string): Promise<void> {
  const session = loadPkceSession();
  if (!session) {
    throw new Error("PKCE session not found or expired");
  }

  if (state !== session.state) {
    clearPkceSession();
    throw new Error("State mismatch - possible CSRF attack");
  }

  // 用授权码换取 token（调用 wo-bot-device-api 的自定义端点）
  const resp = await fetch(`${API_BASE}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      clientId: APP_ID,
      redirectUri: session.redirect_uri,
      codeVerifier: session.code_verifier,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    clearPkceSession();
    throw new Error(`Token exchange failed: ${errText}`);
  }

  const result = await resp.json();
  const tokenData = result.data;
  clearPkceSession();

  storeTokens(tokenData.accessToken, tokenData.refreshToken || null, tokenData.expiresIn || 3600);

  // 获取用户信息
  await fetchUserInfo();
}

/** 获取用户信息（调用 wo-bot-device-api 的自定义端点） */
async function fetchUserInfo(): Promise<void> {
  if (!accessToken.value) return;

  const resp = await fetch(`${API_BASE}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken.value}` },
  });

  if (!resp.ok) {
    console.warn("[useAuth] fetchUserInfo failed:", resp.status);
    return;
  }

  const result = await resp.json();
  const userInfo = result.data as UserInfo;
  storeUser(userInfo);
}

/** 刷新 token（调用 wo-bot-device-api 的自定义端点） */
async function refresh(): Promise<void> {
  if (!refreshToken.value) {
    clearTokens();
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/oauth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken: refreshToken.value,
        clientId: APP_ID,
      }),
    });

    if (!resp.ok) {
      console.error("[useAuth] Token refresh failed:", resp.status);
      clearTokens();
      return;
    }

    const result = await resp.json();
    const tokenData = result.data;
    storeTokens(tokenData.accessToken, tokenData.refreshToken || refreshToken.value, tokenData.expiresIn || 3600);
  } catch (err) {
    console.error("[useAuth] Token refresh error:", err);
    clearTokens();
  }
}

/** 登出：清除本地 token（无需跳转 Logto session end） */
function logout(): void {
  clearTokens();
}

/** 获取认证请求头 */
function authHeader(): Record<string, string> {
  return accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {};
}

/** 初始化时检查 token 并安排刷新 */
function initAuth(): void {
  if (isAuthenticated.value && refreshToken.value) {
    scheduleRefresh();
  } else if (accessToken.value && !isAuthenticated.value) {
    refresh();
  } else {
    clearTokens();
  }
}

export function useAuth() {
  return {
    // 状态
    accessToken,
    refreshToken,
    tokenExpiresAt,
    user,
    isAuthenticated,

    // 方法
    login,
    handleCallback,
    refresh,
    logout,
    fetchUserInfo,
    initAuth,

    // 工具
    authHeader,

    // 配置（用于调试）
    AUTH_WEB_URL,
    API_BASE,
    APP_ID,
  };
}
