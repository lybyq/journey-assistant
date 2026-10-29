/** 旅行项目聚合只包含当前账户有权读取的数据。 */
import { z } from 'zod';
/** 各模块的严格结构在聚合中仍保留独立命名。 */
import { tripRequestSchema, tripRequestPatchSchema } from './trip-request.js';
/** 证据以有界摘录保存，原始网页不作为可执行内容。 */
import { evidenceSchema } from './travel-evidence.js';
/** 交通、自驾、住宿和团产品各自具有不同语义。 */
import {
  transportOptionSchema,
  drivingRouteSchema,
  experienceSchema,
  tourProductSchema,
} from './travel-options.js';
/** 所有预算都能够由报价和汇率重算。 */
import { costItemSchema, exchangeRateSchema } from './travel-pricing.js';
/** 方案元数据用于切换版本，不在列表中重复大段日程。 */
export const versionSummarySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  mode: z.enum(['independent', 'driving', 'group']),
  status: z.enum(['validated', 'needs_confirmation', 'invalid']),
  createdAt: z.string().datetime(),
});
/** 旅行服务可编辑聚合，行程版本不可变版本另表保存。 */
export const tripDocumentSchema = z
  .object({
    request: tripRequestSchema,
    evidence: z.array(evidenceSchema).max(60),
    transport: z.array(transportOptionSchema).max(30),
    driving: z.array(drivingRouteSchema).max(10),
    experiences: z.array(experienceSchema).max(60),
    tours: z.array(tourProductSchema).max(20),
    costs: z.array(costItemSchema).max(100),
    rates: z.array(exchangeRateSchema).max(12),
    reserveBps: z.number().int().min(0).max(5000).default(1000),
  })
  .strict();
/** revision是乐观锁版本，拒绝旧页面覆盖另一标签页已经保存的资料。 */
export const tripWorkspaceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(100),
  conversationId: z.string().uuid().nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archived: z.boolean(),
  document: tripDocumentSchema,
  versions: z.array(versionSummarySchema).max(50),
  activeVersionId: z.string().uuid().nullable(),
  clarifications: z
    .array(
      z.object({
        field: z.string(),
        question: z.string(),
        required: z.boolean(),
      }),
    )
    .max(30),
});
/** 创建项目可以绑定当前账户的聊天会话；客户端不能指定userId。 */
export const createTripSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    conversationId: z.string().uuid().nullable().default(null),
    request: tripRequestPatchSchema.default({}),
    text: z.string().max(4000).default(''),
  })
  .strict();
/** 全部修改必须带当前版本，防止静默丢失数据。 */
export const revisionSchema = z.object({
  revision: z.number().int().nonnegative(),
});
/** 需求修改保留字段补丁语义，不覆盖未提交字段。 */
export const updateTripSchema = revisionSchema
  .extend({
    title: z.string().trim().min(1).max(100).optional(),
    request: tripRequestPatchSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict();
/** 引用报价时必须明确是否选择及预算预备金比例。 */
export const setCostsSchema = revisionSchema
  .extend({
    costs: z.array(costItemSchema).max(100),
    rates: z.array(exchangeRateSchema).max(12),
    reserveBps: z.number().int().min(0).max(5000),
  })
  .strict();
/** 分享固定到一个不可变版本，有效期与撤销独立控制。 */
export const shareCreateSchema = z
  .object({
    versionId: z.string().uuid(),
    expiresInHours: z.number().int().min(1).max(168).default(24),
  })
  .strict();
/** 前后端共享完整结构，避免未经校验地渲染模型JSON。 */
export type TripDocument = z.infer<typeof tripDocumentSchema>;
/** 聚合对象不含访问令牌、数据库连接或第三方认证信息。 */
export type TripWorkspace = z.infer<typeof tripWorkspaceSchema>;
