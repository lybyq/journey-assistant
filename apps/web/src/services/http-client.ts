/** 用户状态只在内存存在，浏览器刷新通过HttpOnly Cookie恢复。 */
import { shallowRef } from 'vue';
/** 真实认证响应通过共享schema验证。 */
import { authResponseSchema, type AuthResponse, type PublicUser } from '@journey/contracts';
/** 公开API来源集中配置，组件不拼接后端地址。 */
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
/** 公开用户可供Pinia订阅，但不包含刷新秘密或密码。 */
export const currentUser = shallowRef<PublicUser | null>(null);
/** 访问令牌不导出、不持久化到localStorage或sessionStorage。 */
let accessToken: string | null = null;
/** 身份变更代数使退出前发出的迟到刷新无法重新登录页面。 */
let identityRevision = 0;
/** 单标签页的刷新请求合并，避免重复消费同一刷新令牌。 */
let refreshPromise: Promise<AuthResponse> | null = null;
/** 统一受控错误类型，使表单可以区分401和基础设施故障。 */
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); this.name = 'ApiError'; } }
/** 清理内存身份，不删除后端持久化会话或用户资料。 */
export function clearIdentity(): void { identityRevision += 1; accessToken = null; currentUser.value = null; }
/** 应用完整校验后的认证响应，不保存额外服务字段。 */
export function acceptIdentity(value: unknown): AuthResponse { const parsed = authResponseSchema.parse(value); identityRevision += 1; accessToken = parsed.accessToken; currentUser.value = parsed.user; return parsed; }
/** 所有失败响应只展示安全消息，不拼接请求体、Token或Cookie。 */
async function readResponse(response: Response): Promise<unknown> { const body = await response.json().catch(() => null) as { message?: unknown } | null; if (!response.ok) throw new ApiError(response.status, typeof body?.message === 'string' ? body.message : '服务暂时不可用，请稍后重试'); return body; }
/** 发起认证变更必须带自定义头并携带浏览器管理的Cookie。 */
export async function authRequest(path: string, body?: unknown): Promise<unknown> { const response = await fetch(`${base}/api/v1/auth/${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'x-journey-client': 'web', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(12000) }); return readResponse(response); }
/** 刷新失败时只对明确401清空身份，网络故障保留用户上下文便于重试。 */
export function refreshIdentity(): Promise<AuthResponse> {
  /** 同一标签页复用正在执行的刷新Promise。 */
  if (refreshPromise) return refreshPromise;
  /** 在等待跨标签锁之前记录身份代数。 */
  const revision = identityRevision;
  /** 令牌轮换由服务端完成，浏览器不读取刷新Cookie。 */
  const renew = async () => { try { const response = await authRequest('refresh'); if (revision !== identityRevision) throw new ApiError(409, '账户状态已变化，请重试'); return acceptIdentity(response); } catch (error) { if (revision === identityRevision && error instanceof ApiError && error.status === 401) clearIdentity(); throw error; } };
  /** Web Locks协调同源多标签页，避免各标签同时消费旧Cookie。 */
  refreshPromise = (navigator.locks ? navigator.locks.request('journey-auth-refresh', renew) : renew()).finally(() => { refreshPromise = null; }); return refreshPromise;
/** 结束身份刷新。 */
}
/** 流式请求沿用内存凭据与单次刷新，组件无法读取访问令牌。 */
export async function authenticatedStream(path: string, signal: AbortSignal): Promise<Response> {
  /** 通过HttpOnly Cookie恢复身份，令牌不放URL。 */
  if (!accessToken) await refreshIdentity(); const ownerId = currentUser.value?.id;
  /** 传输总时限由调用方心跳检测负责。 */
  const perform = () => fetch(`${base}/api/v1${path}`, { credentials: 'include', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'text/event-stream' }, signal });
  /** 只对明确401刷新一次，并拒绝账户切换前的迟到响应。 */
  let response = await perform(); if (currentUser.value?.id !== ownerId) { await response.body?.cancel(); throw new ApiError(409, '账户状态已变化'); } if (response.status === 401) { await response.body?.cancel(); await refreshIdentity(); response = await perform(); }
  /** 第二次校验覆盖刷新等待期间的身份变化。 */
  if (currentUser.value?.id !== ownerId) { await response.body?.cancel(); throw new ApiError(409, '账户状态已变化'); } if (response.status === 401) clearIdentity(); if (!response.ok) { await readResponse(response); throw new ApiError(response.status, '实时连接不可用'); }
  /** 返回已验证身份的流，凭据仍封装在本文件。 */
  return response;
/** 结束认证流请求。 */
}
/** 对业务API附加短期访问令牌，遇到401最多刷新并重试一次。 */
export async function authenticatedRequest(path: string, options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {}): Promise<unknown> {
  /** 尚无访问令牌时先尝试恢复HttpOnly登录会话。 */
  if (!accessToken) await refreshIdentity();
  /** 请求返回时不能跨越一次退出或账户切换继续自动重试。 */
  const ownerId = currentUser.value?.id;
  /** 网络请求不把凭据放进URL、日志或长期存储。 */
  const perform = () => fetch(`${base}/api/v1${path}`, { method: options.method ?? 'GET', credentials: 'include', headers: { Authorization: `Bearer ${accessToken}`, ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(12000) });
  /** 只有明确401才进行一次自动续期，403/404不能通过重试绕过。 */
  let response = await perform(); if (currentUser.value?.id !== ownerId) throw new ApiError(409, '账户状态已变化，请重试'); if (response.status === 401) { await refreshIdentity(); response = await perform(); }
  /** 第二次仍401则清空内存，避免无限刷新循环。 */
  if (currentUser.value?.id !== ownerId) throw new ApiError(409, '账户状态已变化，请重试'); if (response.status === 401) clearIdentity(); return readResponse(response);
/** 结束受保护请求。 */
}
