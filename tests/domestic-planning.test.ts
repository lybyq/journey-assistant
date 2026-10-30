/** 预算排序、方案差异和去返程选择必须依据真实记录而非策略标题。 */
import { describe, expect, it } from 'vitest';
import {
  tripDocumentSchema,
  tripRequestSchema,
  transportOptionSchema,
  experienceSchema,
  type CostItem,
  type TransportOption,
} from '@journey/contracts';
import {
  domesticCandidates,
  domesticFingerprint,
} from '../apps/api/dist/modules/domestic-planning/choice-candidates.js';
const request = tripRequestSchema.parse({
  origin: '杭州',
  destination: '苏州',
  startDate: '2026-11-01',
  endDate: '2026-11-02',
  days: 2,
  nights: 1,
  adults: 2,
  children: 0,
  mode: 'independent',
  destinationTimeZone: 'Asia/Shanghai',
});
/** 报价只作为测试数据，不发给生产用户。 */
function quote(amount: number | null): CostItem {
  return {
    id: crypto.randomUUID(),
    label: '测试车票',
    category: 'transport',
    scopeKey: crypto.randomUUID(),
    priceType: amount === null ? 'unknown' : 'estimate',
    unitAmountMinor: amount,
    currency: 'CNY',
    quantity: 2,
    unit: 'person',
    required: true,
    selected: true,
    includes: [],
    provenance: 'manual',
    provider: '协议测试',
    sourceUrl: null,
    evidenceIds: [],
    checkedAt: new Date().toISOString(),
    validUntil: null,
    conditions: {
      startDate: request.startDate,
      endDate: request.endDate,
      adults: 2,
      children: 0,
      rooms: null,
      nights: 1,
      hotelStandard: null,
      mandatoryFeesIncluded: null,
    },
    notes: '',
  };
}
function rail(patch: Partial<TransportOption> = {}) {
  return transportOptionSchema.parse({
    id: crypto.randomUUID(),
    mode: 'rail',
    label: '测试G车次',
    origin: '杭州东',
    destination: '苏州北',
    queryOrigin: '杭州',
    queryDestination: '苏州',
    departure: '2026-11-01T09:00:00+08:00',
    arrival: '2026-11-01T11:00:00+08:00',
    durationMinutes: 120,
    accessMinutes: 30,
    egressMinutes: 30,
    bufferMinutes: 30,
    transfers: 0,
    availability: 'available',
    seatType: '二等座',
    quote: quote(10000),
    evidenceIds: [],
    checkedAt: new Date().toISOString(),
    notes: '',
    ...patch,
  });
}
function document(transport: TransportOption[] = []) {
  return tripDocumentSchema.parse({
    request,
    transport,
    evidence: [],
    driving: [],
    experiences: [],
    tours: [],
    costs: [],
    rates: [],
  });
}
describe('国内多方案决策', () => {
  it('没有候选时不编造三套方案，只有一套真实组合时只返回一套', () => {
    expect(domesticCandidates(document())).toHaveLength(0);
    expect(domesticCandidates(document([rail()]))).toHaveLength(1);
  });
  it('未知价格不当零元；预算、门到门时间和席别形成实际不同选择', () => {
    const cheap = rail({ quote: quote(5000), durationMinutes: 180 }),
      fast = rail({ quote: quote(12000), durationMinutes: 60 }),
      comfort = rail({ quote: quote(null), seatType: '商务座', durationMinutes: 90 });
    const options = domesticCandidates(document([comfort, cheap, fast]));
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.input.transportIds[0])).toEqual([
      cheap.id,
      fast.id,
      comfort.id,
    ]);
    expect(new Set(options.map((option) => JSON.stringify(option.input.transportIds))).size).toBe(
      3,
    );
  });
  it('方向和日期绑定查询城市，不会把返程误选成去程，也不选无票车次', () => {
    const outbound = rail(),
      inbound = rail({
        origin: '苏州北',
        destination: '杭州东',
        queryOrigin: '苏州',
        queryDestination: '杭州',
        departure: '2026-11-02T18:00:00+08:00',
        arrival: '2026-11-02T20:00:00+08:00',
      }),
      unavailable = rail({ availability: 'unavailable', quote: quote(1) });
    expect(
      domesticCandidates(document([inbound, unavailable, outbound]))[0]!.input.transportIds,
    ).toEqual([outbound.id, inbound.id]);
  });
  it('有日程差异才增加舒适方案，始终保留必去点', () => {
    const doc = document();
    doc.request = {
      ...request,
      days: 1,
      nights: 0,
      endDate: request.startDate,
      mustVisit: ['必去点'],
    };
    doc.experiences = Array.from({ length: 5 }, (_, index) =>
      experienceSchema.parse({
        id: crypto.randomUUID(),
        kind: 'attraction',
        name: index === 4 ? '必去点' : '地点' + index,
        point: null,
        address: '',
        opening: [],
        closedDates: [],
        reservation: 'unknown',
        accessible: null,
        childPolicy: '',
        cancellation: '',
        breakfastIncluded: null,
        evidenceIds: [],
        quote: null,
        notes: '',
      }),
    );
    const options = domesticCandidates(doc);
    expect(options).toHaveLength(2);
    expect(options[1]!.input.experienceIds).toContain(doc.experiences[4]!.id);
    expect(options[1]!.input.experienceIds).toHaveLength(2);
  });
  it('需求、来源或候选变化均使指纹变化，读取不修改输入', () => {
    const doc = document([rail()]),
      before = JSON.stringify(doc),
      fingerprint = domesticFingerprint(doc);
    domesticCandidates(doc);
    expect(JSON.stringify(doc)).toBe(before);
    const reordered = Object.fromEntries(Object.entries(doc).reverse()) as typeof doc;
    expect(domesticFingerprint(reordered)).toBe(fingerprint);
    doc.request.adults = 3;
    expect(domesticFingerprint(doc)).not.toBe(fingerprint);
  });
  it('用户明确自驾或跟团时不拿自由行冒充该模式', () => {
    const doc = document([rail()]);
    doc.request.mode = 'group';
    expect(domesticCandidates(doc)).toHaveLength(0);
    doc.request.mode = 'driving';
    expect(domesticCandidates(doc)).toHaveLength(0);
  });
});

/** 真实问答发现的时间窗与缺项问题必须进入纯领域回归。 */
import { buildAutoPlan } from '../apps/api/dist/modules/travel-plans/auto-plan.js';
import { validatePlan } from '../apps/api/dist/modules/travel-plans/plan-validator.js';
import { PricingService } from '../apps/api/dist/modules/travel-pricing/pricing.service.js';
import { generatePlanSchema } from '@journey/contracts';
function attraction(name: string, index = 0) {
  return experienceSchema.parse({
    id: crypto.randomUUID(),
    kind: 'attraction',
    name,
    point: { lng: 120.6 + index * 0.001, lat: 31.3, coordinateSystem: 'GCJ-02' },
    address: '协议测试',
    opening: [],
    closedDates: [],
    reservation: 'unknown',
    accessible: null,
    childPolicy: '',
    cancellation: '',
    breakfastIncluded: null,
    evidenceIds: [],
    quote: null,
    notes: '',
  });
}
describe('真实问答编排缺陷回归', () => {
  it('晚间返程保留当天白天可游玩时间，不把返程结束时间作为游玩起点', () => {
    const doc = document();
    doc.experiences = Array.from({ length: 5 }, (_, i) => attraction('地点' + i, i));
    const inbound = rail({
      queryOrigin: '苏州',
      queryDestination: '杭州',
      origin: '苏州北',
      destination: '杭州东',
      departure: '2026-11-02T20:00:00+08:00',
      arrival: '2026-11-02T22:00:00+08:00',
    });
    doc.transport = [inbound];
    doc.costs = [inbound.quote!];
    const draft = buildAutoPlan(
      doc,
      generatePlanSchema.parse({
        mode: 'independent',
        transportIds: [inbound.id],
        experienceIds: doc.experiences.map((place) => place.id),
      }),
    );
    const day = draft.days[1]!,
      back = day.items.find((item) => item.referenceId === inbound.id)!;
    const visits = day.items.filter((item) => item.kind === 'visit');
    expect(visits).toHaveLength(2);
    expect(visits.every((item) => item.endMinute < back.startMinute)).toBe(true);
  });
  it('必去点不会被附近附属候选挤到行程之外', () => {
    const doc = document();
    doc.request = {
      ...request,
      days: 1,
      nights: 0,
      endDate: request.startDate,
      mustVisit: ['必去博物馆'],
    };
    doc.experiences = [
      attraction('近处1'),
      attraction('近处2'),
      attraction('近处3'),
      attraction('必去博物馆', 100),
    ];
    const draft = buildAutoPlan(
      doc,
      generatePlanSchema.parse({
        mode: 'independent',
        experienceIds: doc.experiences.map((place) => place.id),
      }),
    );
    expect(draft.days[0]!.items.find((item) => item.kind === 'visit')?.title).toBe('必去博物馆');
  });
  it('住宿类别只产生一个缺项，不把lodging字符串拆成字母', () => {
    const doc = document(),
      draft = buildAutoPlan(doc, generatePlanSchema.parse({ mode: 'independent' }));
    const budget = new PricingService().calculate({
      items: [],
      currency: 'CNY',
      people: 2,
      rates: [],
      reserveBps: 0,
    });
    const missing = validatePlan(draft, doc, budget).filter(
      (issue) => issue.code === 'MISSING_COST_CATEGORY',
    );
    expect(missing.map((issue) => issue.message)).toEqual([
      '未覆盖transport费用，不能比较完整出行总价',
      '未覆盖meal费用，不能比较完整出行总价',
      '未覆盖lodging费用，不能比较完整出行总价',
    ]);
  });
  it('同名景点和交通站点不能靠更换ID变成不同游玩体验', () => {
    const doc = document();
    doc.experiences = [
      attraction('外滩'),
      attraction('外滩'),
      attraction('外滩(公交站)'),
      attraction('博物馆'),
    ];
    const options = domesticCandidates(doc);
    expect(options[0]!.input.experienceIds).toHaveLength(2);
  });
});

/** 查询日是沿途上车日，列车始发日不得污染去返程的日历匹配。 */
import { railTimes } from '../apps/api/dist/modules/travel-transport/transport.service.js';
describe('12306沿途上车与跨夜日期', () => {
  it('基于查询日计算去程和返程，不依赖可能早两天的列车始发日', () => {
    expect(railTimes('2026-11-02', '17:00', '02:15')).toEqual({
      departure: '2026-11-02T17:00:00+08:00',
      arrival: '2026-11-02T19:15:00+08:00',
    });
  });
  it('历时跨午夜时推进实际到达日，格式无效则保留未知', () => {
    expect(railTimes('2026-11-02', '23:30', '03:00').arrival).toBe('2026-11-03T02:30:00+08:00');
    expect(railTimes('2026-11-02', '25:30', '03:00').departure).toBeNull();
    expect(railTimes('2026-11-02', '12:30', null).arrival).toBeNull();
  });
});

/** 不同币种和已过期价格不参与预算优先的可比单价排序。 */
it('预算参考排除未换算的外币和过期票价', () => {
  const current = rail({ quote: quote(5000) }),
    foreign = rail({ quote: { ...quote(1), currency: 'USD' } }),
    expired = rail({ quote: { ...quote(1), validUntil: '2020-01-01T00:00:00Z' } });
  expect(domesticCandidates(document([foreign, expired, current]))[0]!.input.transportIds[0]).toBe(
    current.id,
  );
});

/** 模型摘要也必须沿用冻结报价，不能把后续刷新价误说成旧方案的依据。 */
import { domesticDecisionSummary } from '../apps/api/dist/modules/domestic-planning/decision-summary.js';
import { domesticDecisionSchema, planVersionSchema } from '@journey/contracts';
it('方案摘要保持编号、所选席别和冻结预算，常见三方案响应保持有界', () => {
  const selected = rail({ seatType: '商务座', quote: quote(10000) }),
    doc = document([selected]),
    tripId = crypto.randomUUID(),
    now = new Date().toISOString();
  doc.costs = [selected.quote!];
  const draft = buildAutoPlan(
    doc,
    generatePlanSchema.parse({ mode: 'independent', transportIds: [selected.id] }),
  );
  const budget = new PricingService().calculate({
    items: [selected.quote!],
    currency: 'CNY',
    people: 2,
    rates: [],
    reserveBps: 1000,
  });
  const version = planVersionSchema.parse({
    id: crypto.randomUUID(),
    tripId,
    version: 1,
    parentId: null,
    createdAt: now,
    reason: '协议测试',
    draft,
    violations: [],
    status: 'needs_confirmation',
    budget,
    prices: [selected.quote!],
  });
  const decision = domesticDecisionSchema.parse({
    workspace: {
      id: tripId,
      title: '摘要协议',
      conversationId: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archived: false,
      document: doc,
      versions: [],
      activeVersionId: null,
      clarifications: [],
    },
    optionSet: {
      id: crypto.randomUUID(),
      tripId,
      createdAt: now,
      contextFingerprint: domesticFingerprint(doc),
      market: 'CN',
      options: ['economy', 'balanced', 'comfort'].map((strategy, index) => ({
        strategy,
        label: '方案' + index,
        reason: '参考候选',
        version: { ...version, id: crypto.randomUUID() },
      })),
      limitations: ['费用不完整'],
    },
    stale: false,
  });
  decision.workspace!.document.transport[0]!.quote!.unitAmountMinor = 1;
  const summary = domesticDecisionSummary(decision);
  expect(summary.options!.map((option) => option.ordinal)).toEqual([1, 2, 3]);
  expect(summary.options![2]!.transport![0]).toMatchObject({
    seat: '商务座',
    unitAmountMinor: 10000,
  });
  expect(summary.options![2]!.budget).toMatchObject({
    knownSubtotalMinor: 20000,
    knownWithReserveMinor: 22000,
  });
  expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThan(7000);
});
