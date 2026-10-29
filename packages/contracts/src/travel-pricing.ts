/** 确定性金额输入不依赖模型心算。 */
import { z } from 'zod';
/** 金额、日期、币种和来源使用统一边界。 */
import {
  calendarDate,
  currencySchema,
  minorSchema,
  shortText,
  sourceUrlSchema,
} from './travel-common.js';
/** 所有比较必须使用同一组日期、人数、房晚和住宿标准。 */
export const quoteConditionsSchema = z
  .object({
    startDate: calendarDate.nullable(),
    endDate: calendarDate.nullable(),
    adults: z.number().int().min(1).max(20).nullable(),
    children: z.number().int().min(0).max(10).nullable(),
    rooms: z.number().int().min(1).max(10).nullable(),
    nights: z.number().int().min(0).max(29).nullable(),
    hotelStandard: z.string().max(100).nullable(),
    mandatoryFeesIncluded: z.boolean().nullable(),
  })
  .strict();
/** 单项金额和计价数量分开；未知不等于0，宣传价不能晋升为实时报价。 */
export const costItemSchema = z
  .object({
    /** 全局ID支持行程引用，scopeKey用于识别同一费用口径的重复计价。 */
    id: z.string().uuid(),
    label: shortText,
    category: z.enum([
      'transport',
      'lodging',
      'ticket',
      'meal',
      'driving',
      'tour',
      'insurance',
      'other',
    ]),
    scopeKey: z.string().min(1).max(120),
    /** priceType由供应商身份和数据性质决定，不由营销文案决定。 */
    priceType: z.enum(['live_quote', 'advertised', 'estimate', 'unknown']),
    unitAmountMinor: minorSchema.nullable(),
    currency: currencySchema,
    quantity: z.number().int().min(1).max(10000),
    unit: z.enum(['person', 'room_night', 'trip', 'vehicle', 'ticket', 'meal']),
    /** 明确必需/可选，包价包含的分类不能再次累计。 */
    required: z.boolean(),
    selected: z.boolean(),
    includes: z.array(z.enum(['transport', 'lodging', 'ticket', 'meal', 'insurance'])).max(5),
    /** 人工录入的金额最多标成估算/宣传价，禁止冒充授权供应商库存。 */
    provenance: z.enum(['supplier', 'mcp', 'manual', 'calculation']),
    provider: z.string().max(80),
    sourceUrl: sourceUrlSchema.nullable(),
    evidenceIds: z.array(z.string().uuid()).max(20),
    checkedAt: z.string().datetime(),
    validUntil: z.string().datetime().nullable(),
    conditions: quoteConditionsSchema,
    notes: z.string().max(1500),
  })
  .strict()
  .superRefine((item, ctx) => {
    if ((item.priceType === 'unknown') !== (item.unitAmountMinor === null))
      ctx.addIssue({
        code: 'custom',
        message: '未知价格必须为null，已知价格必须填写金额',
      });
    if (item.priceType === 'live_quote' && (item.provenance !== 'supplier' || !item.validUntil))
      ctx.addIssue({
        code: 'custom',
        message: '实时报价必须来自授权供应商并有有效期',
      });
  });
/** 汇率用十进制字符串表达；服务端将其转成整数分数后计算。 */
export const exchangeRateSchema = z
  .object({
    from: currencySchema,
    to: currencySchema,
    rate: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/)
      .refine((value) => Number(value) > 0),
    source: shortText,
    sourceUrl: sourceUrlSchema,
    checkedAt: z.string().datetime(),
    validUntil: z.string().datetime(),
    kind: z.enum(['reference', 'estimate']),
  })
  .strict();
/** 比较范围固定后才允许不同方案进入同一排名。 */
export const budgetInputSchema = z
  .object({
    items: z.array(costItemSchema).max(100),
    currency: currencySchema,
    people: z.number().int().min(1).max(30),
    rates: z.array(exchangeRateSchema).max(12).default([]),
    reserveBps: z.number().int().min(0).max(5000).default(1000),
  })
  .strict();
/** 预算输出明确已知小计、未知项和比较资格。 */
export const costBreakdownSchema = z.object({
  currency: currencySchema,
  knownTotalMinor: minorSchema,
  reserveMinor: minorSchema,
  totalWithReserveMinor: minorSchema,
  perPersonMinor: minorSchema,
  allocationMinor: z.array(minorSchema).max(30),
  complete: z.boolean(),
  rankingEligible: z.boolean(),
  issues: z.array(z.string().max(300)).max(100),
  lines: z
    .array(
      z.object({
        id: z.string().uuid(),
        amountMinor: minorSchema.nullable(),
        excludedBy: z.string().uuid().nullable(),
        reason: z.string().max(300).nullable(),
      }),
    )
    .max(100),
});
/** 一份报价包含所有可复算的条件。 */
export type CostItem = z.infer<typeof costItemSchema>;
/** 汇率和预算结果在前后端之间共享。 */
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;
/** 结果类型只从schema导出。 */
export type CostBreakdown = z.infer<typeof costBreakdownSchema>;
