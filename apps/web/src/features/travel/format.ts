/** 金额展示只格式化后端整数结果，不在组件心算总价。 */
import type { Currency } from '@journey/contracts';
/** 日元按0位小数，其他当前币种按2位最小单位。 */
export function money(value: number | null | undefined, currency: Currency = 'CNY'): string {
  return value === null || value === undefined
    ? '待确认'
    : new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'JPY' ? 0 : 2,
      }).format(value / (currency === 'JPY' ? 1 : 100));
}
/** 文本标签准确区分授权报价、宣传价、估算和未知。 */
export function priceLabel(value: string): string {
  return (
    (
      {
        live_quote: '授权报价',
        advertised: '页面起价',
        estimate: '估算',
        unknown: '待确认',
      } as Record<string, string>
    )[value] ?? value
  );
}
/** 时长展示保留小时和分钟，避免把90分钟误读成0.9小时。 */
export function minutes(value: number | null): string {
  return value === null ? '耗时待确认' : `${Math.floor(value / 60)}小时${value % 60}分`;
}
/** 版本验证状态直接来自后端，不因UI生成成功就标绿。 */
export function planStatus(value: string): string {
  return (
    (
      {
        validated: '约束验证通过',
        needs_confirmation: '仍需确认',
        invalid: '存在冲突',
      } as Record<string, string>
    )[value] ?? value
  );
}
/** 活动时间使用日内分钟格式化。 */
export function clock(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
