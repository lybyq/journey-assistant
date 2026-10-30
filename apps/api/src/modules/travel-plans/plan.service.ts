/** 初排与验证分开，防止生成器自己宣布成功。 */
import { buildAutoPlan } from './auto-plan.js';
/** 生成、验证、局部替换、比较和不可变版本控制。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 版本与活动ID都由服务端生成。 */
import { createHash, randomUUID } from 'node:crypto';
/** 草案与保存结果是不同契约，用户不能提交验证状态。 */
import {
  planDraftSchema,
  generatePlanSchema,
  replaceScheduleSchema,
  type PlanDraft,
  type PlanVersion,
  type TripWorkspace,
  type ScheduleItem,
} from '@journey/contracts';
/** 所有版本与资料都经项目归属检查。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 真正预算只由预算计算生成。 */
import { PricingService, requestConditions } from '../travel-pricing/pricing.service.js';
/** 时间与地理可行性独立验证。 */
import { validatePlan, distanceLowerBound } from './plan-validator.js';
/** 日历日期逐天递增，不依赖宿主时区。 */
import { addDays } from '../trip-request/request.service.js';
/** 保存一份可核验草案，而不是伪造完美方案。 */
@Injectable()
export class PlanService {
  /** 仓储、金额计算和验证分别保持单一职责。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly pricing: PricingService,
  ) {}
  /** 每次保存先核验费用引用，再独立计算并决定是否通过。 */
  async save(
    userId: string,
    id: string,
    revision: number,
    input: PlanDraft,
    reason = '保存行程草案',
    parentId: string | null = null,
    /** 多方案工作流在用户选择前保留原版本指针。 */
    activate = true,
  ): Promise<PlanVersion> {
    const workspace = await this.repository.get(userId, id);
    const draft = planDraftSchema.parse(input);
    if (workspace.revision !== revision) throw new BadRequestException('旅行资料已变化，请刷新');
    if (parentId) await this.repository.version(userId, id, parentId);
    const doc = workspace.document;
    const requested = new Set(draft.costIds);
    if (doc.costs.filter((item) => requested.has(item.id)).length !== requested.size)
      throw new BadRequestException('方案引用了当前项目不存在的费用');
    const items = doc.costs.map((item) => ({
      ...item,
      selected: requested.has(item.id),
    }));
    const request = doc.request;
    if (request.adults === null || request.children === null)
      throw new BadRequestException('请先确认成人和儿童人数，再保存行程');
    const budget = this.pricing.calculate({
      items,
      currency: request.budget.currency,
      people:
        request.adults !== null && request.children !== null
          ? request.adults + request.children
          : 1,
      rates: doc.rates,
      reserveBps: doc.reserveBps,
    });
    const conditionIssues = this.pricing.conditionIssues(items, request);
    if (conditionIssues.length) {
      budget.rankingEligible = false;
      budget.issues.push(...conditionIssues.slice(0, Math.max(0, 100 - budget.issues.length)));
    }
    const violations = validatePlan(draft, doc, budget);
    if (
      violations.some((issue) =>
        [
          'MISSING_COST_CATEGORY',
          'CHILD_POLICY_UNKNOWN',
          'TOUR_TERMS_UNKNOWN',
          'TOUR_PRODUCT_MISSING',
          'DRIVING_ROUTE_MISSING',
          'ACTIVITY_PRICE_UNKNOWN',
        ].includes(issue.code),
      )
    ) {
      budget.complete = false;
      budget.rankingEligible = false;
    }
    const status = violations.some((issue) => issue.severity === 'error')
      ? 'invalid'
      : violations.length
        ? 'needs_confirmation'
        : 'validated';
    return this.repository.saveVersion(
      userId,
      id,
      revision,
      (version) => ({
        id: randomUUID(),
        tripId: id,
        version,
        parentId,
        createdAt: new Date().toISOString(),
        reason,
        draft,
        violations,
        status,
        budget,
        prices: items.filter((item) => item.selected),
        rates: doc.rates,
        reserveBps: doc.reserveBps,
        sources: doc.evidence.filter((source) =>
          new Set([
            ...draft.days.flatMap((day) => day.items.flatMap((item) => item.evidenceIds)),
            ...items.filter((item) => item.selected).flatMap((item) => item.evidenceIds),
          ]).has(source.id),
        ),
        comparisonKey: createHash('sha256')
          .update(
            JSON.stringify({
              ...requestConditions(request),
              currency: request.budget.currency,
              reserveBps: doc.reserveBps,
            }),
          )
          .digest('hex'),
      }),
      activate,
    );
  }
  /** 初排逻辑是独立纯函数，读取真实候选后仍经过相同的保存与校验入口。 */
  async generate(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof generatePlanSchema.parse>,
  ) {
    const workspace = await this.repository.get(userId, id);
    return this.save(
      userId,
      id,
      revision,
      buildAutoPlan(workspace.document, input),
      '基于已保存候选自动初排',
    );
  }
  /** 局部替换创建子版本，全部约束和金额重新计算。 */
  async replace(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof replaceScheduleSchema.parse>,
  ) {
    const previous = await this.repository.version(userId, id, input.baseVersionId);
    const draft = structuredClone(previous.draft);
    const old = draft.days.flatMap((day) => day.items).find((item) => item.id === input.itemId);
    if (old) {
      draft.costIds = [
        ...new Set([
          ...draft.costIds.filter((id) => !old.costIds.includes(id)),
          ...input.replacement.costIds,
        ]),
      ];
    }
    let found = false;
    for (const day of draft.days) {
      const index = day.items.findIndex((item) => item.id === input.itemId);
      if (index >= 0) {
        day.items[index] = input.replacement;
        found = true;
      }
    }
    if (!found) throw new BadRequestException('被替换活动不存在');
    return this.save(userId, id, revision, draft, input.reason, previous.id);
  }
  /** 同一项目的版本比较显式列出变化，过期报价重新失去排名资格。 */
  async compare(userId: string, id: string, versionIds: string[]) {
    const workspace = await this.repository.get(userId, id);
    const versions = await Promise.all(
      versionIds.map((versionId) => this.repository.version(userId, id, versionId)),
    );
    const rows = versions.map((version) => {
      const ids = new Set(version.draft.costIds);
      const items = version.prices.map((item) => ({ ...item, selected: true }));
      const request = workspace.document.request;
      if (request.adults === null || request.children === null)
        throw new BadRequestException('比较前请确认成人和儿童人数');
      const budget = this.pricing.calculate({
        items,
        currency: request.budget.currency,
        people:
          request.adults !== null && request.children !== null
            ? request.adults + request.children
            : 1,
        rates: version.rates,
        reserveBps: version.reserveBps,
      });
      const conditions = this.pricing.conditionIssues(items, request);
      const dates = version.draft.days.map((day) => day.date).join(',');
      const expected =
        request.startDate && request.days
          ? Array.from({ length: request.days }, (_, index) =>
              addDays(request.startDate!, index),
            ).join(',')
          : '';
      const key = createHash('sha256')
        .update(
          JSON.stringify({
            ...requestConditions(request),
            currency: request.budget.currency,
            reserveBps: workspace.document.reserveBps,
          }),
        )
        .digest('hex');
      const currentViolations = validatePlan(version.draft, workspace.document, budget);
      /** 比较时重审完整性，不把一个只算过餐费的旧版本显示成完整总价。 */
      if (
        currentViolations.some((issue) =>
          [
            'MISSING_COST_CATEGORY',
            'CHILD_POLICY_UNKNOWN',
            'TOUR_TERMS_UNKNOWN',
            'TOUR_PRODUCT_MISSING',
            'DRIVING_ROUTE_MISSING',
            'ACTIVITY_PRICE_UNKNOWN',
          ].includes(issue.code),
        )
      ) {
        budget.complete = false;
        budget.rankingEligible = false;
      }
      const eligible =
        budget.rankingEligible &&
        !conditions.length &&
        dates === expected &&
        version.comparisonKey === key &&
        !currentViolations.some(
          (issue) =>
            issue.severity === 'error' ||
            ['MISSING_COST_CATEGORY', 'CHILD_POLICY_UNKNOWN'].includes(issue.code),
        );
      return {
        id: version.id,
        version: version.version,
        title: version.draft.title,
        mode: version.draft.mode,
        budget,
        eligible,
        reason: eligible
          ? '同日期、人数和费用口径，可比较已知价格性质'
          : (conditions[0] ??
            (dates !== expected ? '行程日期与当前需求不同' : '费用或行程尚未完整核实')),
        priceNature: items
          .filter((item) => item.selected)
          .every((item) => item.priceType === 'live_quote')
          ? 'live_quote'
          : 'estimate',
        minutes: version.draft.days.reduce(
          (sum, day) =>
            sum +
            day.items.reduce(
              (n, item) => n + item.endMinute - item.startMinute + (item.travelBeforeMinutes ?? 0),
              0,
            ),
          0,
        ),
      };
    });
    const kinds = new Set(rows.filter((row) => row.eligible).map((row) => row.priceNature));
    const ranked = rows
      .filter((row) => row.eligible && kinds.size === 1)
      .sort((a, b) => a.budget.totalWithReserveMinor - b.budget.totalWithReserveMinor);
    return {
      rows,
      rankedIds: ranked.map((row) => row.id),
      rankingLabel: ranked.length
        ? ranked[0]!.priceNature === 'live_quote'
          ? '同口径授权报价合计'
          : '同口径估算合计（不等于可预订价格）'
        : '当前条件不支持价格排名',
      differences: versions.slice(1).map((version) => ({
        from: versions[0]!.id,
        to: version.id,
        changedDays: version.draft.days
          .filter(
            (day, index) => JSON.stringify(day) !== JSON.stringify(versions[0]!.draft.days[index]),
          )
          .map((day) => day.date),
        titleChanged: version.draft.title !== versions[0]!.draft.title,
      })),
    };
  }
}
