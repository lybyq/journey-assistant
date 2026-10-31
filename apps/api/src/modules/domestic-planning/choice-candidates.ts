/** 候选组合只消费已保存记录，策略标签不制造新车次、酒店或报价。 */
import { createHash } from 'node:crypto';
/** 统一输入继续交给已有行程生成器与独立验证器。 */
import {
  generatePlanSchema,
  type TripDocument,
  type TransportOption,
  type CostItem,
} from '@journey/contracts';
/** 上下文指纹只用于失效检查，不作为用户身份。 */
export function domesticFingerprint(document: TripDocument): string {
  return createHash('sha256')
    .update(
      JSON.stringify(document, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      ),
    )
    .digest('hex');
}
/** 只有实际已知金额可参与参考排序；未知费用不被当作零元。 */
function knownPrice(quote: CostItem | null): number {
  return quote?.unitAmountMinor === null ||
    !quote ||
    quote.currency !== 'CNY' ||
    quote.priceType === 'advertised' ||
    (quote.validUntil !== null && Date.parse(quote.validUntil) <= Date.now())
    ? Number.POSITIVE_INFINITY
    : quote.unitAmountMinor * quote.quantity;
}
/** 车站名称比较仅作旧数据后备；新查询优先保留请求的城市语义。 */
function samePlace(a: string, b: string): boolean {
  const clean = (value: string) => value.replace(/[站市]$/g, '').trim();
  return clean(a).startsWith(clean(b)) || clean(b).startsWith(clean(a));
}
/** 席别只是明确的舒适偏好，不将价格高自动理解为更适合所有人。 */
function seatComfort(option: TransportOption): number {
  return /商务|特等/.test(option.seatType ?? '')
    ? 3
    : /一等/.test(option.seatType ?? '')
      ? 2
      : /无座/.test(option.seatType ?? '')
        ? -1
        : 1;
}
/** 每个策略独立挑选真实候选，再按选择签名去重。 */
export function domesticCandidates(document: TripDocument) {
  const request = document.request;
  /** 自动规划只比较当前起终点最近一轮的实际路线，旧报价不挤占新查询。 */
  const matchingRoutes = document.driving.filter(
    (route) =>
      (!route.queryOrigin || route.queryOrigin === request.origin) &&
      (!route.queryDestination || route.queryDestination === request.destination),
  );
  const latestRoute = [...matchingRoutes].sort(
    (a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt),
  )[0];
  const routes = latestRoute?.comparisonGroupId
    ? matchingRoutes.filter((route) => route.comparisonGroupId === latestRoute.comparisonGroupId)
    : matchingRoutes;
  const knownVehicleCost = (route: (typeof document.driving)[number]) =>
    route.costs.some((cost) => cost.unitAmountMinor !== null) ? route.knownVehicleMinor : Infinity;
  const strategies = ['economy', 'balanced', 'comfort'] as const;
  const labels = { economy: '预算优先', balanced: '均衡安排', comfort: '舒适优先' };
  const result: {
    strategy: (typeof strategies)[number];
    label: string;
    reason: string;
    input: ReturnType<typeof generatePlanSchema.parse>;
  }[] = [];
  const seen = new Set<string>();
  const attractions = document.experiences
    .filter(
      (place) =>
        place.kind === 'attraction' && !/公交站|地铁站|停车场|售票处|检票|出入口/.test(place.name),
    )
    .filter((place, index, all) => all.findIndex((other) => other.name === place.name) === index);
  const hotels = document.experiences.filter((place) => place.kind === 'hotel');
  const usable = document.transport.filter((option) => option.availability !== 'unavailable');
  /** 必去点先保留，不能为做出不同方案而悄悄删除用户硬约束。 */
  const visits = [...attractions].sort(
    (a, b) =>
      Number(request.mustVisit.some((name) => b.name.includes(name))) -
      Number(request.mustVisit.some((name) => a.name.includes(name))),
  );
  for (const strategy of strategies) {
    const compare = (a: TransportOption, b: TransportOption) =>
      strategy === 'economy'
        ? knownPrice(a.quote) - knownPrice(b.quote)
        : strategy === 'comfort'
          ? seatComfort(b) - seatComfort(a) ||
            (a.durationMinutes ?? 100000) - (b.durationMinutes ?? 100000)
          : (a.durationMinutes ?? 100000) +
              a.accessMinutes +
              a.bufferMinutes +
              a.egressMinutes -
              ((b.durationMinutes ?? 100000) +
                b.accessMinutes +
                b.bufferMinutes +
                b.egressMinutes) || knownPrice(a.quote) - knownPrice(b.quote);
    const outbound = usable
      .filter(
        (option) =>
          option.departure?.slice(0, 10) === request.startDate &&
          request.origin &&
          request.destination &&
          samePlace(option.queryOrigin ?? option.origin, request.origin) &&
          samePlace(option.queryDestination ?? option.destination, request.destination),
      )
      .sort(compare)[0];
    const inbound = usable
      .filter(
        (option) =>
          option.departure?.slice(0, 10) === request.endDate &&
          request.origin &&
          request.destination &&
          samePlace(option.queryOrigin ?? option.origin, request.destination) &&
          samePlace(option.queryDestination ?? option.destination, request.origin),
      )
      .sort(compare)[0];
    const hotel = [...hotels].sort((a, b) =>
      strategy === 'economy'
        ? knownPrice(a.quote) - knownPrice(b.quote)
        : Number(Boolean(b.quote)) - Number(Boolean(a.quote)),
    )[0];
    const modes = request.mode ? [request.mode] : (['independent', 'driving', 'group'] as const);
    for (const mode of modes) {
      const route = [...routes].sort((a, b) =>
        strategy === 'economy'
          ? knownVehicleCost(a) - knownVehicleCost(b)
          : strategy === 'balanced'
            ? Number(b.strategy === 'recommended') - Number(a.strategy === 'recommended') ||
              a.totalMinutes - b.totalMinutes
            : a.driveMinutes - b.driveMinutes,
      )[0];
      const tour = [...document.tours]
        .filter((entry) => entry.departureDate === request.startDate && entry.days === request.days)
        .sort((a, b) => knownPrice(a.quote) - knownPrice(b.quote))[0];
      if (
        (mode === 'driving' && !route) ||
        (mode === 'group' && !tour) ||
        (mode === 'independent' && !outbound && !visits.length)
      )
        continue;
      /** 只有用户未要求紧凑节奏时，舒适方案才减少可选活动；必去项全部保留。 */
      const maxVisits =
        strategy === 'comfort' && request.pace !== 'intensive'
          ? Math.max(request.mustVisit.length, (request.days ?? 1) * 2)
          : 9;
      const input = generatePlanSchema.parse({
        mode,
        title: `${labels[strategy]} · ${request.destination ?? '国内出行'}`,
        transportIds: mode === 'independent' ? [outbound?.id, inbound?.id].filter(Boolean) : [],
        hotelId: mode === 'group' ? null : (hotel?.id ?? null),
        drivingId: mode === 'driving' ? route?.id : null,
        tourId: mode === 'group' ? tour?.id : null,
        experienceIds: visits.slice(0, maxVisits).map((place) => place.id),
        costIds: document.costs
          .filter(
            (cost) =>
              cost.selected && !['transport', 'lodging', 'tour', 'driving'].includes(cost.category),
          )
          .map((cost) => cost.id),
      });
      const signature = JSON.stringify({ ...input, title: '' });
      if (seen.has(signature)) continue;
      seen.add(signature);
      result.push({
        strategy,
        label: labels[strategy],
        reason:
          mode === 'driving'
            ? strategy === 'economy'
              ? '优先参考已知车辆费用，缺能源或其他费用时不承诺总价最低。'
              : strategy === 'balanced'
                ? '优先高德推荐路线，费用、休息和预约条件仍需核对。'
                : '优先较短驾驶时长，并保留必去点与休息；不等于保证适合所有人。'
            : strategy === 'economy'
              ? '优先参考已知单价；缺价时不承诺总价最低。'
              : strategy === 'comfort'
                ? '优先明确席别舒适度和可用数据，保留必去点，适当减少可选活动。'
                : '优先门到门耗时与已有候选的可行性，时间和费用仍需按来源条件核对。',
        input,
      });
      if (result.length === 3) return result;
    }
  }
  return result;
}
