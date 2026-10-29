/** 金额只在本服务中用整数/分数计算，模型只负责解释。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 输入、输出和价格分类都由共享契约控制。 */
import {
  budgetInputSchema,
  costBreakdownSchema,
  type CostItem,
  type Currency,
  type CostBreakdown,
  type TripRequest,
} from '@journey/contracts';
/** 日元最小单位是1，其他当前支持币种为0.01。 */
export const CURRENCY_EXPONENT: Record<Currency, number> = {
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  JPY: 0,
};
/** 小数文本转最小单位，禁止浮点parseFloat乘100后四舍五入。 */
export function decimalMinor(text: string, currency: Currency): number {
  const exponent = CURRENCY_EXPONENT[currency];
  if (!new RegExp(`^\\d{1,10}(?:\\.\\d{1,${Math.max(1, exponent)}})?$`).test(text))
    throw new BadRequestException('供应商金额格式不合法');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent)))
    throw new BadRequestException('币种不支持该小数精度');
  const value =
    BigInt(whole!) * 10n ** BigInt(exponent) +
    BigInt(fraction.slice(0, exponent).padEnd(exponent, '0') || '0');
  if (value > 1000000000n) throw new BadRequestException('金额超出允许范围');
  return Number(value);
}
/** 所有四舍五入都采用正整数分数，结果可以逐项复算。 */
export function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new BadRequestException('除数必须大于0');
  return (numerator * 2n + denominator) / (denominator * 2n);
}
/** 统一报价条件由已确认需求生成；未知条件继续保留null。 */
export function requestConditions(request: TripRequest) {
  return {
    startDate: request.startDate,
    endDate: request.endDate,
    adults: request.adults,
    children: request.children,
    rooms: request.rooms,
    nights: request.nights,
    hotelStandard: request.hotelStandard,
    mandatoryFeesIncluded: null,
  };
}
/** 预算计算是无网络副作用的确定性函数，方便单独学习与测试。 */
@Injectable()
export class PricingService {
  /** 把已选择费用转为目标币种，未选择费用不计入合计。 */
  calculate(value: ReturnType<typeof budgetInputSchema.parse>, now = new Date()): CostBreakdown {
    /** 入口始终校验，不依赖调用者恰好已经验证过。 */
    const input = budgetInputSchema.parse(value);
    const selected = input.items.filter((item) => item.selected);
    const issues: string[] = [];
    const scope = new Map<string, string>();
    let total = 0n;
    let complete = true;
    let ranking = true;
    /** 同一ID不能重复进账，不能靠更换显示名称绕过。 */
    if (new Set(input.items.map((item) => item.id)).size !== input.items.length)
      throw new BadRequestException('费用ID重复');
    /** 每一行保留排除原因，旅行团包含酒店时不会再次累计酒店费用。 */
    const lines = selected.map((item) => {
      /** 两个包价互相覆盖不能静默选择其中一个。 */
      const packages = selected.filter(
        (other) => other.id !== item.id && other.includes.includes(item.category as 'lodging'),
      );
      if (packages.length) {
        if (item.includes.length || packages.length > 1) {
          issues.push(`${item.label}存在多个包价包含关系，请只保留一个明确组合`);
          ranking = false;
          complete = false;
        }
        return {
          id: item.id,
          amountMinor: 0,
          excludedBy: packages[0]!.id,
          reason: '已包含在选中的包价中',
        };
      }
      /** 同口径重复项明确排除并取消排名资格。 */
      const duplicate = scope.get(item.scopeKey);
      if (duplicate) {
        issues.push(`${item.label}的费用口径重复`);
        ranking = false;
        return {
          id: item.id,
          amountMinor: 0,
          excludedBy: duplicate,
          reason: '重复费用口径，未再次累计',
        };
      }
      scope.set(item.scopeKey, item.id);
      /** 必填价格未知时仍显示已知小计，但不能叫完整总价。 */
      if (item.unitAmountMinor === null) {
        complete = false;
        ranking = false;
        issues.push(`${item.label}价格未知`);
        return {
          id: item.id,
          amountMinor: null,
          excludedBy: null,
          reason: '缺少金额',
        };
      }
      /** 广告起价和过期报价不能参与最便宜排名。 */
      if (item.priceType === 'advertised') {
        ranking = false;
        issues.push(`${item.label}是页面宣传价，不能作为可预订报价排名`);
      }
      if (
        item.priceType === 'live_quote' &&
        (!item.validUntil || Date.parse(item.validUntil) <= now.getTime())
      ) {
        ranking = false;
        issues.push(`${item.label}报价已过期，需要重新查询`);
      }
      /** 未确认税费的供应商价格最多是部分价格。 */
      if (item.priceType === 'live_quote' && item.conditions.mandatoryFeesIncluded !== true) {
        ranking = false;
        issues.push(`${item.label}尚未确认全部强制税费`);
      }
      let amount = BigInt(item.unitAmountMinor) * BigInt(item.quantity);
      /** 跨币种必须存在仍有效、指向当前目标币种的明确汇率。 */
      if (item.currency !== input.currency) {
        const rate = input.rates.find(
          (rate) =>
            rate.from === item.currency &&
            rate.to === input.currency &&
            Date.parse(rate.validUntil) > now.getTime() &&
            Date.parse(rate.checkedAt) <= now.getTime() + 60000,
        );
        if (!rate) {
          complete = false;
          ranking = false;
          issues.push(`${item.label}缺少有效的${item.currency}→${input.currency}汇率`);
          return {
            id: item.id,
            amountMinor: null,
            excludedBy: null,
            reason: '缺少有效汇率',
          };
        }
        const [whole, fraction = ''] = rate.rate.split('.');
        const denominator = 10n ** BigInt(fraction.length);
        const numerator = BigInt(whole!) * denominator + BigInt(fraction || '0');
        amount = roundedDivide(
          amount * numerator * 10n ** BigInt(CURRENCY_EXPONENT[input.currency]),
          denominator * 10n ** BigInt(CURRENCY_EXPONENT[item.currency]),
        );
        if (rate.kind === 'estimate') {
          ranking = false;
          issues.push(`${item.label}使用估算汇率`);
        }
      }
      /** 所有安全整数检查在转回number之前完成。 */
      if (amount > 1000000000n) throw new BadRequestException('单项费用超过支持上限');
      total += amount;
      return {
        id: item.id,
        amountMinor: Number(amount),
        excludedBy: null,
        reason: null,
      };
    });
    /** 预备金采用基点，1000bps就是10%，仍按整数分数计算。 */
    const reserve = roundedDivide(total * BigInt(input.reserveBps), 10000n);
    const full = total + reserve;
    if (full > 1000000000n) throw new BadRequestException('预算总额超过支持上限');
    /** 分摊差额分配给前几位，分摊金额总和严格等于总额。 */
    const base = full / BigInt(input.people);
    const extra = Number(full % BigInt(input.people));
    const allocation = Array.from(
      { length: input.people },
      (_, index) => Number(base) + (index < extra ? 1 : 0),
    );
    /** 空费用集合不能冒充0元完整旅行方案。 */
    if (!selected.length) {
      complete = false;
      ranking = false;
      issues.push('尚未选择任何费用项');
    }
    return costBreakdownSchema.parse({
      currency: input.currency,
      knownTotalMinor: Number(total),
      reserveMinor: Number(reserve),
      totalWithReserveMinor: Number(full),
      perPersonMinor: allocation[0] ?? 0,
      allocationMinor: allocation,
      complete,
      rankingEligible: ranking && complete,
      issues: issues.slice(0, 100),
      lines,
    });
  }
  /** 与当前旅行需求比较报价条件，拒绝用另一日期/人数的便宜价混排。 */
  conditionIssues(items: CostItem[], request: TripRequest): string[] {
    const issues: string[] = [];
    for (const item of items.filter((item) => item.selected)) {
      const c = item.conditions;
      for (const field of ['startDate', 'endDate', 'adults', 'children'] as const) {
        if (request[field] === null || c[field] === null)
          issues.push(`${item.label}的${field}尚未确认`);
        else if (c[field] !== request[field])
          issues.push(`${item.label}的${field}与旅行需求不一致`);
      }
      if (item.category === 'lodging' || item.category === 'tour') {
        for (const field of ['rooms', 'nights', 'hotelStandard'] as const)
          if (request[field] === null || c[field] === null || request[field] !== c[field])
            issues.push(`${item.label}的${field}口径不完整或不一致`);
      }
    }
    return issues.slice(0, 100);
  }
}
