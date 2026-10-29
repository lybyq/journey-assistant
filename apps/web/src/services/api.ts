/** 共享健康校验器阻止网页误用结构不匹配的后端响应。 */
import { healthSchema, type HealthSnapshot } from '@journey/contracts';
/** 将公开 API 来源集中到单一适配层，避免组件内硬编码域名。 */
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
/** 用超时受控的请求获取真实健康状态。 */
export async function fetchHealth(): Promise<HealthSnapshot> {
  /** 浏览器原生 AbortSignal 在超时后中止请求，避免界面一直等待。 */
  const response = await fetch(`${apiBase}/api/v1/system/health`, {
    signal: AbortSignal.timeout(8000),
  });
  /** HTTP 错误只返回受控提示，不把内部响应 HTML 当成 JSON。 */
  if (!response.ok) throw new Error('暂时无法连接后端服务');
  /** 验证不可信网络响应后才交给界面。 */
  return healthSchema.parse(await response.json());
  /** 结束健康请求方法。 */
}
