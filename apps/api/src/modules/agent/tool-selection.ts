/** 工具目录按需公开Schema，避免每轮把所有供应商和表单结构发给模型。 */
import { tool } from 'langchain';
/** 目录只接受固定能力，不允许模型注册任意工具或网络地址。 */
import { z } from 'zod';
/** 能力选择仅改变本轮模型看到的工具，不扩大后端原有权限。 */
const domains = z.enum([
  'request',
  'research',
  'transport',
  'rail_tools',
  'driving',
  'experiences',
  'tours',
  'budget',
  'planning',
  'weather',
  'maps',
]);
/** 业务工具与明确领域关联，基础读取始终可见。 */
const toolDomains: Record<string, string> = {
  journey_trip_update: 'request',
  journey_research: 'research',
  journey_rail: 'transport',
  journey_flights: 'transport',
  journey_driving: 'driving',
  journey_places: 'experiences',
  journey_hotels: 'experiences',
  journey_tours: 'tours',
  journey_estimate_add: 'budget',
  journey_plan_generate: 'planning',
  journey_plan_adjust: 'planning',
  task: 'research',
  read_file: 'research',
};
/** 每次运行拥有独立目录，主代理和只读研究代理共用本轮已选择能力。 */
export class ToolSelection {
  /** 只保存能力名，不保存用户消息、供应商结果和认证数据。 */
  private readonly enabled = new Set<string>();
  /** 小问题只需要基础读取、时间与预算；复杂任务再加载所需工具。 */
  allows(name: string): boolean {
    if (
      [
        'journey_tools_select',
        'journey_trip_read',
        'journey_capabilities',
        'journey_budget',
        'journey_current_time',
        'write_todos',
      ].includes(name)
    )
      return true;
    if (toolDomains[name]) return this.enabled.has(toolDomains[name]!);
    if (name.startsWith('train__')) return this.enabled.has('rail_tools');
    if (name.startsWith('tavily__')) return this.enabled.has('research');
    if (name === 'amap__maps_weather') return this.enabled.has('weather');
    if (name.startsWith('amap__')) return this.enabled.has('maps');
    return false;
  }
  /** 需求保存成功后卸载较大的补丁Schema；确需修改时仍可通过目录重新加载。 */
  completed(name: string): void {
    if (name === 'journey_trip_update') this.enabled.delete('request');
  }
  /** 工具名称与参数在实际LangChain循环中执行，下一次模型请求才看到新增Schema。 */
  tool() {
    return tool(
      async (input) => {
        for (const domain of input.domains) this.enabled.add(domain);
        return JSON.stringify({
          enabled: [...this.enabled],
          message: '所选能力的实际工具已在下一次模型调用中加载；缺配置仍会明确失败。',
        });
      },
      {
        name: 'journey_tools_select',
        description:
          '按需加载：request保存需求；research资料；transport业务铁路航班；driving自驾；experiences业务地点酒店；tours跟团；budget用户估算；planning行程；weather天气。独立原始查询才选rail_tools铁路或maps地图；业务工具内部已接入MCP，不要重复加载。一次最多3种。',
        schema: z.object({ domains: z.array(domains).min(1).max(3) }).strict(),
      },
    );
  }
}
