/** 业务模块只能调用固定工具，不能从HTTP接收任意MCP名称。 */
import { BadGatewayException, ServiceUnavailableException, Injectable } from '@nestjs/common';
/** 统一结果信封继续经过共享结构校验。 */
import { safeToolResultSchema } from '@journey/contracts';
/** MCP工具中心拥有连接与输出清理，本模块不重复建立认证客户端。 */
import { McpService, McpToolError } from '../mcp/mcp.service.js';
/** 领域层只接受这个固定集合，扩大权限需要改源码并重新审核。 */
const BUSINESS_TOOLS = new Set([
  'tavily__tavily_search',
  'tavily__tavily_extract',
  'tavily__tavily_search',
  'train__get_current_date',
  'train__get_station_code_of_citys',
  'train__get_station_code_by_names',
  'train__get_tickets',
  'train__get_interline_tickets',
  'amap__maps_text_search',
  'amap__maps_search_detail',
  'amap__maps_direction_driving',
  'amap__maps_weather',
]);
/** 一次工作流共享一份MCP工具集，搜索与抽取许可不会在中途丢失。 */
@Injectable()
export class TravelMcpService {
  /** 连接、白名单与秘密边界复用已完成的MCP工具中心。 */
  constructor(private readonly mcp: McpService) {}
  /** 只暴露安全状态，界面不能读到Key或endpoint。 */
  statuses() {
    return this.mcp.statuses();
  }
  /** 先发现，再返回绑定该次取消信号与URL证据集合的调用闭包。 */
  async session(signal: AbortSignal) {
    await this.mcp.discover(signal);
    const tools = this.mcp.tools(signal, true);
    return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      /** 名称既要在业务固定集合内，也必须来自MCP工具中心的实际发现。 */
      signal.throwIfAborted();
      if (!BUSINESS_TOOLS.has(name)) throw new ServiceUnavailableException('业务工具尚未批准');
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new ServiceUnavailableException('需要的供应商工具未配置或暂不可用');
      /** 实际网络错误只转换为固定说明，禁止把供应商认证URL带入响应。 */
      try {
        const value = await tool.invoke(args, { signal });
        signal.throwIfAborted();
        const envelope = safeToolResultSchema.parse(
          typeof value === 'string' ? JSON.parse(value) : value,
        );
        return envelope.data;
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof McpToolError) throw error;
        throw new BadGatewayException('供应商查询失败或参数不被支持，请核对条件后重试');
      }
    };
  }
}
/** 供应商JSON可能被文本块包裹，有限深度解包不执行网页内容。 */
export function asRecord(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
/** 只获取明确的对象数组，供应商意外形状不会自动变成业务成功。 */
export function asRecords(value: unknown): Record<string, any>[] {
  return Array.isArray(value)
    ? (value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<
        string,
        any
      >[])
    : [];
}
