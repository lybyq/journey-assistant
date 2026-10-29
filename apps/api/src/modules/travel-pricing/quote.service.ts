/** 报价编辑与金额计算分离，客户端不能伪造授权供应商身份。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 费用与汇率都有严格类型和完整条件。 */
import {
  costItemSchema,
  setCostsSchema,
  type CostItem,
  type TripDocument,
} from '@journey/contracts';
/** 项目修改必须经过归属和乐观锁。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 纯计算器不依赖HTTP控制器。 */
import { PricingService } from './pricing.service.js';
/** 引用来源必须存在于当前项目，而不是其他账户的证据。 */
export function assertEvidence(document: TripDocument, ids: string[]): void {
  const known = new Set(document.evidence.map((item) => item.id));
  if (ids.some((id) => !known.has(id)))
    throw new BadRequestException('引用了不属于当前旅行项目的证据');
}
/** 新的用户报价只允许manual来源；原供应商报价只能切换selected。 */
export function assertManualQuote(item: CostItem, existing?: CostItem): void {
  if (existing) {
    const normalize = (quote: CostItem) => JSON.stringify({ ...quote, selected: false });
    if (normalize(existing) !== normalize(item))
      throw new BadRequestException('已有报价只能切换选择，修改时请另建人工估算以保留历史依据');
    return;
  }
  if (item.provenance !== 'manual' || item.priceType === 'live_quote')
    throw new BadRequestException('人工报价不能冒充授权供应商实时报价');
  if (Date.parse(item.checkedAt) > Date.now() + 60000)
    throw new BadRequestException('报价查询时间不能在未来');
}
/** 费用选择、汇率录入与预算输出的统一入口。 */
@Injectable()
export class QuoteService {
  /** 预算与仓储可单独注入测试。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly pricing: PricingService,
  ) {}
  /** 替换费用列表时保留已被不可变版本引用的原始费用，禁止删除历史依据。 */
  async set(userId: string, id: string, input: ReturnType<typeof setCostsSchema.parse>) {
    return this.repository.mutate(userId, id, input.revision, (document) => {
      const previous = new Map(document.costs.map((item) => [item.id, item]));
      if (document.costs.some((item) => !input.costs.some((next) => next.id === item.id)))
        throw new BadRequestException('请取消选择费用项，不能删除版本可能引用的历史报价');
      for (const item of input.costs) {
        assertManualQuote(item, previous.get(item.id));
        assertEvidence(document, item.evidenceIds);
      }
      if (new Set(input.costs.map((item) => item.id)).size !== input.costs.length)
        throw new BadRequestException('费用ID重复');
      document.costs = input.costs;
      document.rates = input.rates;
      document.reserveBps = input.reserveBps;
      return document;
    });
  }
  /** 单条录入同样走严格来源限制，模型工具也不能绕过。 */
  async add(userId: string, id: string, revision: number, item: CostItem) {
    const quote = costItemSchema.parse(item);
    assertManualQuote(quote);
    return this.repository.mutate(userId, id, revision, (document) => {
      assertEvidence(document, quote.evidenceIds);
      if (document.costs.some((existing) => existing.id === quote.id))
        throw new BadRequestException('费用ID已存在');
      document.costs.push(quote);
      return document;
    });
  }
  /** 有未知人数时拒绝人均计算，不能默认按一人分摊。 */
  async calculate(userId: string, id: string) {
    const workspace = await this.repository.get(userId, id);
    const doc = workspace.document;
    const request = doc.request;
    if (request.adults === null || request.children === null)
      throw new BadRequestException('请先确认成人和儿童人数');
    const budget = this.pricing.calculate({
      items: doc.costs,
      currency: request.budget.currency,
      people: request.adults + request.children,
      rates: doc.rates,
      reserveBps: doc.reserveBps,
    });
    const issues = this.pricing.conditionIssues(doc.costs, request);
    return {
      ...budget,
      rankingEligible: budget.rankingEligible && !issues.length,
      issues: [...budget.issues, ...issues].slice(0, 100),
    };
  }
}
