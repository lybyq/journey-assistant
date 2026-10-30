/** 国内决策工作台只接收通过校验的方案、渠道状态和外部交接入口。 */
import { z } from 'zod';
/** 方案继续复用不可变行程版本，避免另存一套未经校验的模型日程。 */
import { planVersionSchema } from './travel-plan.js';
/** 项目快照保留原有归属、需求和候选语义。 */
import { tripWorkspaceSchema } from './travel-workspace.js';
/** 策略表示优化侧重点，不表示缺价时也能承诺最低总价。 */
export const domesticStrategySchema = z.enum(['economy', 'balanced', 'comfort']);
/** 渠道目录中的能力与当前部署的实际开通状态分开表达。 */
export const domesticProviderSchema = z.object({
  id: z.string().max(40),
  label: z.string().max(80),
  categories: z.array(z.string().max(40)),
  capabilities: z.array(z.enum(['content', 'route', 'search', 'quote', 'redirect', 'order'])),
  state: z.enum(['ready', 'idle', 'unconfigured', 'unavailable', 'partner_required']),
  implemented: z.boolean(),
  officialUrl: z.string().url(),
  accessNote: z.string().max(600),
});
/** 集合在服务端冻结，页面展示顺序和“第二套”引用以此为准。 */
export const domesticOptionSetSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  createdAt: z.string().datetime(),
  contextFingerprint: z.string().length(64),
  market: z.literal('CN'),
  options: z
    .array(
      z.object({
        strategy: domesticStrategySchema,
        label: z.string(),
        reason: z.string(),
        version: planVersionSchema,
      }),
    )
    .max(3),
  limitations: z.array(z.string().max(500)).max(30),
});
/** 切换会话后通过同一响应恢复方案及其是否已失效。 */
export const domesticDecisionSchema = z.object({
  workspace: tripWorkspaceSchema.nullable(),
  optionSet: domesticOptionSetSchema.nullable(),
  stale: z.boolean(),
});
/** 只接受固定渠道标识，不能让模型或浏览器提交任意跳转地址。 */
export const domesticHandoffInputSchema = z.object({ providerId: z.string().max(40) }).strict();
/** 当前固定入口均明确标注为平台/官方查询，不能伪装为商品已预订。 */
export const domesticHandoffSchema = z.object({
  providerId: z.string(),
  label: z.string(),
  url: z.string().url(),
  kind: z.enum(['official_entry', 'platform_entry', 'product_booking', 'navigation']),
  notice: z.string(),
  bookingConfirmed: z.literal(false),
});
/** 类型与运行时校验共用同一来源。 */
export type DomesticOptionSet = z.infer<typeof domesticOptionSetSchema>;
export type DomesticDecision = z.infer<typeof domesticDecisionSchema>;
export type DomesticProvider = z.infer<typeof domesticProviderSchema>;
