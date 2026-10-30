/** 国内安排工作流复用已有领域服务，不由模型自由拼接价格、链接或版本。 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
/** 集合标识由服务端生成。 */
import { randomUUID } from 'node:crypto';
/** 公共输出在落库和返回前执行统一校验。 */
import {
  domesticOptionSetSchema,
  domesticHandoffSchema,
  type DomesticOptionSet,
  type TripWorkspace,
  type PlanDraft,
  type GeoPoint,
} from '@journey/contracts';
/** 账户归属和CAS继续使用现有聚合仓储。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** SQL连接属于应用唯一存储服务。 */
import { StorageService } from '../../storage/storage.module.js';
/** 以下服务分别负责真实铁路、地点、证据与行程保存。 */
import { TransportService } from '../travel-transport/transport.service.js';
import { DrivingService } from '../travel-driving/driving.service.js';
import { parsePoint } from '../travel-experiences/experience.service.js';
import { ExperienceService } from '../travel-experiences/experience.service.js';
import { ResearchService } from '../travel-research/research.service.js';
import { PlanService } from '../travel-plans/plan.service.js';
import { buildAutoPlan } from '../travel-plans/auto-plan.js';
/** MCP固定调用闭包限制可访问能力。 */
import { TravelMcpService, asRecord, asRecords } from '../travel/travel-mcp.service.js';
import { McpService, McpToolError } from '../mcp/mcp.service.js';
/** 日期范围统一采用上海日历。 */
import { shanghaiDate, addDays } from '../trip-request/request.service.js';
/** 阶段说明进入已有公开事件，绝不发布隐藏推理。 */
import type { PublishEvent } from '../agent/execution.types.js';
/** 优化策略、上下文指纹和官方渠道是独立可测试逻辑。 */
import { domesticCandidates, domesticFingerprint } from './choice-candidates.js';
import { DOMESTIC_ENTRIES, DOMESTIC_PARTNERS } from './provider-catalog.js';

/** 只读导航查询在一轮内合并相同点对，不在用户之间共享乘客信息。 */
type RouteReader = (
  from: GeoPoint,
  to: GeoPoint,
) => Promise<{ minutes: number; walking: boolean } | null>;

@Injectable()
export class DomesticPlanningService {
  /** 依赖图保持向旅行领域单向引用，不依赖聊天调度服务。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly storage: StorageService,
    private readonly transport: TransportService,
    private readonly driving: DrivingService,
    private readonly experiences: ExperienceService,
    private readonly research: ResearchService,
    private readonly plans: PlanService,
    private readonly queries: TravelMcpService,
    private readonly mcp: McpService,
  ) {}

  /** 官方能力与当前部署状态分开，商业适配器未开通时不显示为已连通。 */
  providers() {
    const statuses = this.mcp.statuses();
    return DOMESTIC_PARTNERS.map((provider) => {
      const id = provider.id === 'railway' ? 'train' : provider.id;
      const status = statuses.find((entry) => entry.id === id);
      return {
        ...provider,
        state: status
          ? !status.configured
            ? 'unconfigured'
            : status.connected
              ? 'ready'
              : status.state === 'idle'
                ? 'idle'
                : 'unavailable'
          : provider.state,
      };
    });
  }

  /** 最近集合始终同时检查用户和项目，未知ID与越权统一返回404。 */
  async decision(userId: string, tripId: string) {
    const workspace = await this.repository.get(userId, tripId);
    const rows = await this.storage.sql.query(
      'SELECT payload FROM trip_option_sets WHERE user_id=$1 AND trip_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
      [userId, tripId],
    );
    const optionSet = rows.rows[0] ? domesticOptionSetSchema.parse(rows.rows[0].payload) : null;
    const expired = Boolean(
      optionSet &&
      (Date.now() - Date.parse(optionSet.createdAt) > 15 * 60000 ||
        optionSet.options.some((option) =>
          option.version.prices.some(
            (price) => price.validUntil && Date.parse(price.validUntil) <= Date.now(),
          ),
        )),
    );
    return {
      workspace,
      optionSet,
      stale:
        expired ||
        Boolean(
          optionSet && optionSet.contextFingerprint !== domesticFingerprint(workspace.document),
        ),
    };
  }

  /** 关联会话先核实归属，不能靠猜conversationId发现别人的项目。 */
  async forConversation(userId: string, conversationId: string) {
    const owner = await this.storage.sql.query(
      'SELECT id FROM conversations WHERE id=$1 AND user_id=$2',
      [conversationId, userId],
    );
    if (!owner.rowCount) throw new NotFoundException('会话不存在');
    const trip = await this.repository.forConversation(userId, conversationId);
    return trip
      ? this.decision(userId, trip.id)
      : { workspace: null, optionSet: null, stale: false };
  }

  /** 选择必须属于当前有效集合，旧需求的版本不能悄悄变成新需求的选择。 */
  async select(userId: string, tripId: string, revision: number, versionId: string) {
    const current = await this.decision(userId, tripId);
    if (current.stale) throw new ConflictException('需求或候选已更新，请重新生成方案后选择');
    if (!current.optionSet?.options.some((option) => option.version.id === versionId))
      throw new BadRequestException('请选择当前方案集合中的版本');
    if (
      current.optionSet.options.find((option) => option.version.id === versionId)?.version
        .status === 'invalid'
    )
      throw new BadRequestException('请先解决方案冲突，再选择该安排');
    await this.repository.activate(userId, tripId, revision, versionId);
    return this.decision(userId, tripId);
  }

  /** 交接只生成已登记入口，不接受任意URL，不把点击登记成订单成功。 */
  async handoff(userId: string, tripId: string, providerId: string) {
    await this.repository.get(userId, tripId);
    const entry = Object.hasOwn(DOMESTIC_ENTRIES, providerId)
      ? DOMESTIC_ENTRIES[providerId]
      : undefined;
    if (!entry) throw new BadRequestException('该渠道尚未提供可用交接入口');
    await this.storage.sql.query(
      'INSERT INTO audit_events(user_id,action,target_id) VALUES($1,$2,$3)',
      [userId, 'travel.handoff', tripId],
    );
    return domesticHandoffSchema.parse({
      providerId,
      ...entry,
      kind: providerId === 'railway' ? 'official_entry' : 'platform_entry',
      notice:
        '这是官方/平台查询入口，不是指定商品的已验价预订链接；请在平台核对日期、人数、价格与退改，再自行确认订单和付款。',
      bookingConfirmed: false,
    });
  }

  /** 组合已存候选并补查地点接驳，不在这个入口重新搜索库存。 */
  async generate(
    userId: string,
    tripId: string,
    revision: number,
    signal: AbortSignal,
    publish?: PublishEvent,
    warnings: string[] = [],
  ) {
    const workspace = await this.repository.get(userId, tripId);
    if (workspace.revision !== revision) throw new ConflictException('项目已更新，请刷新');
    const req = workspace.document.request;
    if (req.destinationTimeZone !== 'Asia/Shanghai')
      throw new BadRequestException('当前安排仅支持中国内地，目的地时区应为Asia/Shanghai');
    const candidates = domesticCandidates(workspace.document);
    if (!candidates.length)
      throw new BadRequestException(
        '尚无可组合的真实交通、地点、自驾或跟团候选，请先查询或一键安排',
      );
    if (workspace.versions.length + candidates.length > 50)
      throw new BadRequestException('项目版本已达上限，请新建旅行项目');
    const fingerprint = domesticFingerprint(workspace.document);
    const limitations = [
      ...warnings,
      '候选来自当前已查询范围，不代表全平台全量商品；预算策略不是全网最低价承诺。',
      '平台交接由用户确认预订和付款，本产品不代扣费用。',
    ];
    if (candidates.length < 3)
      limitations.push(`当前真实候选只有${candidates.length}套不同组合，未为凑数复制方案。`);
    /** 一轮共享路线缓存，最多查询八个实际点对，避免矩阵膨胀耗尽时间。 */
    const routes = this.routeReader(req.destination ?? '', signal, limitations);
    const options: DomesticOptionSet['options'] = [];
    for (const candidate of candidates) {
      signal.throwIfAborted();
      await publish?.('run.progress', {
        title: `安排${candidate.label}`,
        detail: '复用真实候选，核对接驳、日程与预算；未核实条件保留提示。',
      });
      const draft = buildAutoPlan(workspace.document, candidate.input);
      const restaurants = workspace.document.experiences.filter(
        (place) => place.kind === 'restaurant',
      );
      /** 用餐地点只在确有搜索记录时替换，不能把普通人均当本次实际消费。 */
      if (restaurants.length)
        for (const [dayIndex, day] of draft.days.entries())
          for (const item of day.items)
            if (item.kind === 'meal')
              Object.assign(item, {
                title: restaurants[dayIndex % restaurants.length]!.name,
                point: restaurants[dayIndex % restaurants.length]!.point,
                referenceId: restaurants[dayIndex % restaurants.length]!.id,
                evidenceIds: restaurants[dayIndex % restaurants.length]!.evidenceIds,
                notes: `地点候选；菜单、座位、营业和最终餐费需要核实。${req.dietary.length ? '饮食限制：' + req.dietary.join('、') + '，尚待餐厅确认。' : ''}`,
              });
      await this.routeDraft(draft, routes);
      const fresh = await this.repository.get(userId, tripId);
      if (
        fresh.revision !== revision + options.length ||
        domesticFingerprint(fresh.document) !== fingerprint
      )
        throw new ConflictException('规划期间需求或候选已变化，请重新生成');
      signal.throwIfAborted();
      const version = await this.plans.save(
        userId,
        tripId,
        fresh.revision,
        draft,
        `一键安排 · ${candidate.label}`,
        null,
        false,
      );
      options.push({ ...candidate, version });
    }
    const optionSet = domesticOptionSetSchema.parse({
      id: randomUUID(),
      tripId,
      createdAt: new Date().toISOString(),
      contextFingerprint: fingerprint,
      market: 'CN',
      options,
      limitations: limitations.slice(0, 30),
    });
    /** 发布集合前再次检查修订号；候选版本保存始终不改变用户选中指针。 */
    const client = await this.storage.sql.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query(
        'SELECT document,revision,archived FROM trip_projects WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [tripId, userId],
      );
      if (
        !locked.rows[0] ||
        locked.rows[0].archived ||
        locked.rows[0].revision !== revision + options.length ||
        domesticFingerprint(locked.rows[0].document) !== fingerprint
      )
        throw new ConflictException('项目已更新，请重新生成');
      await client.query(
        'INSERT INTO trip_option_sets(id,user_id,trip_id,payload) VALUES($1,$2,$3,$4)',
        [optionSet.id, userId, tripId, optionSet],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return this.decision(userId, tripId);
  }

  /** 一键采集有明确边界，供应商失效只影响对应部分，不伪造替代商品。 */
  arrange(userId: string, tripId: string, signal: AbortSignal, publish?: PublishEvent) {
    return this.queries.trace(publish, () => this.arrangeWork(userId, tripId, signal, publish));
  }
  /** 工作流内部进度与每个MCP结果均通过当前运行的脱敏事件出口发布。 */
  private async arrangeWork(
    userId: string,
    tripId: string,
    signal: AbortSignal,
    publish?: PublishEvent,
  ) {
    let trip = await this.repository.get(userId, tripId);
    const req = trip.document.request;
    const missing = [
      req.mode === 'driving' && req.vehicles === null ? '车辆数量' : '',
      !req.origin ? '出发地' : '',
      !req.destination ? '目的地' : '',
      !req.startDate ? '日期' : '',
      !req.days ? '天数' : '',
      req.adults === null ? '成人数' : '',
      req.children === null ? '儿童数（没有请明确0）' : '',
    ].filter(Boolean);
    if (missing.length)
      throw new BadRequestException(`请先确认${missing.join('、')}，其余已保存需求会保留`);
    if (req.destinationTimeZone && req.destinationTimeZone !== 'Asia/Shanghai')
      throw new BadRequestException('当前只安排中国内地行程');
    if (!req.destinationTimeZone)
      trip = await this.repository.mutate(userId, tripId, trip.revision, (doc) => {
        doc.request.destinationTimeZone = 'Asia/Shanghai';
        return doc;
      });
    const existing = await this.decision(userId, tripId);
    if (existing.optionSet && !existing.stale) return existing;
    const lookupSignal = AbortSignal.any([signal, AbortSignal.timeout(65000)]);
    const warnings: string[] = [
      '国内机票、酒店房型、餐饮团购、景点门票和旅行团实时库存尚待商业授权；地图地点不代表可订商品。',
    ];
    const step = async (title: string, work: () => Promise<unknown>) => {
      signal.throwIfAborted();
      if (lookupSignal.aborted) {
        if (!warnings.includes('部分资料超出采集时间窗口，先整理已保存候选。'))
          warnings.push('部分资料超出采集时间窗口，先整理已保存候选。');
        return;
      }
      await publish?.('run.progress', {
        title,
        detail: '正在执行真实查询；报价、库存与尚未核实资料分别记录。',
      });
      try {
        await work();
      } catch (error) {
        if (signal.aborted) throw error;
        const message =
          error instanceof McpToolError
            ? error.message
            : error instanceof BadRequestException
              ? error.message
              : '渠道暂不可用，未取得该项结果';
        warnings.push(`${title}：${this.mcp.safety.text(message, 360)}`);
      }
      trip = await this.repository.get(userId, tripId);
    };
    const freshRail = (origin: string, destination: string, date: string) =>
      trip.document.transport.some(
        (item) =>
          item.queryOrigin === origin &&
          item.queryDestination === destination &&
          item.departure?.startsWith(date) &&
          Date.now() - Date.parse(item.checkedAt) < 15 * 60000,
      );
    if (req.mode !== 'driving' && req.mode !== 'group') {
      if (req.startDate! >= shanghaiDate() && req.startDate! <= addDays(shanghaiDate(), 14)) {
        if (!freshRail(req.origin!, req.destination!, req.startDate!))
          await step('查询去程铁路', () =>
            this.transport.rail(
              userId,
              tripId,
              trip.revision,
              {
                origin: req.origin!,
                destination: req.destination!,
                date: req.startDate!,
                accessMinutes: 30,
                egressMinutes: 30,
                bufferMinutes: 30,
                interline: false,
              },
              lookupSignal,
              true,
            ),
          );
        if (
          req.endDate &&
          req.endDate !== req.startDate &&
          req.endDate <= addDays(shanghaiDate(), 14) &&
          !freshRail(req.destination!, req.origin!, req.endDate)
        )
          await step('查询返程铁路', () =>
            this.transport.rail(
              userId,
              tripId,
              trip.revision,
              {
                origin: req.destination!,
                destination: req.origin!,
                date: req.endDate!,
                accessMinutes: 30,
                egressMinutes: 30,
                bufferMinutes: 30,
                interline: false,
              },
              lookupSignal,
              true,
            ),
          );
      } else warnings.push('铁路日期不在当前可查询窗口内，先安排目的地，车票待起售后查询。');
    }
    if (req.mode === 'driving' && !trip.document.driving.length)
      await step('查询城市间自驾路线', async () => {
        const call = await this.queries.session(lookupSignal);
        const locate = async (address: string) => {
          const raw = asRecord(await call('amap__maps_geo', { address, city: address }));
          return parsePoint(asRecords(raw.geocodes ?? asRecord(raw.data).geocodes)[0]?.location);
        };
        const from = await locate(req.origin!),
          to = await locate(req.destination!);
        if (!from || !to) throw new BadRequestException('城市中心定位失败，请明确起终点');
        return this.driving.preview(userId, tripId, trip.revision, from, to, lookupSignal);
      });
    const keywords = req.mustVisit.length ? req.mustVisit.slice(0, 3) : [`${req.destination} 景点`];
    for (const keyword of keywords)
      if (
        !trip.document.experiences.some(
          (place) => place.kind === 'attraction' && place.name.includes(keyword),
        )
      )
        await step(`查询地点：${keyword}`, () =>
          this.experiences.places(
            userId,
            tripId,
            trip.revision,
            { city: req.destination!, keywords: keyword, kind: 'attraction' },
            lookupSignal,
            req.mustVisit.length ? 1 : Math.min(6, (req.days ?? 1) * 2),
          ),
        );
    if (
      req.mustVisit.length &&
      (req.days ?? 1) > 1 &&
      trip.document.experiences.filter((place) => place.kind === 'attraction').length <
        (req.days ?? 1) * 2
    )
      await step('补充可选游玩地点', () =>
        this.experiences.places(
          userId,
          tripId,
          trip.revision,
          { city: req.destination!, keywords: '景点', kind: 'attraction' },
          lookupSignal,
          3,
        ),
      );
    if ((req.nights ?? 0) > 0 && !trip.document.experiences.some((place) => place.kind === 'hotel'))
      await step('查询住宿位置候选', () =>
        this.experiences.places(
          userId,
          tripId,
          trip.revision,
          {
            city: req.destination!,
            keywords: `${req.mustVisit[0] ?? req.destination} 酒店`,
            kind: 'hotel',
          },
          lookupSignal,
          1,
        ),
      );
    if (!trip.document.experiences.some((place) => place.kind === 'restaurant'))
      await step('查询餐饮位置候选', () =>
        this.experiences.places(
          userId,
          tripId,
          trip.revision,
          {
            city: req.destination!,
            keywords: `${req.mustVisit[0] ?? req.destination} 餐厅 ${req.dietary.join(' ')}`.slice(
              0,
              120,
            ),
            kind: 'restaurant',
          },
          lookupSignal,
          2,
        ),
      );
    if (!trip.document.evidence.some((item) => Date.parse(item.expiresAt) > Date.now()))
      await step('查询官方营业与预约资料', () =>
        this.research.search(
          userId,
          tripId,
          trip.revision,
          {
            query: `${req.destination} ${req.mustVisit.slice(0, 3).join(' ')} 官方 开放时间 预约 ${req.startDate}`,
            extract: true,
            refresh: false,
          },
          lookupSignal,
        ),
      );
    return this.generate(userId, tripId, trip.revision, signal, publish, warnings);
  }

  /** 查不到路线时保留未知，不能把旧初排固定间隔当作实际接驳。 */
  private routeReader(city: string, signal: AbortSignal, warnings: string[]): RouteReader {
    const routeSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    const cache = new Map<string, Promise<{ minutes: number; walking: boolean } | null>>();
    return async (from, to) => {
      const key = `${from.lng},${from.lat}:${to.lng},${to.lat}`;
      if (cache.has(key)) return cache.get(key)!;
      if (cache.size >= 8) {
        if (!warnings.includes('部分点间路线超出本轮有界查询范围，接驳时间待核实。'))
          warnings.push('部分点间路线超出本轮有界查询范围，接驳时间待核实。');
        return null;
      }
      const promise = (async () => {
        try {
          const call = await this.queries.session(routeSignal);
          const distance = Math.hypot(from.lng - to.lng, from.lat - to.lat);
          const walking = distance < 0.012;
          const raw = asRecord(
            await call(
              walking ? 'amap__maps_direction_walking' : 'amap__maps_direction_transit_integrated',
              {
                origin: `${from.lng},${from.lat}`,
                destination: `${to.lng},${to.lat}`,
                ...(!walking ? { city, cityd: city } : {}),
              },
            ),
          );
          const route = asRecord(raw.route ?? asRecord(raw.data).route ?? raw);
          const path = asRecords(walking ? route.paths : route.transits)[0];
          const seconds = Number(path?.duration ?? asRecord(path?.cost).duration);
          return Number.isFinite(seconds) && seconds >= 0
            ? { minutes: Math.ceil(seconds / 60), walking }
            : null;
        } catch (error) {
          if (signal.aborted) throw error;
          return null;
        }
      })();
      cache.set(key, promise);
      return promise;
    };
  }

  /** 接驳后续排活动时间，真实营业冲突仍交给独立验证器标记，不自行宣称可执行。 */
  private async routeDraft(draft: PlanDraft, read: RouteReader) {
    draft.assumptions = draft.assumptions.filter((line) => !line.includes('点间30分钟'));
    draft.assumptions.push(
      '游览停留时长是规划估算；路线为查询时的参考，未来路况、场内步行和预约均需核实。',
    );
    for (const day of draft.days) {
      let previous: GeoPoint | null = null;
      let end = 8 * 60;
      for (const item of day.items) {
        const duration = item.endMinute - item.startMinute;
        item.notes = item.notes.replace(
          '游览90分钟、点间30分钟属于估算；',
          '游览停留时长为规划估算；',
        );
        if (item.kind === 'transit') {
          previous = item.point;
          end = item.endMinute;
          continue;
        }
        const route = previous && item.point ? await read(previous, item.point) : null;
        item.travelBeforeMinutes = route?.minutes ?? null;
        item.walkMinutes = route?.walking ? route.minutes : 0;
        const start = Math.max(item.startMinute, end + (route?.minutes ?? 0));
        if (start + duration <= 1440) {
          item.startMinute = start;
          item.endMinute = start + duration;
        } else item.notes = `${item.notes}；实际接驳后可能跨日，请调整。`.slice(0, 1500);
        if (!route) item.notes = `${item.notes}；该段接驳和步行量未核实。`.slice(0, 1500);
        previous = item.point;
        end = item.endMinute;
      }
    }
  }
}
