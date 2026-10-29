/** 领域契约只依赖Zod，网页与服务端复用同一份边界。 */
import { z } from 'zod';
/** 日期是日历日期而不是UTC时间戳，额外拒绝2月30日等无效日期。 */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    '日期不存在',
  );
/** 仅支持已明确最小货币单位的币种，不能默认所有币种都是两位小数。 */
export const currencySchema = z.enum(['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY']);
/** 金额采用安全整数最小单位，避免浮点心算和无界数量。 */
export const minorSchema = z.number().int().min(0).max(1_000_000_000);
/** 限定公共链接；原始秘密和URL查询仍由服务端的ToolSafety清理。 */
export const sourceUrlSchema = z
  .string()
  .url()
  .max(1500)
  .refine((value) => {
    try {
      const u = new URL(value);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
    } catch {
      return false;
    }
  }, '来源必须是HTTP链接且不能含认证信息');
/** 经纬度统一采用高德返回的GCJ-02坐标；其他坐标系不能静默混用。 */
export const pointSchema = z
  .object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    coordinateSystem: z.literal('GCJ-02').default('GCJ-02'),
  })
  .strict();
/** 可阅读的有界字符串，原始网页HTML不进入领域视图。 */
export const shortText = z.string().trim().min(1).max(300);
/** 类型从契约推导，避免网页另写一套接口。 */
export type Currency = z.infer<typeof currencySchema>;
/** 地图点在多个业务模块复用。 */
export type GeoPoint = z.infer<typeof pointSchema>;
