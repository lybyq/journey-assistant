/** 真实地点、营业预约条件和酒店报价分开处理。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 地点与费用ID只由本服务创建。 */
import { randomUUID } from 'node:crypto';
/** 多类体验仍保留各自字段，不把地点搜索当酒店库存。 */
import {
  experienceSchema,
  placeQuerySchema,
  hotelQuerySchema,
  currencySchema,
  type Experience,
  type CostItem,
  type GeoPoint,
} from '@journey/contracts';
/** 归属与CAS由共享仓储控制。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 地图与授权报价使用不同数据渠道。 */
import { TravelMcpService, asRecord, asRecords } from '../travel/travel-mcp.service.js';
/** 授权接口没有配置时明确503，不用地图搜索结果补假房价。 */
import { SupplierService } from '../travel-suppliers/supplier.service.js';
/** 金额按最小单位解析，房晚口径不交给模型猜。 */
import { decimalMinor, requestConditions } from '../travel-pricing/pricing.service.js';
/** 手工输入不能改成supplier来源。 */
import { assertEvidence, assertManualQuote } from '../travel-pricing/quote.service.js';
/** 高德地点字符串统一解析成GCJ-02，缺坐标就保留未知。 */
export function parsePoint(value: unknown): GeoPoint | null {
  const parts = String(value ?? '').split(',');
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
    ? { lng, lat, coordinateSystem: 'GCJ-02' }
    : null;
}
/** 住宿、景点、餐饮候选与人工条款录入。 */
@Injectable()
export class ExperienceService {
  /** 不把供应商认证暴露给领域控制器。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly mcp: TravelMcpService,
    private readonly supplier: SupplierService,
  ) {}
  /** 只读配置摘要供智能体决定是否能查库存，不暴露任何密钥。 */
  supplierStatus() {
    return this.supplier.status();
  }
  /** 地点搜索只证明名称/地址/位置，营业、预约和价格保持未知。 */
  async places(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof placeQuerySchema.parse>,
    signal: AbortSignal,
  ) {
    const workspace = await this.repository.get(userId, id);
    if (workspace.revision !== revision) throw new BadRequestException('项目已更新，请刷新');
    const call = await this.mcp.session(signal);
    const raw = asRecord(
      await call('amap__maps_text_search', {
        keywords: input.keywords,
        city: input.city,
      }),
    );
    const pois = asRecords(raw.pois ?? asRecord(raw.data).pois).slice(0, 6);
    if (!pois.length) throw new BadRequestException('高德未返回可用地点');
    const located = pois
      .slice(0, 3)
      .filter((poi) => !parsePoint(poi.location) && typeof poi.id === 'string');
    await Promise.all(
      located.map(async (poi) => {
        try {
          const detail = asRecord(await call('amap__maps_search_detail', { id: poi.id }));
          poi.location =
            detail.location ?? asRecord(detail.data).location ?? asRecord(detail.poi).location;
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }),
    );
    const entries: Experience[] = pois.map((poi) =>
      experienceSchema.parse({
        id: randomUUID(),
        kind: input.kind,
        name: String(poi.name ?? input.keywords).slice(0, 300),
        point: parsePoint(poi.location),
        address: String(poi.address ?? '').slice(0, 300),
        opening: [],
        closedDates: [],
        reservation: 'unknown',
        accessible: null,
        childPolicy: '尚未核实',
        cancellation: '尚未核实',
        breakfastIncluded: null,
        evidenceIds: [],
        quote: null,
        notes: '来自高德地点查询；未查询库存，营业时间、预约、儿童政策和价格需要证据或供应商确认。',
      }),
    );
    return this.repository.mutate(userId, id, revision, (document) => {
      /** 同一地点查询更新坐标，保留已有ID、价格和人工核验条款，避免重复候选占满容量。 */
      for (const entry of entries) {
        const existing = document.experiences.find(
          (old) =>
            old.kind === entry.kind && old.name === entry.name && old.address === entry.address,
        );
        if (existing) {
          if (entry.point) existing.point = entry.point;
        } else document.experiences.push(entry);
      }
      return document;
    });
  }
  /** 用户录入完整开放时间与条款；来源ID必须属于本项目。 */
  async manual(userId: string, id: string, revision: number, input: Experience) {
    const entry = experienceSchema.parse(input);
    if (entry.quote) assertManualQuote(entry.quote);
    return this.repository.mutate(userId, id, revision, (document) => {
      assertEvidence(document, entry.evidenceIds);
      if (entry.quote) assertEvidence(document, entry.quote.evidenceIds);
      if (document.experiences.some((existing) => existing.id === entry.id))
        throw new BadRequestException('地点ID已经存在；修改请另存候选以保留版本依据');
      document.experiences.push(entry);
      if (entry.quote) document.costs.push(entry.quote);
      return document;
    });
  }
  /** 酒店接口查1间房全程价格后按房间数估算，不能误把每晚价重复乘晚数。 */
  async hotels(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof hotelQuerySchema.parse>,
    signal: AbortSignal,
  ) {
    /** 房间入住组合未确定时拒绝库存查询，尤其不能默认为儿童免费。 */
    const workspace = await this.repository.get(userId, id);
    const request = workspace.document.request;
    if (
      workspace.revision !== revision ||
      !request.startDate ||
      request.nights === null ||
      request.nights < 1 ||
      request.rooms === null ||
      request.adults === null ||
      request.children === null
    )
      throw new BadRequestException('请先确认入住日、住宿晚数、间数和成人儿童人数');
    if (request.children > 0 || request.adults % request.rooms !== 0)
      throw new BadRequestException(
        '儿童或房间住客分配需要供应商单独确认；请先录入有明确住客条件的报价',
      );
    /** 报价入住/离店以住宿晚数计算，离店日可以与最后游玩日不同。 */
    const checkOut = new Date(
      Date.parse(`${request.startDate}T00:00:00Z`) + request.nights * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const list = await this.supplier.amadeus(
      '/v1/reference-data/locations/hotels/by-city',
      { cityCode: input.cityCode, radius: '10', radiusUnit: 'KM' },
      signal,
    );
    const hotelIds = asRecords(list.data)
      .slice(0, 4)
      .map((hotel) => hotel.hotelId)
      .filter((value) => typeof value === 'string');
    if (!hotelIds.length) throw new BadRequestException('供应商未返回该城市酒店');
    /** 每次明确查询1间的住客配置，多房可用性不擅自推断。 */
    const raw = await this.supplier.amadeus(
      '/v3/shopping/hotel-offers',
      {
        hotelIds: hotelIds.join(','),
        adults: String(request.adults / request.rooms),
        roomQuantity: '1',
        checkInDate: request.startDate,
        checkOutDate: checkOut,
        currency: request.budget.currency,
      },
      signal,
    );
    const now = new Date().toISOString();
    const production = this.supplier.status()[0]?.environment === 'production';
    const entries: Experience[] = asRecords(raw.data)
      .filter((hotel) => hotel.available !== false)
      .slice(0, 4)
      .flatMap((hotel) =>
        asRecords(hotel.offers)
          .slice(0, 1)
          .map((offer) => {
            /** 回应币种必须读取供应商自身字段，不能假定其遵守请求币种。 */
            const currency = currencySchema.parse(offer.price?.currency);
            const amount = decimalMinor(String(offer.price?.total ?? ''), currency);
            const quote: CostItem = {
              id: randomUUID(),
              label: `${hotel.hotel?.name ?? '酒店'} · 每间全程${request.nights}晚`,
              category: 'lodging',
              scopeKey: `lodging:${hotel.hotel?.hotelId ?? randomUUID()}`,
              priceType: production && request.rooms === 1 ? 'live_quote' : 'estimate',
              unitAmountMinor: amount,
              currency,
              quantity: request.rooms!,
              unit: 'trip',
              required: true,
              selected: false,
              includes: [],
              provenance: 'supplier',
              provider: production ? 'Amadeus' : 'Amadeus TEST 非生产报价',
              sourceUrl: 'https://developers.amadeus.com/',
              evidenceIds: [],
              checkedAt: now,
              validUntil: new Date(Date.now() + 5 * 60000).toISOString(),
              conditions: {
                ...requestConditions(request),
                mandatoryFeesIncluded: null,
              },
              notes: `供应商返回1间房全程价，乘${request.rooms}间，不能再次乘住宿晚数。税费、押金、早餐和多房库存需确认；退改见产品条款。`,
            };
            return experienceSchema.parse({
              id: randomUUID(),
              kind: 'hotel',
              name: String(hotel.hotel?.name ?? '供应商酒店').slice(0, 300),
              point: null,
              address: '以供应商确认为准',
              opening: [],
              closedDates: [],
              reservation: 'required',
              accessible: null,
              childPolicy: '本查询不含儿童入住配置',
              cancellation: JSON.stringify(
                offer.policies?.cancellations ?? offer.policies ?? {},
              ).slice(0, 1500),
              breakfastIncluded: offer.boardType === 'BREAKFAST' ? true : null,
              evidenceIds: [],
              quote,
              notes: quote.notes,
            });
          }),
      );
    if (!entries.length) throw new BadRequestException('没有符合入住条件的酒店报价');
    return this.repository.mutate(userId, id, revision, (document) => {
      document.experiences.push(...entries);
      document.costs.push(...entries.flatMap((entry) => (entry.quote ? [entry.quote] : [])));
      return document;
    });
  }
}
