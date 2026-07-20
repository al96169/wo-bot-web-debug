import { useAuth } from "@/composables/useAuth";

/* ============================================================
 * account.ts - 设备管理 API 客户端
 *
 * 通过 JWT 认证调用 wo-bot-device-api 后端。
 * 所有 API 地址从环境变量 VITE_API_BASE 读取。
 * ============================================================ */

const { authHeader, API_BASE } = useAuth();

/** 通用响应格式 */
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  statusCode?: number;
}

/** 云端设备 */
export interface CloudDevice {
  robotId: string;
  robotName: string | null;
  clientId: string;
  status: "online" | "offline";
  lastSeenAt: string;
  boundAt: string;
}

/** 设备状态详情 */
export interface DeviceStatus {
  robotId: string;
  robotName: string | null;
  status: "online" | "offline";
  lastSeenAt: string;
  registeredAt: string;
  boundCount: number;
}

/** 绑定结果 */
export interface BindResult {
  userId: string;
  robotId: string;
  robotName: string;
  clientId: string;
  boundAt: string;
}

/** 绑定证明载荷 */
export interface BindingPayload {
  robotId: string;
  clientId: string;
  clientTokenHash?: string;
  accountId: string;
  nonce: string;
  expiresAt: number;
}

/** 授权应用 */
export interface AuthorizedApp {
  grantId: string;
  appId: string;
  appName: string;
  appDescription: string;
  appType: string;
  appTypeLabel: string;
  scopes: string[];
  createdAt: string;
}

/** 通用 API 请求封装 */
async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...options.headers,
    },
  });

  if (!resp.ok) {
    let errorMsg = `HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      errorMsg = errBody.error || errorMsg;
    } catch {
      // 非 JSON 响应
    }
    throw new Error(errorMsg);
  }

  const body = (await resp.json()) as ApiResponse<T>;
  if (!body.success) {
    throw new Error(body.error || "API request failed");
  }
  return body.data;
}

/** 查询用户设备列表 */
export async function getDevices(): Promise<CloudDevice[]> {
  return apiRequest<CloudDevice[]>("/api/devices");
}

/** 查询单个设备状态 */
export async function getDeviceStatus(robotId: string): Promise<DeviceStatus> {
  return apiRequest<DeviceStatus>(`/api/devices/${encodeURIComponent(robotId)}/status`);
}

/** 绑定设备 */
export async function bindDevice(payload: BindingPayload, proof: string): Promise<BindResult> {
  return apiRequest<BindResult>("/api/devices/bind", {
    method: "POST",
    body: JSON.stringify({ payload, proof }),
  });
}

/** 解绑设备 */
export async function unbindDevice(robotId: string): Promise<void> {
  await apiRequest<null>(`/api/devices/${encodeURIComponent(robotId)}`, {
    method: "DELETE",
  });
}

/** 重命名设备 */
export async function renameDevice(robotId: string, robotName: string): Promise<BindResult> {
  return apiRequest<BindResult>(`/api/devices/${encodeURIComponent(robotId)}`, {
    method: "PATCH",
    body: JSON.stringify({ robotName }),
  });
}

/** 查询授权应用列表 */
export async function getAuthorizedApps(): Promise<AuthorizedApp[]> {
  return apiRequest<AuthorizedApp[]>("/api/apps");
}

/** 撤销应用授权 */
export async function revokeApp(grantId: string): Promise<void> {
  await apiRequest<null>(`/api/apps/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
  });
}
