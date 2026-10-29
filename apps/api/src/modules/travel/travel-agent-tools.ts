/** 把完整业务服务装成LangChain工具，不在提示词里假装实现业务。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 使用真实LangChain tool构造器，SDK负责解析tool_calls。 */
import { tool } from 'langchain';
/** 模型参数与HTTP共用严格Zod契约。 */
import { z } from 'zod';
/** 旅行工具的字段边界与网页一致。 */
import {
  tripRequestPatchSchema,
  researchQuerySchema,
  railQuerySchema,
  flightQuerySchema,
  drivingInputSchema,
  placeQuerySchema,
  hotelQuerySchema,
  generatePlanSchema,
  currencySchema,
  type TripWorkspace,
  type ScheduleItem,
} from '@journey/contracts';
/** 工具ID只生成随机值，不接受模型伪造用户身份。 */
import { randomUUID } from 'node:crypto';
/** 类型导入不会形成运行时AgentModule循环依赖。 */
import type { AgentInput } from '../agent/execution.types.js';
/** 业务、归属和安全层分别依赖注入。 */
import { TravelService } from './travel.service.js';
/** 项目只能通过userId+conversationId定位。 */
import { TravelRepository } from './travel.repository.js';
/** 所有工具输出继续执行同一秘密边界。 */
import { McpService } from '../mcp/mcp.service.js';
/** 工具只编排领域服务，数据保存和计算分别交给对应职责。 */
import { ResearchService } from '../travel-research/research.service.js';
/** 交通查询真实交通。 */
import { TransportService } from '../travel-transport/transport.service.js';
/** 自驾规划真实路线与车辆成本。 */
import { DrivingService } from '../travel-driving/driving.service.js';
/** 住宿游玩地点与住宿。 */
import { ExperienceService } from '../travel-experiences/experience.service.js';
/** 旅行团产品条款。 */
import { TourService } from '../travel-tours/tour.service.js';
/** 预算计算整数预算。 */
import { QuoteService } from '../travel-pricing/quote.service.js';
/** 估算金额转换仍使用整数解析。 */
import { decimalMinor, requestConditions } from '../travel-pricing/pricing.service.js';
/** 行程版本生成与验证。 */
import { PlanService } from '../travel-plans/plan.service.js';
/** 分享与运维对昂贵查询做统一限流。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** 每次运行生成绑定账户的工具，研究子代理只获得只读入口。 */
@Injectable()
export class TravelAgentTools {
  /** 构造器只接入已有服务，不保存跨用户运行状态。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly trips: TravelService,
    private readonly research: ResearchService,
    private readonly transport: TransportService,
    private readonly driving: DrivingService,
    private readonly experiences: ExperienceService,
    private readonly tours: TourService,
    private readonly quotes: QuoteService,
    private readonly plans: PlanService,
    private readonly operations: TravelOperations,
    private readonly mcp: McpService,
  ) {}
  /** 客户端和模型都不能指定userId或任意tripId，身份从真实AgentInput闭包取得。 */
  forRun(input: AgentInput, signal: AbortSignal, readOnly = false) {
    /** 延迟定位项目，普通问候不会自动创建旅行项目。 */
    const current = () => this.repository.forConversation(input.userId, input.conversationId);
    /** 未绑定项目必须先通过受校验需求工具创建。 */
    const requireTrip = async () => {
      const trip = await current();
      if (!trip) throw new BadRequestException('请先使用journey_trip_update确认需求并建立旅行项目');
      return trip;
    };
    /** 输出使用统一信封，模型与网页看到完全相同的数据。 */
    const result = (data: unknown) => JSON.stringify(this.mcp.safety.result(data, 'internal'));
    /** 只返回相关的少量候选，避免一次工具结果超出上下文预算。 */
    const summary = (trip: TripWorkspace, section: string) => ({
      tripId: trip.id,
      revision: trip.revision,
      request: trip.document.request,
      clarifications: trip.clarifications,
      section,
      data:
        section === 'plans'
          ? trip.versions.slice(0, 8)
          : section === 'request'
            ? trip.document.request
            : (trip.document[section as 'evidence'] ?? []).slice(-8),
    });
    /** 子代理可读取本会话数据与预算，但不能修改项目和方案。 */
    const read = tool(
      async (args) => {
        const trip = await current();
        return result(
          trip
            ? summary(trip, args.section)
            : {
                exists: false,
                next: '请先澄清需求，通过journey_trip_update建立旅行项目',
              },
        );
      },
      {
        name: 'journey_trip_read',
        description: '旅行需求：读取当前会话旅行需求或某类已保存候选；不接受其他用户/项目标识。',
        schema: z
          .object({
            section: z.enum([
              'request',
              'evidence',
              'transport',
              'driving',
              'experiences',
              'tours',
              'costs',
              'plans',
            ]),
          })
          .strict(),
      },
    );
    /** 预算读取无写入，但缺失人数时明确失败。 */
    const budget = tool(
      async () => {
        const trip = await requireTrip();
        return result(await this.quotes.calculate(input.userId, trip.id));
      },
      {
        name: 'journey_budget',
        description:
          '预算计算：用整数最小货币单位计算当前已选择费用、未知项、预备金与分摊；禁止心算总价。',
        schema: z.object({}).strict(),
      },
    );
    if (readOnly) return [read, budget];
    /** 所有修改保持当前revision；并发修改冲突会让模型重新读取而不是覆盖。 */
    const update = tool(
      async (args) => {
        const trip = await current();
        const saved = trip
          ? await this.trips.update(input.userId, trip.id, {
              revision: trip.revision,
              request: args.patch,
            })
          : await this.trips.create(input.userId, {
              title: args.title ?? '对话中的旅行计划',
              conversationId: input.conversationId,
              request: args.patch,
              text:
                input.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '',
            });
        return result(summary(saved, 'request'));
      },
      {
        name: 'journey_trip_update',
        description:
          '旅行需求：仅保存用户明确确认的需求；缺失字段继续null并追问，不猜日期人数。首次调用自动建立本会话项目。',
        schema: z
          .object({
            title: z.string().max(100).optional(),
            patch: tripRequestPatchSchema,
          })
          .strict(),
      },
    );
    /** 用操作外壳统一检查归属、取消、限流与耗时。 */
    const operation = async (
      module: number,
      name: string,
      work: (
        trip: TripWorkspace,
        signal: AbortSignal,
      ) => Promise<TripWorkspace | { workspace: TripWorkspace }>,
      section: string,
    ) => {
      const trip = await requireTrip();
      const saved = await this.operations.run(
        input.userId,
        trip.id,
        module,
        name,
        signal,
        (combined) => work(trip, combined),
      );
      return result(summary('workspace' in saved ? saved.workspace : saved, section));
    };
    /** 资料工具真实执行Search→Extract并保存可追溯证据。 */
    const research = tool(
      (args) =>
        operation(
          7,
          'research',
          (trip, s) => this.research.search(input.userId, trip.id, trip.revision, args, s),
          'evidence',
        ),
      {
        name: 'journey_research',
        description:
          '资料检索：搜索并抽取公共旅游资料，优先官方来源，保存来源/查询时间/过期状态；页面起价不能当库存。',
        schema: researchQuerySchema,
      },
    );
    /** 查询铁路仍由交通查询核验站点和日期范围。 */
    const rail = tool(
      (args) =>
        operation(
          8,
          'rail',
          (trip, s) => this.transport.rail(input.userId, trip.id, trip.revision, args, s),
          'transport',
        ),
      {
        name: 'journey_rail',
        description: '交通查询：车站编码→铁路直达/中转查询→标准化票种与门到门时长；不购票。',
        schema: railQuerySchema,
      },
    );
    /** 航班必须提供明确机场IATA代码，未授权时返回缺失。 */
    const flights = tool(
      (args) =>
        operation(
          8,
          'flights',
          (trip, s) => this.transport.flights(input.userId, trip.id, trip.revision, args, s),
          'transport',
        ),
      {
        name: 'journey_flights',
        description:
          '交通查询：使用已配置Amadeus查询授权航班报价；test环境明确为测试价，不能冒充生产库存。',
        schema: flightQuerySchema,
      },
    );
    /** 百公里消耗和能源价必须有用户确认来源。 */
    const driving = tool(
      (args) =>
        operation(
          9,
          'driving',
          (trip, s) => this.driving.query(input.userId, trip.id, trip.revision, args, s),
          'driving',
        ),
      {
        name: 'journey_driving',
        description:
          '自驾规划：真实高德路线加整数车辆成本；油电单价、消耗和未知路费必须明确，不编造实时油价。',
        schema: drivingInputSchema,
      },
    );
    /** 地点查询只提供地点，不自动证明营业与价格。 */
    const places = tool(
      (args) =>
        operation(
          10,
          'places',
          (trip, s) => this.experiences.places(input.userId, trip.id, trip.revision, args, s),
          'experiences',
        ),
      {
        name: 'journey_places',
        description:
          '住宿游玩：高德查询酒店/景点/餐馆名称地址坐标；营业、预约和库存保持未知，需补证据。',
        schema: placeQuerySchema,
      },
    );
    /** 指定入住条件由需求读取，不在模型里猜人数和间数。 */
    const hotels = tool(
      (args) =>
        operation(
          10,
          'hotels',
          (trip, s) => this.experiences.hotels(input.userId, trip.id, trip.revision, args, s),
          'experiences',
        ),
      {
        name: 'journey_hotels',
        description:
          '住宿游玩：查询授权酒店全程房价，未确认住客/儿童分房则要求澄清；无Key明确未接入。',
        schema: hotelQuerySchema,
      },
    );
    /** 团产品统一列出购物、自费和单房差。 */
    const tours = tool(
      () =>
        operation(
          11,
          'tours',
          (trip, s) => this.tours.query(input.userId, trip.id, trip.revision, s),
          'tours',
        ),
      {
        name: 'journey_tours',
        description:
          '旅行团：查询管理员配置的已授权团产品网关，保留团期、包含项、单房差、自费购物和退改；无配置不伪造。',
        schema: z.object({}).strict(),
      },
    );
    /** 人工估算是用户提供的假设，始终不能升级成live_quote。 */
    const estimate = tool(
      async (args) => {
        const trip = await requireTrip();
        const request = trip.document.request;
        const item = {
          id: randomUUID(),
          label: args.label,
          category: args.category,
          scopeKey: `manual:${randomUUID()}`,
          priceType: 'estimate' as const,
          unitAmountMinor: decimalMinor(args.amount, args.currency),
          currency: args.currency,
          quantity: args.quantity,
          unit: args.unit,
          required: true,
          selected: true,
          includes: [],
          provenance: 'manual' as const,
          provider: '用户明确提供的估算',
          sourceUrl: null,
          evidenceIds: [],
          checkedAt: new Date().toISOString(),
          validUntil: null,
          conditions: requestConditions(request),
          notes: args.assumption,
        };
        const saved = await this.quotes.add(input.userId, trip.id, trip.revision, item);
        return result(summary(saved, 'costs'));
      },
      {
        name: 'journey_estimate_add',
        description:
          '预算计算：仅录入用户明确给出的费用假设与数量，始终标为人工估算；不能用模型捏造价格填补未知。',
        schema: z
          .object({
            label: z.string().min(1).max(100),
            category: z.enum([
              'transport',
              'lodging',
              'ticket',
              'meal',
              'driving',
              'tour',
              'insurance',
              'other',
            ]),
            amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
            currency: currencySchema,
            quantity: z.number().int().min(1).max(1000),
            unit: z.enum(['person', 'room_night', 'trip', 'vehicle', 'ticket', 'meal']),
            assumption: z.string().min(1).max(800),
          })
          .strict(),
      },
    );
    /** 生成只选择现有候选和现有报价，服务端重新计算预算。 */
    const generate = tool(
      async (args) => {
        const trip = await requireTrip();
        const version = await this.plans.generate(input.userId, trip.id, trip.revision, args);
        return result({
          id: version.id,
          version: version.version,
          status: version.status,
          violations: version.violations,
          budget: version.budget,
          days: version.draft.days,
        });
      },
      {
        name: 'journey_plan_generate',
        description:
          '行程版本：基于已保存地点初排逐日行程，验证时间/距离/营业/预算后另存版本；必须先确认日期人数与当地时区。',
        schema: generatePlanSchema,
      },
    );
    /** 局部编辑只开放时间、候选和备注字段，坐标和报价从候选真实资料派生。 */
    const adjust = tool(
      async (args) => {
        const trip = await requireTrip();
        const base = await this.repository.version(input.userId, trip.id, args.versionId);
        const existing = base.draft.days
          .flatMap((day) => day.items)
          .find((item) => item.id === args.itemId);
        if (!existing) throw new BadRequestException('活动不存在');
        let replacement: ScheduleItem = { ...existing, ...args.changes };
        if (args.changes.referenceId) {
          const candidate = trip.document.experiences.find(
            (item) => item.id === args.changes.referenceId,
          );
          if (!candidate) throw new BadRequestException('替换地点不属于当前项目');
          replacement = {
            ...replacement,
            title: candidate.name,
            point: candidate.point,
            evidenceIds: candidate.evidenceIds,
            referenceId: candidate.id,
            costIds: candidate.quote ? [candidate.quote.id] : [],
          };
        }
        const version = await this.plans.replace(input.userId, trip.id, trip.revision, {
          baseVersionId: base.id,
          itemId: existing.id,
          replacement,
          reason: args.reason,
        });
        return result({
          id: version.id,
          version: version.version,
          status: version.status,
          violations: version.violations,
          budget: version.budget,
        });
      },
      {
        name: 'journey_plan_adjust',
        description:
          '行程版本：替换已保存版本中的一个活动，重新验证并另存版本；保留旧版本，不静默覆盖。',
        schema: z
          .object({
            versionId: z.string().uuid(),
            itemId: z.string().uuid(),
            changes: z
              .object({
                startMinute: z.number().int().min(0).max(1439).optional(),
                endMinute: z.number().int().min(1).max(1440).optional(),
                referenceId: z.string().uuid().optional(),
                notes: z.string().max(1000).optional(),
              })
              .strict(),
            reason: z.string().min(1).max(300),
          })
          .strict(),
      },
    );
    return [
      read,
      update,
      research,
      rail,
      flights,
      driving,
      places,
      hotels,
      tours,
      budget,
      estimate,
      generate,
      adjust,
    ];
  }
}
