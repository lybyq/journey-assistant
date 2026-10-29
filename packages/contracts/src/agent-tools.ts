/** 协议只公开执行摘要，不包含隐藏推理与密钥。 */
import { z } from 'zod';
/** 计划来自真实write_todos调用。 */
export const publicTodoSchema = z.object({
  /** 计划只保存短任务摘要，防止把长篇内部过程写入公开事件。 */
  content: z.string().max(300),
  /** UI直接展示真实状态，不自行猜测完成百分比。 */
  status: z.enum(['pending', 'in_progress', 'completed']),
});
/** 模型与网页使用同一份有界脱敏工具结果。 */
export const safeToolResultSchema = z.object({
  /** 区分MCP工具中心外部工具与智能体编排计划、时钟等内部工具。 */
  kind: z.enum(['mcp', 'internal']),
  /** 供应商结果结构不同；内容已由后端统一脱敏并限长。 */
  data: z.unknown(),
  /** 业务资料因长度或层级被裁剪时明确告知；认证脱敏不会伪装成票价缺失。 */
  truncated: z.boolean(),
  /** 外部资料不具备指令权限，模型必须按资料处理。 */
  untrusted: z.boolean(),
  /** 查询完成的实际时间，不能用网页抓取时间代替报价有效期。 */
  checkedAt: z.string().datetime(),
  /** 已由服务端转换的上海时间，避免模型把UTC日期误当作本地日期。 */
  checkedAtLocal: z.string().max(80).optional(),
});
/** 公开状态不包含endpoint、认证头和子进程参数。 */
export const mcpStatusSchema = z.object({
  /** 固定供应商标识，浏览器不能提交任意服务URL。 */
  id: z.enum(['train', 'amap', 'tavily']),
  /** 学习界面可以直接标注MCP工具中心归属。 */
  module: z.literal(5),
  /** 用户可读名称，不包含连接内部配置。 */
  label: z.string(),
  /** 配置存在不代表连接已验证，必须与connected区分。 */
  configured: z.boolean(),
  /** 有限连接状态准确表达禁用、缺配置、发现、故障和冷却。 */
  state: z.enum([
    'disabled',
    'unconfigured',
    'idle',
    'connecting',
    'ready',
    'degraded',
    'circuit_open',
  ]),
  /** 真实发现成功才置为true；后续连接失败会清除。 */
  connected: z.boolean(),
  /** 仅统计白名单和schema验收通过的工具。 */
  toolCount: z.number().int().nonnegative(),
  /** 对外只公开可调用名称，不公开认证头和启动参数。 */
  allowedTools: z.array(z.string().max(100)).max(30),
  /** 错误采用受控中文说明，不透传SDK异常原文。 */
  lastError: z.string().nullable(),
  /** 未发生真实发现时为空，避免制造假查询时间。 */
  checkedAt: z.string().datetime().nullable(),
});
/** 状态类型由schema推导。 */
export type McpStatus = z.infer<typeof mcpStatusSchema>;
/** 计划类型供前端复用。 */
export type PublicTodo = z.infer<typeof publicTodoSchema>;
