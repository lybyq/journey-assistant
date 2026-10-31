/** 自驾策略、收费单位和比较预算的真实边界回归。 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  tripWorkspaceSchema,
  tripDocumentSchema,
  tripRequestSchema,
  generatePlanSchema,
} from '@journey/contracts';
import { AmapDrivingClient } from '../apps/api/dist/modules/travel-driving/amap-driving.client.js';
import {
  routeTollMinor,
  drivingCandidates,
} from '../apps/api/dist/modules/travel-driving/driving-candidates.js';
import { DrivingService } from '../apps/api/dist/modules/travel-driving/driving.service.js';
import { domesticCandidates } from '../apps/api/dist/modules/domestic-planning/choice-candidates.js';
import { buildAutoPlan } from '../apps/api/dist/modules/travel-plans/auto-plan.js';
import { parseEnvironment } from '../apps/api/dist/config/environment.js';
import type { AppConfig } from '../apps/api/dist/config/config.module.js';
import type { TravelRepository } from '../apps/api/dist/modules/travel/travel.repository.js';
import type { TravelMcpService } from '../apps/api/dist/modules/travel/travel-mcp.service.js';
const from = { lng: 120.15507, lat: 30.274084, coordinateSystem: 'GCJ-02' as const },
  to = { lng: 121.473701, lat: 31.230416, coordinateSystem: 'GCJ-02' as const };
/** 三个策略返回真正不同路线，测试不连接真实高德。 */
const paths: Record<string, any> = {
  '32': {
    distance: '100000',
    cost: { duration: '9000', tolls: '50', toll_distance: '85000' },
    steps: [{ polyline: '120.1,30.2;120.6,31.3' }],
  },
  '36': {
    distance: '120000',
    cost: { duration: '14400', tolls: '0', toll_distance: '0' },
    steps: [{ polyline: '120.1,30.2;120.5,31.4' }],
  },
  '38': {
    distance: '110000',
    cost: { duration: '7200', tolls: '70.5', toll_distance: '90000' },
    steps: [{ polyline: '120.1,30.2;120.7,31.2' }],
  },
};
function setup(failCode?: string) {
  const seen: URL[] = [];
  const config = {
    env: parseEnvironment({ AMAP_MAPS_API_KEY: 'fixture-secret-route-key' }),
  } as unknown as AppConfig;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url);
    const code = url.searchParams.get('strategy')!;
    return new Response(
      JSON.stringify(
        code === failCode
          ? { status: '0', info: 'fixture denied' }
          : { status: '1', route: { paths: [paths[code]] } },
      ),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  return { client: new AmapDrivingClient(config, fetcher), seen };
}
describe('收费与多策略路线数据', () => {
  it('区分明确0元、旧MCP格式、Web2.0费用、空值及错误金额', () => {
    expect(routeTollMinor({ cost: { tolls: '0' } })).toBe(0);
    expect(routeTollMinor({ tolls: '71.25' })).toBe(7125);
    for (const value of [undefined, null, '', [], {}, '-1', 'abc', '1.234'])
      expect(routeTollMinor({ cost: { tolls: value } })).toBeNull();
  });
  it('使用固定官方地址与三种策略，保留收费和真实来源，不公开Key', async () => {
    const { client, seen } = setup();
    const result = await client.compare(from, to, new AbortController().signal);
    expect(seen.map((url) => url.searchParams.get('strategy'))).toEqual(['32', '36', '38']);
    expect(
      seen.every(
        (url) =>
          url.origin === 'https://restapi.amap.com' &&
          url.searchParams.get('show_fields') === 'cost,polyline',
      ),
    ).toBe(true);
    expect(result.source).toBe('amap_web');
    expect(drivingCandidates(result.paths).map((route) => route.toll)).toEqual([5000, 0, 7050]);
    expect(JSON.stringify(result)).not.toContain('fixture-secret-route-key');
  });
  it('部分策略被拒绝仍保留其他结果，不虚构该策略成功', async () => {
    const { client } = setup('36');
    const result = await client.compare(from, to, new AbortController().signal);
    expect(result.warnings.some((warning) => warning.includes('少收费'))).toBe(true);
    expect(drivingCandidates(result.paths).map((route) => route.strategy)).toEqual([
      'recommended',
      'fastest',
    ]);
  });
  it('不同策略返回同一路线时去重，缺少有效耗时不制造路线', () => {
    expect(
      drivingCandidates([
        { ...paths['32'], planningStrategy: 'recommended' },
        {
          ...paths['32'],
          cost: { ...paths['32'].cost, duration: '9050' },
          planningStrategy: 'fastest',
        },
      ]),
    ).toHaveLength(1);
    expect(drivingCandidates([{ distance: '1000', cost: {} }])).toHaveLength(0);
  });
  it('请求取消传递至实际HTTP信号，不继续查下个策略', async () => {
    const controller = new AbortController();
    controller.abort();
    const { client, seen } = setup();
    await expect(client.compare(from, to, controller.signal)).rejects.toBeTruthy();
    expect(seen).toHaveLength(0);
  });
});

describe('路线费用保存与方案选择', () => {
  async function saved() {
    const now = new Date().toISOString(),
      tripId = randomUUID();
    let workspace = tripWorkspaceSchema.parse({
      id: tripId,
      title: '费用协议',
      conversationId: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archived: false,
      activeVersionId: null,
      versions: [],
      clarifications: [],
      document: tripDocumentSchema.parse({
        request: tripRequestSchema.parse({
          mode: 'driving',
          origin: '杭州',
          destination: '上海',
          startDate: '2026-11-01',
          endDate: '2026-11-03',
          days: 3,
          nights: 2,
          adults: 2,
          children: 0,
          vehicles: 2,
          destinationTimeZone: 'Asia/Shanghai',
        }),
        evidence: [],
        transport: [],
        driving: [],
        experiences: [],
        tours: [],
        costs: [],
        rates: [],
      }),
    });
    const repository = {
      get: async () => workspace,
      mutate: async (
        _user: string,
        _id: string,
        _revision: number,
        mutate: (doc: typeof workspace.document) => typeof workspace.document,
      ) => {
        workspace = tripWorkspaceSchema.parse({
          ...workspace,
          revision: workspace.revision + 1,
          document: mutate(structuredClone(workspace.document)),
        });
        return workspace;
      },
    } as unknown as TravelRepository;
    const mcp = {
      session: async () => {
        throw Error('不应走MCP后备');
      },
    } as unknown as TravelMcpService;
    const { client } = setup();
    const service = new DrivingService(repository, mcp, client);
    return {
      service,
      tripId,
      get: () => workspace,
      workspace: await service.preview(
        randomUUID(),
        tripId,
        1,
        from,
        to,
        new AbortController().signal,
      ),
    };
  }
  it('保存三条实际路线，按两辆车计算路费，缺能源单价不补零', async () => {
    const { workspace } = await saved();
    expect(workspace.document.driving).toHaveLength(3);
    expect(workspace.document.driving.map((route) => route.knownVehicleMinor)).toEqual([
      10000, 0, 14100,
    ]);
    expect(
      workspace.document.driving.every(
        (route) => route.energyMinor === null && route.unknownCosts.includes('能源费'),
      ),
    ).toBe(true);
    expect(workspace.document.driving.every((route) => route.tripScope === 'one_way')).toBe(true);
    expect(new Set(workspace.document.driving.map((route) => route.comparisonGroupId)).size).toBe(
      1,
    );
  });
  it('三套自动方案选不同路线，预算只引用被选路线，不能累计所有备选费用', async () => {
    const { workspace } = await saved(),
      doc = workspace.document;
    const options = domesticCandidates(doc);
    expect(options).toHaveLength(3);
    expect(
      options.map(
        (option) => doc.driving.find((route) => route.id === option.input.drivingId)?.strategy,
      ),
    ).toEqual(['less_tolls', 'recommended', 'fastest']);
    for (const option of options) {
      const route = doc.driving.find((route) => route.id === option.input.drivingId)!;
      const draft = buildAutoPlan(doc, generatePlanSchema.parse(option.input));
      expect([...draft.costIds].sort()).toEqual(route.costs.map((cost) => cost.id).sort());
    }
  });
  it('用户能源参数进入每个真实路线的费用计算，并明确人工过路费假设', async () => {
    const { service, tripId, get } = await saved();
    const workspace = await service.query(
      randomUUID(),
      tripId,
      get().revision,
      {
        origin: from,
        destination: to,
        waypoints: [],
        energy: 'fuel',
        consumptionPer100: '8',
        energyUnitPriceMinor: 800,
        energyPriceSource: '用户明确单价',
        tollMinor: 12,
        parkingMinor: 0,
        rentalMinor: 0,
        insuranceMinor: 0,
        chargingMinutes: 0,
        restEveryMinutes: 120,
        restMinutes: 20,
        currency: 'CNY',
      },
      new AbortController().signal,
    );
    const routes = workspace.document.driving.slice(-3);
    expect(routes.map((route) => route.energyMinor)).toEqual([12800, 15360, 14080]);
    expect(
      routes.every((route) => route.tollSource === 'user_assumption' && route.tollMinor === 12),
    ).toBe(true);
  });
});
