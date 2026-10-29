/** 完整需求既允许未知，也明确校验已知条件。 */
import { z } from 'zod';
/** 日期与金额口径由共享基础契约统一。 */
import { calendarDate, currencySchema, minorSchema } from './travel-common.js';
/** 目的地当地时区必须是运行环境识别的IANA时区。 */
const timeZone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, '无效IANA时区');
/** 预算范围保留总预算/人均口径，未知金额必须为null。 */
export const tripBudgetSchema = z
  .object({
    currency: currencySchema.default('CNY'),
    scope: z.enum(['total', 'per_person']).default('total'),
    minMinor: minorSchema.nullable().default(null),
    maxMinor: minorSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (value) =>
      value.minMinor === null || value.maxMinor === null || value.minMinor <= value.maxMinor,
    '预算下限不能超过上限',
  );
/** 字段默认null表示尚未确认，不能默认猜人数、日期或房间数。 */
export const tripRequestSchema = z
  .object({
    /** 自由行、自驾、跟团可以分别生成方案；当前偏好不等于已经确定。 */
    mode: z.enum(['independent', 'driving', 'group']).nullable().default(null),
    /** 地名允许中文，机场IATA编码另由交通查询明确输入。 */
    origin: z.string().trim().max(80).nullable().default(null),
    destination: z.string().trim().max(120).nullable().default(null),
    /** 相对日期按上海解释；目的地时区独立保存供行程使用。 */
    interpretationTimeZone: z.literal('Asia/Shanghai').default('Asia/Shanghai'),
    destinationTimeZone: timeZone.nullable().default(null),
    /** 起止日期含首尾；天数和住宿晚数属于不同口径。 */
    startDate: calendarDate.nullable().default(null),
    endDate: calendarDate.nullable().default(null),
    days: z.number().int().min(1).max(30).nullable().default(null),
    nights: z.number().int().min(0).max(29).nullable().default(null),
    /** 儿童年龄不推测；年龄未齐时不能假定儿童票或酒店加床价格。 */
    adults: z.number().int().min(1).max(20).nullable().default(null),
    children: z.number().int().min(0).max(10).nullable().default(null),
    childAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
    seniors: z.number().int().min(0).max(20).nullable().default(null),
    /** 房间和车辆数必须明确，不能把每间每晚价格当全家总价。 */
    rooms: z.number().int().min(1).max(10).nullable().default(null),
    vehicles: z.number().int().min(1).max(10).nullable().default(null),
    hotelStandard: z.string().max(100).nullable().default(null),
    /** 预算、节奏及个性化条件均可后续局部修改。 */
    budget: tripBudgetSchema.default({
      currency: 'CNY',
      scope: 'total',
      minMinor: null,
      maxMinor: null,
    }),
    pace: z.enum(['relaxed', 'balanced', 'intensive']).nullable().default(null),
    /** 饮食、步行和无障碍要求进入验证器而不是仅留在提示词。 */
    dietary: z.array(z.string().max(100)).max(12).default([]),
    mustVisit: z.array(z.string().max(100)).max(20).default([]),
    mobility: z.enum(['normal', 'limited', 'wheelchair']).nullable().default(null),
    maxWalkMinutes: z.number().int().min(10).max(600).nullable().default(null),
    maxDriveMinutes: z.number().int().min(30).max(600).nullable().default(null),
    notes: z.string().max(2000).default(''),
  })
  .strict();
/** PATCH不携带默认值，先合并已有需求再执行完整规范化与跨字段校验。 */
export const tripRequestPatchSchema = z
  .object({
    /** 仅提交时修改出行方式，未提交不把原选择变回未知。 */
    mode: tripRequestSchema.shape.mode.removeDefault().optional(),
    /** 保留未提交的出发地。 */
    origin: tripRequestSchema.shape.origin.removeDefault().optional(),
    /** 保留未提交的目的地。 */
    destination: tripRequestSchema.shape.destination.removeDefault().optional(),
    /** 日历解释时区只接受明确提交的上海时区。 */
    interpretationTimeZone: tripRequestSchema.shape.interpretationTimeZone
      .removeDefault()
      .optional(),
    /** 当地时区不受其他偏好修改影响。 */
    destinationTimeZone: tripRequestSchema.shape.destinationTimeZone.removeDefault().optional(),
    /** 出发日只在显式提交时改变。 */
    startDate: tripRequestSchema.shape.startDate.removeDefault().optional(),
    /** 止日可以显式清除以重新派生。 */
    endDate: tripRequestSchema.shape.endDate.removeDefault().optional(),
    /** 天数不默认覆盖现有日期范围。 */
    days: tripRequestSchema.shape.days.removeDefault().optional(),
    /** 住宿晚数不能因保存其他资料而重置。 */
    nights: tripRequestSchema.shape.nights.removeDefault().optional(),
    /** 成人数未知和未提交是两种状态。 */
    adults: tripRequestSchema.shape.adults.removeDefault().optional(),
    /** 0儿童是明确值，未提交沿用原人数。 */
    children: tripRequestSchema.shape.children.removeDefault().optional(),
    /** 年龄数组只有显式提交才替换。 */
    childAges: tripRequestSchema.shape.childAges.removeDefault().optional(),
    /** 老人是已确认成人的子集。 */
    seniors: tripRequestSchema.shape.seniors.removeDefault().optional(),
    /** 房间数不因切换预算被清空。 */
    rooms: tripRequestSchema.shape.rooms.removeDefault().optional(),
    /** 车辆数只按明确输入改变。 */
    vehicles: tripRequestSchema.shape.vehicles.removeDefault().optional(),
    /** 住宿标准影响比价口径，禁止隐式改写。 */
    hotelStandard: tripRequestSchema.shape.hotelStandard.removeDefault().optional(),
    /** 预算对象整份替换，未提交沿用原口径。 */
    budget: tripRequestSchema.shape.budget.removeDefault().optional(),
    /** 节奏不使用完整对象默认值覆盖。 */
    pace: tripRequestSchema.shape.pace.removeDefault().optional(),
    /** 饮食数组可以明确清空，缺字段则保留。 */
    dietary: tripRequestSchema.shape.dietary.removeDefault().optional(),
    /** 必去点位只在明确提交时修改。 */
    mustVisit: tripRequestSchema.shape.mustVisit.removeDefault().optional(),
    /** 行动条件不被无关PATCH清空。 */
    mobility: tripRequestSchema.shape.mobility.removeDefault().optional(),
    /** 步行限制未提交时保留。 */
    maxWalkMinutes: tripRequestSchema.shape.maxWalkMinutes.removeDefault().optional(),
    /** 驾驶限制未提交时保留。 */
    maxDriveMinutes: tripRequestSchema.shape.maxDriveMinutes.removeDefault().optional(),
    /** 自由备注不能因其他字段保存而丢失。 */
    notes: tripRequestSchema.shape.notes.removeDefault().optional(),
  })
  .strict();
/** 自然语言提取不覆盖已有确认字段，返回候选供用户修订。 */
export const parseTripRequestSchema = z.object({ text: z.string().min(1).max(4000) }).strict();
/** 完整需求类型由schema推导。 */
export type TripRequest = z.infer<typeof tripRequestSchema>;
/** 字段补丁用于网页和模型工具共用。 */
export type TripRequestPatch = z.infer<typeof tripRequestPatchSchema>;
