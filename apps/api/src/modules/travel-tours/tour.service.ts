/** 跟团产品条款标准化，页面起价和指定团期报价严格区分。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 产品和费用ID由服务端独立生成，名称相同不自动合并。 */
import { randomUUID } from 'node:crypto';
/** 团产品必须保留包含项、不包含项、购物、自费和退改字段。 */
import { tourProductSchema, type TourProduct } from '@journey/contracts';
/** 项目数据与证据归属统一检查。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 人工产品不能自报供应商实时报价。 */
import { assertEvidence, assertManualQuote } from '../travel-pricing/quote.service.js';
/** 授权网关采用项目明确定义并验证的v1合约。 */
import { SupplierService } from '../travel-suppliers/supplier.service.js';
/** 供应商数组仅取有限候选，禁止无限灌入数据。 */
import { asRecords } from '../travel/travel-mcp.service.js';
/** 人工条款与授权网关走不同的来源身份。 */
@Injectable()
export class TourService {
  /** 不在此服务中记录或传递供应商Key。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly supplier: SupplierService,
  ) {}
  /** 人工录入后仍显示需要确认的缺项，不能因为有总价就抹去单房差。 */
  async manual(userId: string, id: string, revision: number, input: TourProduct) {
    const product = tourProductSchema.parse(input);
    assertManualQuote(product.quote);
    return this.repository.mutate(userId, id, revision, (document) => {
      assertEvidence(document, product.evidenceIds);
      assertEvidence(document, product.quote.evidenceIds);
      if (document.tours.some((item) => item.id === product.id))
        throw new BadRequestException('团产品ID重复');
      document.tours.push(this.clarify(product));
      document.costs.push(product.quote);
      return document;
    });
  }
  /** 查询只发送行程所需字段，不传用户身份、聊天历史或自由备注。 */
  async query(userId: string, id: string, revision: number, signal: AbortSignal) {
    const workspace = await this.repository.get(userId, id);
    const request = workspace.document.request;
    if (
      workspace.revision !== revision ||
      !request.startDate ||
      !request.origin ||
      !request.destination ||
      request.adults === null ||
      request.children === null
    )
      throw new BadRequestException('请刷新并先确认日期、出发目的地和人数');
    const raw = await this.supplier.tours(
      {
        origin: request.origin,
        destination: request.destination,
        startDate: request.startDate,
        endDate: request.endDate,
        adults: request.adults,
        children: request.children,
        childAges: request.childAges,
        rooms: request.rooms,
        hotelStandard: request.hotelStandard,
        currency: request.budget.currency,
      },
      signal,
    );
    const now = new Date().toISOString();
    const products = asRecords(raw.products)
      .slice(0, 5)
      .map((rawProduct) => {
        const product = tourProductSchema.parse({
          ...rawProduct,
          id: randomUUID(),
          quote: {
            ...rawProduct.quote,
            id: randomUUID(),
            provenance: 'supplier',
            provider: '已授权旅行团网关',
            checkedAt: now,
            selected: false,
          },
          evidenceIds: [],
          needsConfirmation: rawProduct.needsConfirmation ?? [],
        });
        if (
          product.quote.conditions.startDate !== request.startDate ||
          product.quote.conditions.adults !== request.adults ||
          product.quote.conditions.children !== request.children
        )
          throw new BadRequestException('供应商返回了不同团期或人数的报价，已拒绝混用');
        return this.clarify(product);
      });
    if (!products.length) throw new BadRequestException('授权供应商没有返回产品');
    return this.repository.mutate(userId, id, revision, (document) => {
      document.tours.push(...products);
      document.costs.push(...products.map((product) => product.quote));
      return document;
    });
  }
  /** 缺失值仍明确列出，而不是补成0元或“全包”。 */
  private clarify(product: TourProduct): TourProduct {
    const needs = [...product.needsConfirmation];
    if (!product.departureDate) needs.push('尚未确认指定团期');
    if (product.singleSupplementMinor === null) needs.push('单房差未知，不能按0元计算');
    if (!product.cancellation.trim()) needs.push('取消与退款条款待确认');
    if (!product.hotelStandard) needs.push('酒店标准待确认');
    if (product.quote.priceType === 'advertised')
      needs.push('当前为页面起价，需核实指定团期和人数的可订总价');
    return { ...product, needsConfirmation: [...new Set(needs)].slice(0, 20) };
  }
}
