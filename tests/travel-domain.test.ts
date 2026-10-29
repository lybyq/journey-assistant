/** 验证容易出现错价、错日期与不可行行程的真实领域边界。 */
import { describe, expect, it } from 'vitest';
/** 共享契约和测试输入使用相同校验。 */
import {
  tripRequestSchema,
  tripDocumentSchema,
  budgetInputSchema,
  type CostItem,
  type PlanDraft,
  type TripDocument,
} from '@journey/contracts';
/** 测试编译后的Nest领域类，保留实际生产依赖。 */
import { TripRequestService } from '../apps/api/dist/modules/trip-request/request.service.js';
/** 整数金额、汇率和分摊实现。 */
import {
  PricingService,
  decimalMinor,
  requestConditions,
} from '../apps/api/dist/modules/travel-pricing/pricing.service.js';
/** 油电费与疲劳驾驶的基础计算。 */
import { energyCostMinor } from '../apps/api/dist/modules/travel-driving/driving.service.js';
/** 验证器不运行模型。 */
import { validatePlan } from '../apps/api/dist/modules/travel-plans/plan-validator.js';
/** 手工报价身份保护。 */
import { assertManualQuote } from '../apps/api/dist/modules/travel-pricing/quote.service.js';
/** 自动编排也使用生产纯函数，验证真实班次/路线/产品是否真正进入日程。 */
import { buildAutoPlan } from '../apps/api/dist/modules/travel-plans/auto-plan.js';
/** 生成入口默认值由正式协议补齐。 */
import { generatePlanSchema } from '@journey/contracts';
/** 固定时间使到期判断可以重复验证。 */
const now = new Date('2026-10-28T00:00:00Z');
const requests = new TripRequestService();
const pricing = new PricingService();
/** 完整需求用于检查同口径与明确的未知值。 */
const request = tripRequestSchema.parse({
  origin: '杭州',
  destination: '苏州',
  startDate: '2026-10-29',
  endDate: '2026-10-29',
  days: 1,
  nights: 0,
  adults: 2,
  children: 0,
  rooms: 1,
  hotelStandard: '舒适型',
  destinationTimeZone: 'Asia/Shanghai',
  budget: { currency: 'CNY', scope: 'total', minMinor: null, maxMinor: 100000 },
  maxWalkMinutes: 120,
  maxDriveMinutes: 240,
});
/** 每个费用可在测试中只改关心的真实条件。 */
function cost(patch: Partial<CostItem> = {}): CostItem {
  return {
    id: crypto.randomUUID(),
    label: '费用',
    category: 'meal',
    scopeKey: crypto.randomUUID(),
    priceType: 'estimate',
    unitAmountMinor: 1001,
    currency: 'CNY',
    quantity: 1,
    unit: 'trip',
    required: true,
    selected: true,
    includes: [],
    provenance: 'manual',
    provider: '用户提供估算',
    sourceUrl: null,
    evidenceIds: [],
    checkedAt: now.toISOString(),
    validUntil: null,
    conditions: { ...requestConditions(request), mandatoryFeesIncluded: true },
    notes: '明确测试假设',
    ...patch,
  };
}
/** 不复制计算实现，只调用真实入口并断言业务意义。 */
const calculate = (items: CostItem[], extra: Record<string, unknown> = {}) =>
  pricing.calculate(
    budgetInputSchema.parse({
      items,
      currency: 'CNY',
      people: 3,
      rates: [],
      reserveBps: 0,
      ...extra,
    }),
    now,
  );
/** 常见中文表达和日期边界。 */
describe('旅行需求需求规范化', () => {
  /** 人均和总额不能混淆，儿童人数和年龄分开。 */
  it('准确识别两大一小、三天两晚和人均预算', () => {
    const patch = requests.extract(
      '明天从杭州去苏州，两大一小，三天两晚，人均预算3000元，自由行',
      now,
    );
    const value = requests.normalize(patch);
    expect(value).toMatchObject({
      origin: '杭州',
      destination: '苏州',
      startDate: '2026-10-29',
      endDate: '2026-10-31',
      days: 3,
      nights: 2,
      adults: 2,
      children: 1,
      budget: { scope: 'per_person', minMinor: 300000, maxMinor: 300000 },
    });
    expect(value.childAges).toEqual([]);
    expect(requests.clarifications(value).some((item) => item.field === 'childAges')).toBe(true);
  });
  /** 日期解析跨月跨年，未知值不能补成事实。 */
  it('按上海日历跨年并保留未知人数', () => {
    const value = requests.normalize(
      requests.extract('明天出发，两天一晚', new Date('2026-12-31T10:00:00Z')),
    );
    expect(value.startDate).toBe('2027-01-01');
    expect(value.endDate).toBe('2027-01-02');
    expect(value.adults).toBeNull();
  });
  /** 每次保存其他资料时不能把用户确认的晚数重算掉。 */
  it('不覆盖已确认的非默认住宿晚数', () => {
    const value = requests.normalize({
      days: 5,
      nights: 3,
      startDate: '2026-10-29',
    });
    expect(requests.normalize({}, value).nights).toBe(3);
  });
  /** 无效日历日期和冲突范围必须被拒绝。 */
  it('拒绝无效日期、冲突天数和儿童年龄数量', () => {
    expect(() => requests.normalize({ startDate: '2026-02-30', days: 2 })).toThrow();
    expect(() =>
      requests.normalize({
        startDate: '2026-10-29',
        endDate: '2026-10-30',
        days: 3,
      }),
    ).toThrow();
    expect(() => requests.normalize({ children: 1, childAges: [6, 8] })).toThrow();
  });
});
/** 与真实金钱错误直接相关的计算边界。 */
describe('自驾规划与12确定性费用', () => {
  /** 100公里、百公里8升、8元每升应为64元。 */
  it('油电消耗使用精确整数单位', () => {
    expect(energyCostMinor(100000, '8', 800)).toBe(6400);
    expect(energyCostMinor(123456, '15.125', 100)).toBe(1867);
  });
  /** 最小货币单位随币种不同。 */
  it('币种精度与小数金额不会出现浮点尾差', () => {
    expect(decimalMinor('0.10', 'CNY')).toBe(10);
    expect(decimalMinor('123', 'JPY')).toBe(123);
    expect(() => decimalMinor('1.10', 'JPY')).toThrow();
  });
  /** 未知项不能被吞成零元完整预算。 */
  it('保留已知小计并阻止未知预算排名', () => {
    const output = calculate([cost(), cost({ unitAmountMinor: null, priceType: 'unknown' })]);
    expect(output.knownTotalMinor).toBe(1001);
    expect(output.complete).toBe(false);
    expect(output.rankingEligible).toBe(false);
  });
  /** 分摊余数必须分配回真实总额。 */
  it('人数分摊之和严格等于含预备金总额', () => {
    const output = calculate([cost()], { reserveBps: 1000 });
    expect(output.totalWithReserveMinor).toBe(1101);
    expect(output.allocationMinor).toEqual([367, 367, 367]);
    const uneven = calculate([cost({ unitAmountMinor: 1000 })]);
    expect(uneven.allocationMinor).toEqual([334, 333, 333]);
  });
  /** 旅行团包含住宿时不能重复累计同一项酒店成本。 */
  it('包价覆盖与重复口径可追溯地排除', () => {
    const tour = cost({
      category: 'tour',
      unitAmountMinor: 50000,
      includes: ['lodging'],
    });
    const hotel = cost({ category: 'lodging', unitAmountMinor: 20000 });
    const output = calculate([tour, hotel]);
    expect(output.knownTotalMinor).toBe(50000);
    expect(output.lines.find((line) => line.id === hotel.id)?.excludedBy).toBe(tour.id);
    const duplicate = calculate([cost({ scopeKey: 'hotel' }), cost({ scopeKey: 'hotel' })]);
    expect(duplicate.knownTotalMinor).toBe(1001);
    expect(duplicate.rankingEligible).toBe(false);
  });
  /** 失效汇率不能继续使用，日元换人民币要考虑两种最小单位。 */
  it('跨币种转换使用有来源的有效分数汇率', () => {
    const item = cost({ currency: 'JPY', unitAmountMinor: 10000 });
    const rates = [
      {
        from: 'JPY',
        to: 'CNY',
        rate: '0.05',
        source: '测试参考汇率',
        sourceUrl: 'https://example.org/rates',
        checkedAt: '2026-10-27T00:00:00Z',
        validUntil: '2026-10-29T00:00:00Z',
        kind: 'reference',
      },
    ];
    expect(calculate([item], { rates }).knownTotalMinor).toBe(50000);
    expect(calculate([item], { rates: [] }).complete).toBe(false);
  });
  /** 广告和过期供应商价格不能争夺最低价名次。 */
  it('宣传价和过期报价失去排名资格', () => {
    expect(calculate([cost({ priceType: 'advertised' })]).rankingEligible).toBe(false);
    expect(
      calculate([
        cost({
          priceType: 'live_quote',
          provenance: 'supplier',
          validUntil: '2026-10-27T00:00:00Z',
        }),
      ]).rankingEligible,
    ).toBe(false);
  });
  /** 修改条件不会自动变成新的供应商实时报价。 */
  it('人工录入不能提升身份或覆盖原报价', () => {
    expect(() =>
      assertManualQuote(
        cost({
          priceType: 'live_quote',
          provenance: 'supplier',
          validUntil: '2026-10-29T00:00:00Z',
        }),
      ),
    ).toThrow();
    const original = cost();
    expect(() => assertManualQuote({ ...original, unitAmountMinor: 1 }, original)).toThrow();
    expect(() => assertManualQuote({ ...original, selected: false }, original)).not.toThrow();
  });
});
/** 不可行日程必须有明确的可定位错误。 */
describe('行程版本行程验证', () => {
  /** 三个活动制造地理、时间和步行冲突，不依赖模型判断。 */
  it('发现时间冲突、不可达距离、闭园、无障碍和步行限制', () => {
    const entry = {
      id: crypto.randomUUID(),
      kind: 'attraction',
      name: '核实景点',
      point: { lng: 120, lat: 30, coordinateSystem: 'GCJ-02' },
      address: '公共景点',
      opening: [{ dayOfWeek: 4, open: '09:00', close: '17:00' }],
      closedDates: ['2026-10-29'],
      reservation: 'required',
      accessible: false,
      childPolicy: '待确认',
      cancellation: '',
      breakfastIncluded: null,
      evidenceIds: [],
      quote: null,
      notes: '',
    };
    const document = tripDocumentSchema.parse({
      request: { ...request, mobility: 'wheelchair' },
      evidence: [],
      transport: [],
      driving: [],
      experiences: [entry],
      tours: [],
      costs: [],
      rates: [],
    });
    const base = {
      kind: 'visit' as const,
      evidenceIds: [],
      costIds: [],
      travelBeforeMinutes: 0,
      walkMinutes: 80,
      driveMinutes: 0,
      reservationConfirmed: null,
      notes: '',
    };
    const draft: PlanDraft = {
      title: '约束测试',
      mode: 'independent',
      timeZone: 'Asia/Shanghai',
      costIds: [],
      assumptions: [],
      days: [
        {
          date: '2026-10-29',
          items: [
            {
              ...base,
              id: crypto.randomUUID(),
              title: '景点',
              startMinute: 480,
              endMinute: 600,
              point: entry.point as any,
              referenceId: entry.id,
            },
            {
              ...base,
              id: crypto.randomUUID(),
              title: '远处景点',
              startMinute: 590,
              endMinute: 660,
              point: { lng: 121, lat: 31, coordinateSystem: 'GCJ-02' },
              referenceId: null,
            },
          ],
        },
      ],
    };
    const issues = validatePlan(draft, document, calculate([]), now);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'CLOSED_DATE',
        'RESERVATION_REQUIRED',
        'ACCESSIBILITY_CONFLICT',
        'OUTSIDE_OPENING',
        'TIME_CONFLICT',
        'GEOGRAPHIC_IMPOSSIBLE',
        'WALK_LIMIT',
      ]),
    );
    expect(issues.find((issue) => issue.code === 'CLOSED_DATE')?.itemId).toBe(
      draft.days[0]?.items[0]?.id,
    );
  });
});
/** 自动初排必须连接前面模块的真实候选，而不只是生成几段描述。 */
describe('行程版本真实候选初排', () => {
  /** 去程班次、接驳和酒店报价进入同一版本；酒店不会按天数重复收费。 */
  it('绑定真实交通时刻与住宿并保持费用唯一', () => {
    const railId = crypto.randomUUID();
    const hotelId = crypto.randomUUID();
    const rail = cost({ category: 'transport' });
    const room = cost({ category: 'lodging' });
    const doc = tripDocumentSchema.parse({
      request: { ...request, days: 2, nights: 1, endDate: '2026-10-30' },
      evidence: [],
      transport: [
        {
          id: railId,
          mode: 'rail',
          label: 'G123',
          origin: '杭州',
          destination: '苏州',
          departure: '2026-10-29T09:00:00+08:00',
          arrival: '2026-10-29T11:00:00+08:00',
          durationMinutes: 120,
          accessMinutes: 30,
          bufferMinutes: 30,
          egressMinutes: 20,
          transfers: 0,
          availability: 'available',
          seatType: '二等座',
          quote: rail,
          evidenceIds: [],
          checkedAt: now.toISOString(),
          notes: '',
        },
      ],
      driving: [],
      experiences: [
        {
          id: hotelId,
          kind: 'hotel',
          name: '已选酒店',
          point: null,
          address: '公开地址',
          opening: [],
          closedDates: [],
          reservation: 'required',
          accessible: null,
          childPolicy: '',
          cancellation: '',
          breakfastIncluded: null,
          evidenceIds: [],
          quote: room,
          notes: '',
        },
      ],
      tours: [],
      costs: [rail, room],
      rates: [],
    });
    const draft = buildAutoPlan(
      doc,
      generatePlanSchema.parse({
        mode: 'independent',
        transportIds: [railId],
        hotelId,
      }),
    );
    const transit = draft.days[0]!.items.find((item) => item.referenceId === railId)!;
    expect(transit.startMinute).toBe(480);
    expect(transit.endMinute).toBe(680);
    expect(draft.days[0]!.items.some((item) => item.referenceId === hotelId)).toBe(true);
    expect(draft.days[1]!.items.some((item) => item.kind === 'hotel')).toBe(false);
    expect(draft.costIds).toEqual([rail.id, room.id]);
  });
  /** 驾驶拆段后累计必须等于真实路线，不能凭模型改短时间。 */
  it('按真实驾驶时长拆段加入休息', () => {
    const routeId = crypto.randomUUID();
    const energy = cost({ category: 'driving' });
    const point = { lng: 120, lat: 30, coordinateSystem: 'GCJ-02' };
    const doc = tripDocumentSchema.parse({
      request,
      evidence: [],
      transport: [],
      driving: [
        {
          id: routeId,
          origin: point,
          destination: point,
          waypoints: [],
          distanceMeters: 100000,
          driveMinutes: 180,
          restMinutes: 20,
          chargingMinutes: 0,
          totalMinutes: 200,
          energyMinor: 6400,
          knownVehicleMinor: 6400,
          unknownCosts: [],
          perPersonMinor: 3200,
          checkedAt: now.toISOString(),
          assumptions: [],
          warnings: [],
          path: [],
          costs: [energy],
        },
      ],
      experiences: [],
      tours: [],
      costs: [energy],
      rates: [],
    });
    const draft = buildAutoPlan(
      doc,
      generatePlanSchema.parse({ mode: 'driving', drivingId: routeId }),
    );
    expect(
      draft.days.flatMap((day) => day.items).reduce((sum, item) => sum + item.driveMinutes, 0),
    ).toBe(180);
    expect(draft.days[0]!.items.some((item) => item.kind === 'rest')).toBe(true);
    expect(draft.costIds).toContain(energy.id);
  });
  /** 没有真实产品时保留警告，跨项目/不存在的选择必须拒绝。 */
  it('拒绝不存在的候选并提示未绑定团产品', () => {
    const doc = tripDocumentSchema.parse({
      request,
      evidence: [],
      transport: [],
      driving: [],
      experiences: [],
      tours: [],
      costs: [],
      rates: [],
    });
    expect(() =>
      buildAutoPlan(
        doc,
        generatePlanSchema.parse({
          mode: 'independent',
          transportIds: [crypto.randomUUID()],
        }),
      ),
    ).toThrow();
    const draft = buildAutoPlan(doc, generatePlanSchema.parse({ mode: 'group' }));
    expect(
      validatePlan(draft, doc, calculate([]), now).some(
        (issue) => issue.code === 'TOUR_PRODUCT_MISSING',
      ),
    ).toBe(true);
  });
});
