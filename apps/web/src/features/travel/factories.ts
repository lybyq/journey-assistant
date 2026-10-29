/** 人工报价默认未知或明确估算，不能生成supplier身份。 */
import type { CostItem, TripRequest, Currency } from '@journey/contracts';
/** 前端按币种精度转换，不合法值不能截断为另一金额。 */
export function amountMinor(text: string, currency: Currency): number | null {
  if (!text.trim()) return null;
  const valid = currency === 'JPY' ? /^\d+$/.test(text) : /^\d+(?:\.\d{1,2})?$/.test(text);
  if (!valid) return Number.NaN;
  const [whole, fraction = ''] = text.split('.');
  return currency === 'JPY' ? Number(whole) : Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
/** 条件全部来自用户已保存需求；未知继续保留null，后端还会再次验证。 */
export function manualCost(
  request: TripRequest,
  options: {
    label: string;
    category: CostItem['category'];
    amount: string;
    quantity: number;
    unit: CostItem['unit'];
    priceType: 'estimate' | 'advertised' | 'unknown';
    sourceUrl?: string;
    notes: string;
    selected?: boolean;
  },
): CostItem {
  return {
    id: crypto.randomUUID(),
    label: options.label,
    category: options.category,
    scopeKey: 'manual:' + crypto.randomUUID(),
    priceType: !options.amount.trim()
      ? 'unknown'
      : options.priceType === 'unknown'
        ? 'estimate'
        : options.priceType,
    unitAmountMinor: amountMinor(options.amount, request.budget.currency),
    currency: request.budget.currency,
    quantity: options.quantity,
    unit: options.unit,
    required: true,
    selected: options.selected ?? false,
    includes: [],
    provenance: 'manual',
    provider: '人工录入',
    sourceUrl: options.sourceUrl?.trim() || null,
    evidenceIds: [],
    checkedAt: new Date().toISOString(),
    validUntil: null,
    conditions: {
      startDate: request.startDate,
      endDate: request.endDate,
      adults: request.adults,
      children: request.children,
      rooms: request.rooms,
      nights: request.nights,
      hotelStandard: request.hotelStandard,
      mandatoryFeesIncluded: null,
    },
    notes: options.notes,
  };
}
