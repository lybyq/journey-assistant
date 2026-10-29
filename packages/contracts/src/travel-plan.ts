/** 模型提出候选时间表，服务端独立验证后才保存版本。 */
import { z } from 'zod';
/** 日历日期与地图点不使用模糊文本。 */
import { calendarDate, pointSchema, shortText } from './travel-common.js';
/** 金额快照只能由确定性预算服务生成。 */
import { costBreakdownSchema } from './travel-pricing.js';
/** 报价、汇率和来源随版本冻结，后续搜索更新不改写旧版本依据。 */
import { costItemSchema, exchangeRateSchema } from './travel-pricing.js';
/** 公开来源快照不包含账户身份。 */
import { evidenceSchema } from './travel-evidence.js';
/** 一项活动使用当地日内分钟；跨夜活动需要拆成两个日历日。 */
export const scheduleItemSchema = z
  .object({
    /** 每次局部替换可凭稳定ID定位活动。 */
    id: z.string().uuid(),
    title: shortText,
    kind: z.enum(['visit', 'meal', 'hotel', 'transit', 'rest', 'charging']),
    /** 开始/结束分钟便于确定性检测冲突，不让模型心算时间。 */
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    /** point用于距离下限验证，referenceId绑定08～旅行团的真实候选。 */
    point: pointSchema.nullable(),
    referenceId: z.string().uuid().nullable(),
    evidenceIds: z.array(z.string().uuid()).max(15),
    costIds: z.array(z.string().uuid()).max(15),
    /** 接驳时间、驾驶时间和步行量都参与验证。 */
    travelBeforeMinutes: z.number().int().min(0).max(1200).nullable(),
    walkMinutes: z.number().int().min(0).max(600),
    driveMinutes: z.number().int().min(0).max(600),
    reservationConfirmed: z.boolean().nullable(),
    notes: z.string().max(1500),
  })
  .strict()
  .refine((item) => item.endMinute > item.startMinute, '活动结束时间必须晚于开始');
/** 每天有独立日期和时区，不把出发地时区强加给目的地。 */
export const dayPlanSchema = z
  .object({ date: calendarDate, items: z.array(scheduleItemSchema).max(20) })
  .strict();
/** 客户端不能提交“已经通过验证”或自己计算的预算字段。 */
export const planDraftSchema = z
  .object({
    title: shortText,
    mode: z.enum(['independent', 'driving', 'group']),
    timeZone: z.string().max(80),
    days: z.array(dayPlanSchema).min(1).max(30),
    costIds: z.array(z.string().uuid()).max(100),
    assumptions: z.array(z.string().max(300)).max(30),
  })
  .strict();
/** 统一错误码让网页可筛选时间、地图、营业和预算问题。 */
export const violationSchema = z.object({
  code: z.string().max(80),
  severity: z.enum(['error', 'warning']),
  message: z.string().max(400),
  itemId: z.string().uuid().nullable(),
  day: calendarDate.nullable(),
});
/** 保存结果包含不可变版本、验证结论与可复算预算。 */
export const planVersionSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  version: z.number().int().positive(),
  parentId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  reason: z.string().max(300),
  draft: planDraftSchema,
  violations: z.array(violationSchema).max(300),
  status: z.enum(['validated', 'needs_confirmation', 'invalid']),
  budget: costBreakdownSchema,
  /** 只保存本方案选中报价；修改只能新增人工报价，不能覆盖旧ID。 */
  prices: z.array(costItemSchema).max(100).default([]),
  /** 版本固定时使用的参考汇率和预备金比例。 */
  rates: z.array(exchangeRateSchema).max(12).default([]),
  reserveBps: z.number().int().min(0).max(5000).default(1000),
  /** 实际引用来源冻结为公开摘录，刷新当前项目不会影响分享版本。 */
  sources: z.array(evidenceSchema).max(60).default([]),
  /** 需求口径指纹不包含用户隐私；条件改变后旧版本不得混排。 */
  comparisonKey: z.string().max(64).default(''),
});
/** 自动编排只使用已保存的候选和指定费用，不凭空制造酒店或门票。 */
export const generatePlanSchema = z
  .object({
    mode: z.enum(['independent', 'driving', 'group']),
    experienceIds: z.array(z.string().uuid()).max(20).default([]),
    /** 交通可选择去返程；车辆、酒店和团产品只能各选一个明确方案。 */
    transportIds: z.array(z.string().uuid()).max(6).default([]),
    drivingId: z.string().uuid().nullable().default(null),
    hotelId: z.string().uuid().nullable().default(null),
    tourId: z.string().uuid().nullable().default(null),
    costIds: z.array(z.string().uuid()).max(100).default([]),
    title: shortText.default('我的旅行方案'),
  })
  .strict();
/** 局部替换必须显式指定被替换版本和项目，原版本始终保留。 */
export const replaceScheduleSchema = z
  .object({
    baseVersionId: z.string().uuid(),
    itemId: z.string().uuid(),
    replacement: scheduleItemSchema,
    reason: z.string().min(1).max(300),
  })
  .strict();
/** 确保每个方案都是同一旅行项目、同一需求口径。 */
export const comparePlansSchema = z
  .object({ versionIds: z.array(z.string().uuid()).min(2).max(6) })
  .strict();
/** 版本对象统一供网页、分享、Markdown和PDF导出读取。 */
export type PlanDraft = z.infer<typeof planDraftSchema>;
/** 活动和验证结论可以单独复用。 */
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
/** 已保存版本不能原地修改。 */
export type PlanVersion = z.infer<typeof planVersionSchema>;
/** 约束冲突来自服务端确定性验证。 */
export type ConstraintViolation = z.infer<typeof violationSchema>;
