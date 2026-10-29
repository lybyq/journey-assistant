/** 真实HTTP MCP与供应商协议fixture，不消耗实际服务额度。 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
/** 本机服务使用随机端口，数据库使用随机名称。 */
import { createServer, type Server } from 'node:http';
/** 每个领域实体独立UUID。 */
import { randomUUID } from 'node:crypto';
/** 使用真实PostgreSQL迁移和仓储，不用内存对象冒充保存成功。 */
import { Pool } from 'pg';
/** 并行工具回归使用真实Redis配额，只清理随机测试前缀。 */
import { createClient } from 'redis';
/** 实际Agent工具负责同轮业务写入的排队。 */
import { TravelAgentTools } from '../apps/api/dist/modules/travel/travel-agent-tools.js';
import { TravelOperations } from '../apps/api/dist/modules/travel-delivery/operations.service.js';
import { PricingService } from '../apps/api/dist/modules/travel-pricing/pricing.service.js';
import { QuoteService } from '../apps/api/dist/modules/travel-pricing/quote.service.js';
import { PlanService } from '../apps/api/dist/modules/travel-plans/plan.service.js';
/** 共用生产契约。 */
import { tripWorkspaceSchema, type TripWorkspace } from '@journey/contracts';
/** 编译后的类保留Nest装饰器与原版SDK。 */
import { McpService } from '../apps/api/dist/modules/mcp/mcp.service.js';
/** 测试注入端口仅存在于测试注册表。 */
import type { McpDefinition } from '../apps/api/dist/modules/mcp/mcp.catalog.js';
/** 环境校验不加载本地真实秘密。 */
import { parseEnvironment } from '../apps/api/src/config/environment.js';
/** 配置类型与运行时资源。 */
import type { AppConfig } from '../apps/api/dist/config/config.module.js';
/** 原生迁移器。 */
import { migrateDatabase } from '../apps/api/dist/storage/migrate.js';
/** 仅模拟DI容器，底层SQL仍是实际连接。 */
import type { StorageService } from '../apps/api/dist/storage/storage.module.js';
/** 领域服务直接调用生产实现，网络协议由本机fixture响应。 */
import { TripRequestService } from '../apps/api/dist/modules/trip-request/request.service.js';
/** 项目创建与归属。 */
import { TravelService } from '../apps/api/dist/modules/travel/travel.service.js';
/** 实际仓储。 */
import { TravelRepository } from '../apps/api/dist/modules/travel/travel.repository.js';
/** 业务MCP调用层。 */
import { TravelMcpService } from '../apps/api/dist/modules/travel/travel-mcp.service.js';
/** 资料工作流。 */
import { ResearchService } from '../apps/api/dist/modules/travel-research/research.service.js';
/** 交通工作流。 */
import { TransportService } from '../apps/api/dist/modules/travel-transport/transport.service.js';
/** 自驾工作流。 */
import { DrivingService } from '../apps/api/dist/modules/travel-driving/driving.service.js';
/** 住宿与地点。 */
import { ExperienceService } from '../apps/api/dist/modules/travel-experiences/experience.service.js';
/** 团产品协议。 */
import { TourService } from '../apps/api/dist/modules/travel-tours/tour.service.js';
/** OAuth与HTTP客户端只改传输依赖，不放开生产任意URL。 */
import { SupplierService } from '../apps/api/dist/modules/travel-suppliers/supplier.service.js';
/** 查询日期以当日上海日期生成，避免测试随时间失效。 */
import { shanghaiDate } from '../apps/api/dist/modules/trip-request/request.service.js';
/** 随机数据库只属于本次测试。 */
const name = `journey_supplier_test_${randomUUID().replaceAll('-', '')}`;
const adminUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://journey:journey_local@127.0.0.1:55433/journey';
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const admin = new Pool({ connectionString: adminUrl });
const db = new Pool({ connectionString: url.href });
/** 只记录调用名称和安全条件，不记录认证头。 */
const seen: { name: string; args: any }[] = [];
let server: Server;
let origin = '';
let mcp: McpService;
let repository: TravelRepository;
let research: ResearchService;
let transport: TransportService;
let driving: DrivingService;
let experience: ExperienceService;
let tours: TourService;
let supplier: SupplierService;
let trip: TripWorkspace;
let owner = '';
let tokenRequests = 0;
let slowDisconnected = false;
/** 官方域名由测试传输重写到本机随机端口；产品代码不接受这个端口。 */
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrateDatabase(db);
  owner = (
    await db.query(
      "INSERT INTO users(email,display_name) VALUES('supplier-test@example.invalid','协议验收') RETURNING id",
    )
  ).rows[0].id;
  server = createServer(async (req, res) => {
    if (req.method === 'DELETE') {
      res.writeHead(204).end();
      return;
    }
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = text.startsWith('{') ? JSON.parse(text) : {};
    /** OAuth fixture验证真实客户端凭据流而非预制工具返回值。 */
    if (req.url?.includes('/oauth2/token')) {
      tokenRequests += 1;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          access_token: 'fixture-oauth-token-private',
          expires_in: 1800,
        }),
      );
      return;
    }
    /** Amadeus实际JSON字段保留币种和全体旅客总价。 */
    if (req.url?.includes('/shopping/flight-offers')) {
      seen.push({ name: 'flight', args: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'fixture-flight',
              numberOfBookableSeats: 4,
              itineraries: [
                {
                  duration: 'PT2H15M',
                  segments: [
                    {
                      carrierCode: 'XX',
                      number: '123',
                      departure: { at: '2026-11-01T09:00:00', iataCode: 'HGH' },
                      arrival: { at: '2026-11-01T11:15:00', iataCode: 'SHA' },
                    },
                  ],
                },
              ],
              price: { currency: 'USD', total: '123.45', grandTotal: '130.00' },
            },
          ],
        }),
      );
      return;
    }
    /** 酒店参考数据与报价是两个真实网络请求。 */
    if (req.url?.includes('/hotels/by-city')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [{ hotelId: 'FIXTUREHOTEL', name: '协议酒店' }],
        }),
      );
      return;
    }
    if (req.url?.includes('/shopping/hotel-offers')) {
      seen.push({ name: 'hotel', args: req.url });
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [
            {
              available: true,
              hotel: { hotelId: 'FIXTUREHOTEL', name: '协议酒店' },
              offers: [
                {
                  id: 'fixture-offer',
                  boardType: 'BREAKFAST',
                  price: { currency: 'USD', total: '200.00' },
                  policies: {
                    cancellations: [{ description: { text: '入住前24小时可取消' } }],
                  },
                },
              ],
            },
          ],
        }),
      );
      return;
    }
    /** 授权团网关使用独立HTTP合约，验证结构化条件且不接收账户和聊天历史。 */
    if (req.url === '/v1/tours/search') {
      seen.push({ name: 'tour_gateway', args: body });
      const conditions = {
        startDate: body.startDate,
        endDate: body.endDate,
        adults: body.adults,
        children: body.children,
        rooms: body.rooms,
        nights: 2,
        hotelStandard: body.hotelStandard,
        mandatoryFeesIncluded: true,
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          products: [
            {
              id: randomUUID(),
              name: '授权团协议产品',
              departureDate: body.startDate,
              departureCity: body.origin,
              days: 3,
              hotelStandard: body.hotelStandard,
              included: ['交通', '住宿'],
              excluded: [],
              shoppingStops: [],
              optionalActivities: [],
              singleSupplementMinor: 0,
              guide: '中文导游',
              pickup: '指定地点',
              cancellation: '出发前7天可取消',
              sourceUrl: 'https://example.org/tour',
              evidenceIds: [],
              needsConfirmation: [],
              dailySchedule: [
                {
                  day: 1,
                  title: '供应商明确提供的游览',
                  startMinute: 540,
                  endMinute: 660,
                  point: null,
                  notes: '实际供应商日程',
                },
              ],
              quote: {
                id: randomUUID(),
                label: '指定团期全体报价',
                category: 'tour',
                scopeKey: 'fixture-tour',
                priceType: 'live_quote',
                unitAmountMinor: 100000,
                currency: 'CNY',
                quantity: 1,
                unit: 'trip',
                required: true,
                selected: false,
                includes: ['transport', 'lodging'],
                provenance: 'supplier',
                provider: 'fixture',
                sourceUrl: 'https://example.org/tour',
                evidenceIds: [],
                checkedAt: new Date().toISOString(),
                validUntil: new Date(Date.now() + 60000).toISOString(),
                conditions,
                notes: '协议验收',
              },
            },
          ],
        }),
      );
      return;
    }
    /** MCP通知不需要JSON-RPC响应。 */
    if (body.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    let result: any;
    /** MCP真实协商与工具发现。 */
    if (body.method === 'initialize')
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'travel-domain-fixture', version: '1.0' },
      };
    else if (body.method === 'tools/list') {
      const names = [
        'tavily_search',
        'tavily_extract',
        'maps_text_search',
        'maps_direction_driving',
        'get-station-code-of-citys',
        'get-station-code-by-names',
        'get-tickets',
        'get-interline-tickets',
      ];
      result = {
        tools: names.map((name) => ({
          name,
          description: 'fixture',
          inputSchema: {
            $schema: 'http://json-schema.org/draft-07/schema',
            type: 'object',
            additionalProperties: true,
          },
        })),
      };
    } else if (body.method === 'tools/call') {
      const n = body.params.name;
      const args = body.params.arguments;
      seen.push({ name: n, args });
      let value: any;
      if (n === 'tavily_search')
        value = {
          results: [
            {
              url: 'https://example.org/travel?tracking=1',
              title: '协议资料',
              content: '营业09:00至17:00，门票价格需确认。',
            },
          ],
        };
      else if (n === 'tavily_extract')
        value = {
          results: [
            {
              url: args.urls[0],
              raw_content: '完整可核查摘录：营业09:00至17:00。',
            },
          ],
        };
      else if (n === 'maps_text_search')
        value = {
          pois: [
            {
              name: '协议景点',
              address: '公共景点地址',
              location: '120.6,31.3',
            },
          ],
        };
      else if (n === 'maps_direction_driving') {
        if (args.origin === '100,20') {
          const timer = setTimeout(() => res.end(), 5000);
          res.once('close', () => {
            clearTimeout(timer);
            slowDisconnected = true;
          });
          return;
        }
        value = {
          route: {
            paths: [
              {
                distance: '100000',
                duration: '10800',
                steps: [{ polyline: '120.1,30.2;120.3,30.4;120.6,31.3' }],
              },
            ],
          },
        };
      } else if (n === 'get-station-code-of-citys') value = { 杭州: 'HZH', 苏州: 'SZH' };
      else if (n === 'get-station-code-by-names')
        value = {
          杭州东: { station_code: 'HGH' },
          苏州: { station_code: 'SZH' },
        };
      else
        value = [
          {
            start_train_code: 'G123',
            start_date: shanghaiDate(),
            arrive_date: shanghaiDate(),
            start_time: '09:00',
            arrive_time: '11:00',
            lishi: '02:00',
            from_station: '杭州',
            from_station_telecode: 'HZH',
            to_station_telecode: 'SZH',
            to_station: '苏州',
            prices: [{ seat_name: '二等座', price: 100.5, num: '有' }],
          },
        ];
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } else result = {};
    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('监听失败');
  origin = `http://127.0.0.1:${address.port}`;
  /** 测试密钥为固定哨兵，绝不加载真实.env。 */
  const config = {
    env: parseEnvironment({
      NODE_ENV: 'test',
      MCP_SERVERS: 'train,amap,tavily',
      AMADEUS_CLIENT_ID: 'fixture-client-id',
      AMADEUS_CLIENT_SECRET: 'fixture-client-secret',
      AMADEUS_ENV: 'test',
      MCP_TOOL_TIMEOUT_MS: 1000,
      TOUR_GATEWAY_URL: '',
      TOUR_GATEWAY_KEY: '',
    }),
  } as AppConfig;
  const definitions: McpDefinition[] = (['train', 'amap', 'tavily'] as const).map((id) => ({
    id,
    label: id,
    configured: true,
    enabled: true,
    connection: {
      transport: 'http',
      mode: 'legacy',
      url: `${origin}/mcp/${id}`,
    },
  }));
  mcp = new McpService(config, definitions);
  const storage = { sql: db } as StorageService;
  const requests = new TripRequestService();
  repository = new TravelRepository(storage, mcp, requests);
  const trips = new TravelService(repository, requests);
  trip = await trips.create(owner, {
    title: '供应商协议验收',
    conversationId: null,
    text: '',
    request: {
      origin: '杭州',
      destination: '苏州',
      startDate: shanghaiDate(),
      days: 3,
      nights: 2,
      adults: 2,
      children: 0,
      rooms: 1,
      vehicles: 2,
      destinationTimeZone: 'Asia/Shanghai',
      hotelStandard: '舒适型',
    },
  });
  const call = new TravelMcpService(mcp);
  const fetcher: typeof fetch = (input, init) => {
    const parsed = new URL(String(input));
    return fetch(`${origin}${parsed.pathname}${parsed.search}`, init);
  };
  supplier = new SupplierService(config, fetcher);
  research = new ResearchService(repository, call);
  transport = new TransportService(repository, call, supplier);
  driving = new DrivingService(repository, call);
  experience = new ExperienceService(repository, call, supplier);
  tours = new TourService(repository, supplier);
}, 30000);
/** 先回收网络与SDK，再删除本轮独立数据库。 */
afterAll(async () => {
  await mcp?.onModuleDestroy();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
  if (!/^journey_supplier_test_[a-f0-9]{32}$/.test(name)) throw new Error('数据库边界不合法');
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
}, 20000);
/** 全部是实际生产服务经真实协议的集成调用。 */
describe('旅行服务供应商协议链路', () => {
  /** 两个工具仍由真实MCP查询并落SQL，不能因读取同一个revision导致一个保存失败。 */
  it('同轮并行地点工具依次保存且不丢候选', async () => {
    const cache = createClient({
      url: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379',
      socket: { reconnectStrategy: false },
    });
    cache.on('error', () => undefined);
    const prefix = `parallel_tool_test_${randomUUID().replaceAll('-', '')}`;
    await cache.connect();
    try {
      const config = {
        env: parseEnvironment({ NODE_ENV: 'test', REDIS_PREFIX: prefix }),
      } as AppConfig;
      const storage = { sql: db, redis: cache } as StorageService;
      const conversationId = (
        await db.query('INSERT INTO conversations(user_id,title) VALUES($1,$2) RETURNING id', [
          owner,
          '并行工具回归',
        ])
      ).rows[0].id;
      const trips = new TravelService(repository, new TripRequestService());
      const isolated = await trips.create(owner, {
        title: '并行保存验收',
        conversationId,
        text: '',
        request: { origin: '杭州', destination: '苏州' },
      });
      const pricing = new PricingService();
      const tools = new TravelAgentTools(
        repository,
        trips,
        research,
        transport,
        driving,
        experience,
        tours,
        new QuoteService(repository, pricing),
        new PlanService(repository, pricing),
        new TravelOperations(storage, config, repository),
        mcp,
      ).forRun(
        {
          runId: randomUUID(),
          userId: owner,
          conversationId,
          messages: [],
          profile: { homeCity: '', preferredMode: 'independent', pace: 'balanced' },
        },
        new AbortController().signal,
      );
      const places = tools.find((tool) => tool.name === 'journey_places')!;
      const results = await Promise.all([
        places.invoke({ city: '苏州', keywords: '景点', kind: 'attraction' }),
        places.invoke({ city: '苏州', keywords: '餐厅', kind: 'restaurant' }),
      ]);
      expect(results).toHaveLength(2);
      const saved = await repository.get(owner, isolated.id);
      expect(saved.revision).toBe(isolated.revision + 2);
      expect(saved.document.experiences.map((item) => item.kind).sort()).toEqual([
        'attraction',
        'restaurant',
      ]);
      /** 超出容量必须是清晰的业务拒绝，事务不能留下部分候选或新revision。 */
      await expect(
        repository.mutate(owner, isolated.id, saved.revision, (document) => {
          document.experiences = Array.from({ length: 61 }, () => ({
            ...saved.document.experiences[0]!,
            id: randomUUID(),
          }));
          return document;
        }),
      ).rejects.toThrow('住宿游玩候选最多60项');
      expect((await repository.get(owner, isolated.id)).revision).toBe(saved.revision);
      const operations = await db.query('SELECT status FROM trip_operations WHERE trip_id=$1', [
        isolated.id,
      ]);
      expect(operations.rows.map((row) => row.status)).toEqual(['completed', 'completed']);
    } finally {
      const keys = await cache.keys(`${prefix}:*`);
      if (keys.length) await cache.del(keys);
      cache.destroy();
    }
  });
  /** Search和Extract必须共享运行级来源许可；缓存命中不再次调用供应商。 */
  it('搜索抽取真实执行且时效缓存减少重复请求', async () => {
    const result = await research.search(
      owner,
      trip.id,
      trip.revision,
      { query: '苏州官方资料', extract: true, refresh: false },
      new AbortController().signal,
    );
    trip = result.workspace;
    expect(trip.document.evidence[0]?.extraction).toBe('success');
    expect(trip.document.evidence[0]?.url).toBe('https://example.org/travel');
    const before = seen.length;
    const cached = await research.search(
      owner,
      trip.id,
      trip.revision,
      { query: '苏州官方资料', extract: true, refresh: false },
      new AbortController().signal,
    );
    expect(cached.cached).toBe(true);
    expect(seen.length).toBe(before);
  });
  /** 铁路查询先站码再余票，接驳和成人参考价不能丢失。 */
  it('站点编码、铁路余票与接驳标准化', async () => {
    trip = await transport.rail(
      owner,
      trip.id,
      trip.revision,
      {
        origin: '杭州',
        destination: '苏州',
        date: shanghaiDate(),
        accessMinutes: 30,
        bufferMinutes: 40,
        egressMinutes: 20,
        interline: false,
      },
      new AbortController().signal,
    );
    const option = trip.document.transport[0]!;
    expect(option).toMatchObject({
      durationMinutes: 120,
      availability: 'available',
      accessMinutes: 30,
      bufferMinutes: 40,
      egressMinutes: 20,
    });
    expect(option.quote).toMatchObject({
      unitAmountMinor: 10050,
      quantity: 2,
      priceType: 'estimate',
    });
    expect(seen.find((item) => item.name === 'get-tickets')?.args).toMatchObject({
      fromStation: 'HZH',
      toStation: 'SZH',
      format: 'json',
    });
  });
  /** 连续查询相同车次刷新原候选，不能每次增加一份相同报价撑满容量。 */
  it('相同铁路查询幂等更新，紧凑输出仍保留真实票价', async () => {
    const before = trip.document.transport.length;
    const original = trip.document.transport[0]!;
    trip = await transport.rail(
      owner,
      trip.id,
      trip.revision,
      {
        origin: '杭州',
        destination: '苏州',
        date: shanghaiDate(),
        accessMinutes: 30,
        bufferMinutes: 40,
        egressMinutes: 20,
        interline: false,
      },
      new AbortController().signal,
    );
    expect(trip.document.transport.length).toBe(before);
    expect(trip.document.transport[0]?.id).toBe(original.id);
    expect(trip.document.transport[0]?.quote?.id).toBe(original.quote?.id);
    const { travelToolSummary } = await import('../apps/api/dist/modules/travel/tool-summary.js');
    const envelope = mcp.safety.result(travelToolSummary(trip, 'transport'), 'internal');
    expect(envelope.truncated).toBe(false);
    expect((envelope.data as any).data[0].quote.unitAmountMinor).toBe(10050);
  });
  /** 同城替代站不能冒充用户指定车站，拒绝后不写入任何不匹配报价。 */
  it('指定车站不接受同城替代站的候选', async () => {
    const before = trip.revision;
    await expect(
      transport.rail(
        owner,
        trip.id,
        trip.revision,
        {
          origin: '杭州东站',
          destination: '苏州',
          date: shanghaiDate(),
          accessMinutes: 30,
          bufferMinutes: 30,
          egressMinutes: 30,
          interline: false,
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('与指定车站不匹配');
    expect((await repository.get(owner, trip.id)).revision).toBe(before);
  });
  /** 同一OAuth令牌缓存，回包币种以供应商实际字段为准。 */
  it('航班OAuth真实请求与实际币种保留', async () => {
    trip = await transport.flights(
      owner,
      trip.id,
      trip.revision,
      { originCode: 'HGH', destinationCode: 'SHA', returnDate: null },
      new AbortController().signal,
    );
    const option = trip.document.transport.at(-1)!;
    expect(option.quote).toMatchObject({
      currency: 'USD',
      unitAmountMinor: 13000,
      quantity: 1,
      priceType: 'estimate',
      provider: 'Amadeus TEST 非生产报价',
    });
    expect(option.durationMinutes).toBe(135);
    expect(tokenRequests).toBe(1);
  });
  /** 查地点并不证明开放或价格；酒店全程价不再乘晚数。 */
  it('地图地点保持未知条款，酒店查询不重复乘房晚', async () => {
    trip = await experience.places(
      owner,
      trip.id,
      trip.revision,
      { city: '苏州', keywords: '景点', kind: 'attraction' },
      new AbortController().signal,
    );
    expect(trip.document.experiences[0]).toMatchObject({
      reservation: 'unknown',
      quote: null,
      point: { lng: 120.6, lat: 31.3 },
    });
    trip = await experience.hotels(
      owner,
      trip.id,
      trip.revision,
      { cityCode: 'SHA' },
      new AbortController().signal,
    );
    const hotel = trip.document.experiences.at(-1)!;
    expect(hotel.quote).toMatchObject({
      currency: 'USD',
      unitAmountMinor: 20000,
      quantity: 1,
      unit: 'trip',
      priceType: 'estimate',
    });
    expect(seen.find((item) => item.name === 'hotel')?.args).toContain('roomQuantity=1');
    expect(tokenRequests).toBe(1);
  });
  /** 车辆费乘车辆数，人均在任何强制费用未知时保持null。 */
  it('真实路线、休息和两辆车费用分开计算', async () => {
    trip = await driving.query(
      owner,
      trip.id,
      trip.revision,
      {
        origin: { lng: 120.1, lat: 30.2, coordinateSystem: 'GCJ-02' },
        destination: { lng: 120.6, lat: 31.3, coordinateSystem: 'GCJ-02' },
        waypoints: [],
        energy: 'fuel',
        consumptionPer100: '8',
        energyUnitPriceMinor: 800,
        energyPriceSource: '用户加油小票',
        tollMinor: null,
        parkingMinor: 1000,
        rentalMinor: 0,
        insuranceMinor: 0,
        chargingMinutes: 0,
        restEveryMinutes: 120,
        restMinutes: 20,
        currency: 'CNY',
      },
      new AbortController().signal,
    );
    const route = trip.document.driving[0]!;
    expect(route).toMatchObject({
      distanceMeters: 100000,
      driveMinutes: 180,
      restMinutes: 20,
      totalMinutes: 200,
      energyMinor: 12800,
      knownVehicleMinor: 14800,
      perPersonMinor: null,
      unknownCosts: ['过路费'],
    });
    expect(route.path).toHaveLength(3);
  });
  /** 真正取消底层工具连接，不能把UI停止当取消。 */
  it('超时中断实际供应商连接且不保存半条路线', async () => {
    const before = trip.document.driving.length;
    await expect(
      driving.query(
        owner,
        trip.id,
        trip.revision,
        {
          origin: { lng: 100, lat: 20, coordinateSystem: 'GCJ-02' },
          destination: { lng: 120, lat: 30, coordinateSystem: 'GCJ-02' },
          waypoints: [],
          energy: 'fuel',
          consumptionPer100: '8',
          energyUnitPriceMinor: 800,
          energyPriceSource: '用户明确估算',
          tollMinor: 0,
          parkingMinor: 0,
          rentalMinor: 0,
          insuranceMinor: 0,
          chargingMinutes: 0,
          restEveryMinutes: 120,
          restMinutes: 20,
          currency: 'CNY',
        },
        new AbortController().signal,
      ),
    ).rejects.toBeTruthy();
    for (let i = 0; i < 50 && !slowDisconnected; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slowDisconnected).toBe(true);
    trip = await repository.get(owner, trip.id);
    expect(trip.document.driving.length).toBe(before);
  });
  /** 未配置网关始终拒绝，不生成假旅行团。 */
  it('未配置旅行团授权网关明确失败', async () => {
    await expect(
      tours.query(owner, trip.id, trip.revision, new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
    expect(trip.document.tours).toHaveLength(0);
  });
  /** 实际HTTP传输仍在本机fixture；产品代码保持HTTPS可信网关和固定路径。 */
  it('授权旅行团网关保存真实合约并限制发送字段', async () => {
    const config = {
      env: parseEnvironment({
        NODE_ENV: 'test',
        TOUR_GATEWAY_URL: 'https://tours.example.org',
        TOUR_GATEWAY_KEY: 'fixture-tour-private',
      }),
    } as AppConfig;
    const fetcher: typeof fetch = (input, init) =>
      fetch(origin + new URL(String(input)).pathname, init);
    const authorized = new TourService(repository, new SupplierService(config, fetcher));
    trip = await authorized.query(owner, trip.id, trip.revision, new AbortController().signal);
    const product = trip.document.tours[0]!;
    expect(product.quote.provenance).toBe('supplier');
    expect(product.quote.selected).toBe(false);
    expect(product.dailySchedule[0]?.title).toBe('供应商明确提供的游览');
    const sent = seen.find((item) => item.name === 'tour_gateway')!.args;
    expect(Object.keys(sent).sort()).toEqual(
      [
        'origin',
        'destination',
        'startDate',
        'endDate',
        'adults',
        'children',
        'childAges',
        'rooms',
        'hotelStandard',
        'currency',
      ].sort(),
    );
    expect(JSON.stringify(sent)).not.toContain(owner);
  });
});
