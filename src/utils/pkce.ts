/**
 * OAuth2 PKCE 工具函数
 *
 * 实现 RFC 7636 PKCE 扩展，用于 Authorization Code + PKCE 流程。
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

/** 生成随机字符串（用于 code_verifier 和 state） */
function generateRandomString(length: number): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  let result = "";
  for (let i = 0; i < length; i++) {
    result += charset[values[i] % charset.length];
  }
  return result;
}

/** Base64URL 编码（不含 padding） */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 生成 PKCE 对
 * @returns code_verifier（43-128 字符）和 code_challenge（S256 方法的 BASE64URL 编码）
 */
export async function generatePkce(): Promise<{ code_verifier: string; code_challenge: string }> {
  // 生成 43 字符的 code_verifier（RFC 7636 要求 43-128）
  const code_verifier = generateRandomString(64);

  // 计算 code_challenge = BASE64URL(SHA256(code_verifier))
  const encoder = new TextEncoder();
  const data = encoder.encode(code_verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const code_challenge = base64UrlEncode(digest);

  return { code_verifier, code_challenge };
}

/** 生成 state 随机串（防 CSRF） */
export function generateState(): string {
  return generateRandomString(32);
}

/** 生成 nonce（防重放） */
export function generateNonce(): string {
  return generateRandomString(16);
}

/** PKCE 会话数据（存储在 sessionStorage 中，授权完成后清除） */
export interface PkceSession {
  code_verifier: string;
  state: string;
  redirect_uri: string;
  created_at: number;
}

const PKCE_SESSION_KEY = "wobot_pkce_session";
const PKCE_SESSION_TTL = 10 * 60 * 1000; // 10 分钟

/** 存储 PKCE 会话数据到 sessionStorage */
export function savePkceSession(session: PkceSession): void {
  sessionStorage.setItem(PKCE_SESSION_KEY, JSON.stringify(session));
}

/** 读取 PKCE 会话数据（自动检查 TTL，过期返回 null） */
export function loadPkceSession(): PkceSession | null {
  const raw = sessionStorage.getItem(PKCE_SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as PkceSession;
    if (Date.now() - session.created_at > PKCE_SESSION_TTL) {
      sessionStorage.removeItem(PKCE_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(PKCE_SESSION_KEY);
    return null;
  }
}

/** 清除 PKCE 会话数据 */
export function clearPkceSession(): void {
  sessionStorage.removeItem(PKCE_SESSION_KEY);
}
