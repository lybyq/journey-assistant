/** 引入运行时校验器，让服务端和网页对同一事件使用相同验证规则。 */
import { z } from 'zod';
/** 前后端共用公开正文的格式边界，兼容历史异常回答。 */
export * from './answer-content.js';
/** 导出身份与存储的用户、资料和会话协议，前后端共用。 */
export * from './identity.js';
/** 导出持久化对话持久化协议；事件引用延迟解析避免模块循环初始化。 */
export * from './conversation-runtime.js';
/** 导出计划与外部工具的公共结构。 */
export * from './agent-tools.js';
/** 领域契约按需求、证据、候选、费用和版本拆分并统一导出。 */
export * from './travel-common.js';
/** 结构化需求与自然语言候选提取。 */
export * from './trip-request.js';
/** 资料与可追溯证据。 */
export * from './travel-evidence.js';
/** 不同旅行产品类型。 */
export * from './travel-options.js';
/** 整数预算和同口径比价。 */
export * from './travel-pricing.js';
/** 时间表、验证和不可变版本。 */
export * from './travel-plan.js';
/** 项目聚合与分享交付协议。 */
export * from './travel-workspace.js';
/** 业务工具按业务职责展示，避免全部错误归入智能体编排。 */
export * from './business-tools.js';
/** 所有新增事件使用有界schema。 */
import { safeToolResultSchema, publicTodoSchema, mcpStatusSchema } from './agent-tools.js';
/** 健康响应复用身份与存储无敏感信息的存储状态校验器。 */
import { storageStatusSchema } from './identity.js';
/** 导出协议版本号；将来跨端升级时显式协商，避免静默解析错误。 */
export const PROTOCOL_VERSION = 1 as const;
/** 定义单个第三方集成的公开状态，禁止在此返回 Key、令牌和带密钥的 URL。 */
export const integrationSchema = z.object({
  /** id 用于跨端定位服务；configured 仅代表配置存在，connected 才代表连接成功。 */
  id: z.string(),
  label: z.string(),
  configured: z.boolean(),
  connected: z.boolean(),
  /** 结束第三方集成公开结构。 */
});
/** 定义系统健康快照；状态只描述框架服务，不冒充数据库和供应商就绪。 */
export const healthSchema = z.object({
  /** 存储状态向后兼容工程底座事件，同时准确展示实际连接。 */
  storage: storageStatusSchema.optional(),
  /** 用字面量固定服务身份，防止客户端误把供应商响应当作本服务健康响应。 */
  status: z.literal('ok'),
  service: z.literal('journey-api'),
  scope: z.literal('foundation'),
  /** 返回服务器时间、进程已运行秒数和 Node 版本，便于诊断真实连接。 */
  timestamp: z.string().datetime(),
  uptimeSeconds: z.number().nonnegative(),
  runtime: z.string(),
  /** 公开脱敏的外部集成准备情况。 */
  integrations: z.array(integrationSchema),
  /** 结束健康快照结构。 */
});
/** 根据校验器推导健康类型，禁止维护第二份可能漂移的接口。 */
export type HealthSnapshot = z.infer<typeof healthSchema>;
/** 产品能力按真实职责展示；phase仅保留为已有健康接口的兼容排序字段。 */
export const moduleCatalog = [
  /** 工程底座建立编译、配置、接口和可观察交互底座。 */
  {
    id: 'foundation',
    phase: 1,
    title: '工程底座',
    description: '统一工程、配置、协议、接口文档与交互外壳',
    status: 'ready',
  },
  /** 身份与存储负责身份和数据归属，后续任何历史记录都不能跨用户读取。 */
  {
    id: 'identity',
    phase: 2,
    title: '用户与数据',
    description: '身份、PostgreSQL、Redis、会话与数据隔离',
    status: 'ready',
  },
  /** 持久化对话负责可重放、可取消的生产对话链路。 */
  {
    id: 'conversation',
    phase: 3,
    title: '实时对话',
    description: '历史、流式消息、断线恢复与运行取消',
    status: 'ready',
  },
  /** 智能体编排将真实模型执行适配成公开的进度事件。 */
  {
    id: 'agent',
    phase: 4,
    title: '智能体编排',
    description: 'Deep Agents、LangChain、记忆与任务协同',
    status: 'ready',
  },
  /** MCP工具中心管理外部 MCP 生命周期和调用边界。 */
  {
    id: 'mcp',
    phase: 5,
    title: 'MCP 工具中心',
    description: '12306、高德、Tavily、超时、过滤与脱敏',
    status: 'ready',
  },
  /** 旅行需求将自由输入转成可验证的旅行约束。 */
  {
    id: 'profile',
    phase: 6,
    title: '旅行需求',
    description: '日期、人数、预算、偏好与缺失信息追问',
    status: 'ready',
  },
  /** 资料检索收集带出处和查询时间的旅游证据。 */
  {
    id: 'research',
    phase: 7,
    title: '旅游资料',
    description: '官方资料、攻略、来源、时效与证据提取',
    status: 'ready',
  },
  /** 交通查询对齐铁路和航班等城际交通结果。 */
  {
    id: 'transport',
    phase: 8,
    title: '城际交通',
    description: '铁路、航班、接驳及可用性标准化',
    status: 'ready',
  },
  /** 自驾规划负责自驾路线和车辆相关成本。 */
  {
    id: 'driving',
    phase: 9,
    title: '自驾规划',
    description: '里程、油电费、路费、停车、充电与休息',
    status: 'ready',
  },
  /** 住宿游玩对接住宿、门票和用餐产品。 */
  {
    id: 'stay',
    phase: 10,
    title: '住宿与游玩',
    description: '酒店、门票、餐饮、预约与报价条件',
    status: 'ready',
  },
  /** 旅行团把旅行团营销信息拆成可比较条款。 */
  {
    id: 'tour',
    phase: 11,
    title: '旅行团产品',
    description: '团期、包含项、单房差、自费及购物安排',
    status: 'ready',
  },
  /** 预算计算执行确定性金额计算，不让模型心算总价。 */
  {
    id: 'pricing',
    phase: 12,
    title: '预算与比价',
    description: '同口径成本、币种、人数分摊与价格证据',
    status: 'ready',
  },
  /** 行程版本把交通、游玩与预算约束合成为可执行行程。 */
  {
    id: 'itinerary',
    phase: 13,
    title: '行程生成',
    description: '逐日安排、时间可行性、多方案与局部调整',
    status: 'ready',
  },
  /** 分享与运维补齐分享导出、质量评估和生产运营。 */
  {
    id: 'delivery',
    phase: 14,
    title: '分享与上线',
    description: '导出、分享、审计、限流、观测与部署',
    status: 'ready',
  },
  /** 使用只读字面量让状态和业务职责在前后端保持精确类型。 */
] as const;
/** 从路线清单推导单模块类型，供前端路线图组件直接复用。 */
export type ProductModule = (typeof moduleCatalog)[number];
/** 校验诊断请求；当前只支持框架自检，不能把任意用户输入偷偷发送给模型。 */
export const diagnosticRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    message: z.string().trim().min(1).max(2000),
  })
  .strict();
/** 校验取消请求；运行标识必须属于当前连接才会被取消。 */
export const cancelRequestSchema = z.object({ requestId: z.string().uuid() }).strict();
/** 定义所有服务事件共有的追踪字段。 */
const eventBase = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime(),
});
/** 定义严格区分的事件联合；公开执行进度，不透传模型隐藏推理。 */
export const serverEventSchema = z.discriminatedUnion('type', [
  /** 实际模型/子任务阶段和累计使用量。 */
  eventBase.extend({
    type: z.literal('agent.step'),
    payload: z.object({
      module: z.literal(4),
      stage: z.enum(['model.started', 'model.completed', 'subagent.started', 'subagent.completed']),
      name: z.string().max(100),
      modelCalls: z.number().int().nonnegative(),
      toolCalls: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      estimated: z.boolean().default(false),
    }),
  }),
  /** 实际计划与隐藏思维链明确分离。 */
  eventBase.extend({
    type: z.literal('run.plan'),
    payload: z.object({ module: z.literal(4), todos: z.array(publicTodoSchema).max(12) }),
  }),
  /** 连接状态保存在公开运行轨迹中。 */
  eventBase.extend({
    type: z.literal('mcp.status'),
    payload: z.object({ module: z.literal(5), servers: z.array(mcpStatusSchema).max(3) }),
  }),
  /** 单个工具失败允许智能体解释或降级。 */
  eventBase.extend({
    type: z.literal('tool.failed'),
    payload: z.object({
      callId: z.string().uuid(),
      name: z.string().max(100),
      code: z.string().max(60),
      message: z.string().max(300),
      durationMs: z.number().nonnegative(),
    }),
  }),
  /** 连接建立事件用于确认协议和当前运行范围。 */
  eventBase.extend({
    type: z.literal('session.ready'),
    payload: z.object({ scope: z.literal('foundation'), message: z.string() }),
  }),
  /** 开始事件声明本次是诊断流程，避免误认为真实旅游规划。 */
  eventBase.extend({
    type: z.literal('run.started'),
    payload: z.object({ mode: z.enum(['diagnostic', 'agent']), message: z.string() }),
  }),
  /** 进度事件只描述已经发生或即将执行的可公开步骤。 */
  eventBase.extend({
    type: z.literal('run.progress'),
    payload: z.object({ title: z.string(), detail: z.string() }),
  }),
  /** 工具开始事件包含名称、调用标识和已经脱敏的参数。 */
  eventBase.extend({
    type: z.literal('tool.started'),
    payload: z.object({
      callId: z.string().uuid(),
      name: z.string(),
      input: z.record(z.string(), z.unknown()),
    }),
  }),
  /** 工具完成事件包含真实诊断结果与耗时。 */
  eventBase.extend({
    type: z.literal('tool.completed'),
    payload: z.object({
      callId: z.string().uuid(),
      name: z.string(),
      output: z.union([healthSchema, safeToolResultSchema]),
      durationMs: z.number().nonnegative(),
    }),
  }),
  /** 文本增量事件将最终 Markdown 按块发送给网页。 */
  eventBase.extend({
    type: z.literal('message.delta'),
    payload: z.object({ content: z.string() }),
  }),
  /** 完成事件是该次运行的唯一成功终态。 */
  eventBase.extend({
    type: z.literal('run.completed'),
    payload: z.object({ message: z.string() }),
  }),
  /** 取消事件用于结束当前连接自己的活动运行。 */
  eventBase.extend({
    type: z.literal('run.cancelled'),
    payload: z.object({ message: z.string() }),
  }),
  /** 失败事件提供稳定错误码，不发送内部堆栈和密钥。 */
  eventBase.extend({
    type: z.literal('run.failed'),
    payload: z.object({ code: z.string(), message: z.string() }),
  }),
  /** 结束事件联合定义。 */
]);
/** 推导跨应用的事件类型，消费方可依据 type 获得精确 payload。 */
export type ServerEvent = z.infer<typeof serverEventSchema>;
