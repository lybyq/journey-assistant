/** 当前ChatOpenAI转换器不能完整回传DeepSeek工具循环要求的reasoning_content。 */
export function providerModelOptions(baseUrl?: string) {
  /** 只对已确认的官方主机发送专属参数，其他兼容服务保持自身协议。 */
  if (!baseUrl || new URL(baseUrl).hostname.toLowerCase() !== 'api.deepseek.com') return {};
  /** 显式使用官方非思考模式，公开计划与真实工具轨迹仍由Agent中间件提供。 */
  return { modelKwargs: { thinking: { type: 'disabled' } } };
}
