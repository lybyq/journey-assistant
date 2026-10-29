/** 交通、自驾、住宿与旅行团保留各自条件，不混成营销卡片。 */
import { z } from 'zod';
/** 复用报价契约与地理坐标，不在各模块重复定义金额。 */
import {
  calendarDate,
  pointSchema,
  shortText,
  sourceUrlSchema,
  minorSchema,
} from './travel-common.js';
/** 报价必须包含完整条件和数据性质。 */
import { costItemSchema } from './travel-pricing.js';
/** 门到门时长包括接驳和缓冲，余票不等于已经出票。 */
export const transportOptionSchema = z
  .object({
    id: z.string().uuid(),
    mode: z.enum(['rail', 'flight', 'transfer']),
    label: shortText,
    origin: shortText,
    destination: shortText,
    departure: z.string().max(80).nullable(),
    arrival: z.string().max(80).nullable(),
    durationMinutes: z.number().int().min(0).max(10000).nullable(),
    accessMinutes: z.number().int().min(0).max(600),
    bufferMinutes: z.number().int().min(0).max(600),
    egressMinutes: z.number().int().min(0).max(600),
    transfers: z.number().int().min(0).max(10),
    availability: z.enum(['available', 'unavailable', 'unknown']),
    seatType: z.string().max(100).nullable(),
    quote: costItemSchema.nullable(),
    evidenceIds: z.array(z.string().uuid()).max(15),
    checkedAt: z.string().datetime(),
    notes: z.string().max(2000),
  })
  .strict();
/** 12306站点名和售票范围由服务端解析；儿童年龄信息必须另行确认。 */
export const railQuerySchema = z
  .object({
    date: calendarDate,
    origin: shortText,
    destination: shortText,
    accessMinutes: z.number().int().min(0).max(600).default(30),
    egressMinutes: z.number().int().min(0).max(600).default(30),
    bufferMinutes: z.number().int().min(0).max(600).default(30),
    interline: z.boolean().default(false),
  })
  .strict();
/** 航班编码和供应商环境由明确字段决定，不猜中文城市对应机场。 */
export const flightQuerySchema = z
  .object({
    originCode: z.string().regex(/^[A-Z]{3}$/),
    destinationCode: z.string().regex(/^[A-Z]{3}$/),
    returnDate: calendarDate.nullable().default(null),
  })
  .strict();
/** 公里、分钟和油电单价均采用有名称的确定单位。 */
export const drivingInputSchema = z
  .object({
    origin: pointSchema,
    destination: pointSchema,
    waypoints: z.array(pointSchema).max(5).default([]),
    energy: z.enum(['fuel', 'electric']),
    consumptionPer100: z.string().regex(/^\d{1,3}(?:\.\d{1,3})?$/),
    energyUnitPriceMinor: minorSchema,
    energyPriceSource: shortText,
    tollMinor: minorSchema.nullable(),
    parkingMinor: minorSchema.nullable(),
    rentalMinor: minorSchema.nullable().default(null),
    insuranceMinor: minorSchema.nullable().default(null),
    chargingMinutes: z.number().int().min(0).max(600).default(0),
    restEveryMinutes: z.number().int().min(30).max(240).default(120),
    restMinutes: z.number().int().min(10).max(120).default(20),
    currency: z.enum(['CNY']).default('CNY'),
  })
  .strict();
/** 路线费用中的未知项独立列出，不能按零元补齐。 */
export const drivingRouteSchema = z
  .object({
    id: z.string().uuid(),
    origin: pointSchema,
    destination: pointSchema,
    waypoints: z.array(pointSchema).max(5),
    distanceMeters: z.number().int().min(0),
    driveMinutes: z.number().int().min(0),
    restMinutes: z.number().int().min(0),
    chargingMinutes: z.number().int().min(0),
    totalMinutes: z.number().int().min(0),
    energyMinor: minorSchema,
    knownVehicleMinor: minorSchema,
    unknownCosts: z.array(z.string()).max(10),
    perPersonMinor: minorSchema.nullable(),
    checkedAt: z.string().datetime(),
    assumptions: z.array(z.string().max(300)).max(15),
    warnings: z.array(z.string().max(300)).max(15),
    path: z.array(pointSchema).max(1500),
    costs: z.array(costItemSchema).max(8),
  })
  .strict();
/** 开放时间和预约证据与价格分开；未核实不等于全天开放。 */
export const experienceSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['hotel', 'attraction', 'restaurant']),
    name: shortText,
    point: pointSchema.nullable(),
    address: z.string().max(300),
    opening: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          open: z.string().regex(/^\d{2}:\d{2}$/),
          close: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      )
      .max(21),
    closedDates: z.array(calendarDate).max(40),
    reservation: z.enum(['required', 'not_required', 'unknown']),
    accessible: z.boolean().nullable(),
    childPolicy: z.string().max(1000),
    cancellation: z.string().max(1500),
    breakfastIncluded: z.boolean().nullable(),
    evidenceIds: z.array(z.string().uuid()).max(15),
    quote: costItemSchema.nullable(),
    notes: z.string().max(1500),
  })
  .strict();
/** 团期、起价、单房差、自费和购物点都必须显式呈现。 */
export const tourProductSchema = z
  .object({
    id: z.string().uuid(),
    name: shortText,
    departureDate: calendarDate.nullable(),
    departureCity: shortText,
    days: z.number().int().min(1).max(30),
    hotelStandard: z.string().max(100).nullable(),
    included: z.array(shortText).max(30),
    excluded: z.array(shortText).max(30),
    shoppingStops: z.array(shortText).max(20),
    optionalActivities: z.array(shortText).max(20),
    singleSupplementMinor: minorSchema.nullable(),
    guide: z.string().max(200).nullable(),
    pickup: z.string().max(500).nullable(),
    cancellation: z.string().max(1500),
    quote: costItemSchema,
    sourceUrl: sourceUrlSchema,
    evidenceIds: z.array(z.string().uuid()).max(20),
    needsConfirmation: z.array(shortText).max(20),
    /** 供应商或人工明确提供的逐日安排；空数组表示尚未取得日程。 */
    dailySchedule: z
      .array(
        z
          .object({
            day: z.number().int().min(1).max(30),
            title: shortText,
            startMinute: z.number().int().min(0).max(1439),
            endMinute: z.number().int().min(1).max(1440),
            point: pointSchema.nullable(),
            notes: z.string().max(1000),
          })
          .strict()
          .refine((item) => item.endMinute > item.startMinute, '团日程结束必须晚于开始'),
      )
      .max(120)
      .default([]),
  })
  .strict();
/** 地图检索只接受固定类别，不允许客户端指定MCP工具名称。 */
export const placeQuerySchema = z
  .object({
    keywords: z.string().min(1).max(120),
    city: z.string().min(1).max(80),
    kind: z.enum(['hotel', 'attraction', 'restaurant']),
  })
  .strict();
/** 酒店查询必须使用明确IATA城市代码，日期/房间从已确认需求读取。 */
export const hotelQuerySchema = z.object({ cityCode: z.string().regex(/^[A-Z]{3}$/) }).strict();
/** 这些类型分别由第08～旅行团的独立服务处理。 */
export type TransportOption = z.infer<typeof transportOptionSchema>;
/** 自驾结果保留车辆总价与人均口径。 */
export type DrivingRoute = z.infer<typeof drivingRouteSchema>;
/** 住宿、景点和餐饮候选供行程版本选择。 */
export type Experience = z.infer<typeof experienceSchema>;
/** 跟团产品不会因名称相同而被合并。 */
export type TourProduct = z.infer<typeof tourProductSchema>;
