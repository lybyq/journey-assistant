/** 车次、航班与门到门接驳使用标准化结果，不直接渲染供应商JSON。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 每个查询选项有不可猜测ID，不能用车次名称跨项目引用。 */
import { randomUUID } from 'node:crypto';
/** 入参和选项使用共享领域结构。 */
import {
  railQuerySchema,
  flightQuerySchema,
  currencySchema,
  transportOptionSchema,
  type TransportOption,
  type CostItem,
} from '@journey/contracts';
/** 当前上海日期用于拒绝过期和明显超出售票窗口的查询。 */
import { shanghaiDate, addDays } from '../trip-request/request.service.js';
/** 金额和条件生成与预算计算共用。 */
import { decimalMinor, requestConditions } from '../travel-pricing/pricing.service.js';
/** 归属仓储是外部调用之前的第一道边界。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 铁路查询只经过固定MCP工具；航班使用授权HTTP供应商。 */
import { TravelMcpService, asRecord, asRecords } from '../travel/travel-mcp.service.js';
/** 供应商配置不会从HTTP或模型参数传入。 */
import { SupplierService } from '../travel-suppliers/supplier.service.js';
/** HH:mm时长不会被误当成十进制小时。 */
export function durationMinutes(value: unknown): number | null {
  const match = /^(\d{1,3}):(\d{2})$/.exec(String(value ?? ''));
  return match && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
}
/** 库存字段含义明确区分无、候补、有和数字余票。 */
export function railAvailability(value: unknown): TransportOption['availability'] {
  const text = String(value ?? '');
  return text === '有' || (/^\d+$/.test(text) && Number(text) > 0)
    ? 'available'
    : ['无', '--', '0', '候补'].includes(text)
      ? 'unavailable'
      : 'unknown';
}
/** 工具故障、无车次与超出售票范围是不同结果。 */
@Injectable()
export class TransportService {
  /** 交通领域不直接接触密钥，只依赖两个受控供应商边界。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly mcp: TravelMcpService,
    private readonly supplier: SupplierService,
  ) {}
  /** 先查站点编码再查直达或中转，JSON格式避免猜测中文展示文本。 */
  async rail(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof railQuerySchema.parse>,
    signal: AbortSignal,
  ) {
    /** 查询日期范围是清晰的日历窗口；实际售票仍以铁路返回为准。 */
    const workspace = await this.repository.get(userId, id);
    if (workspace.revision !== revision) throw new BadRequestException('项目已更新，请刷新');
    const today = shanghaiDate();
    if (input.date < today || input.date > addDays(today, 14))
      throw new BadRequestException('仅查询今天起15天内的铁路车票；具体起售时间以12306为准');
    /** 城市名优先查询代表站，失败再按具体站名解析，不能自行编造电报码。 */
    const call = await this.mcp.session(signal);
    const cities = asRecord(
      await call('train__get_station_code_of_citys', {
        citys: `${input.origin}|${input.destination}`,
      }),
    );
    let stations: Record<string, any> = {};
    if (!this.code(cities[input.origin]) || !this.code(cities[input.destination]))
      stations = asRecord(
        await call('train__get_station_code_by_names', {
          stationNames: `${input.origin}|${input.destination}`,
        }),
      );
    const from = this.code(cities[input.origin]) ?? this.code(stations[input.origin]);
    const to = this.code(cities[input.destination]) ?? this.code(stations[input.destination]);
    if (!from || !to) throw new BadRequestException('无法确定出发或到达站，请填写具体中文车站名');
    /** 最多四个候选，防止工具大输出被截断后误认为完整全部车次。 */
    const raw = await call(
      input.interline ? 'train__get_interline_tickets' : 'train__get_tickets',
      {
        date: input.date,
        fromStation: from,
        toStation: to,
        format: 'json',
        limitedNum: 4,
        sortFlag: 'duration',
      },
    );
    const tickets = asRecords(raw);
    if (!tickets.length)
      throw new BadRequestException('本次未获得结构化可用车次；可能无车次、尚未起售或供应商失败');
    const request = workspace.document.request;
    const now = new Date().toISOString();
    /** 每个席别单独形成选项，不把不同席别票价合并成一个虚构最低价。 */
    const options: TransportOption[] = tickets.slice(0, 4).flatMap((ticket) => {
      const legs = asRecords(ticket.ticketList);
      const prices = input.interline ? [] : asRecords(ticket.prices).slice(0, 3);
      const variants = prices.length ? prices : [null];
      return variants.map((price) => {
        const optionId = randomUUID();
        const amount =
          price && Number.isFinite(Number(price.price))
            ? decimalMinor(String(price.price), 'CNY')
            : null;
        const availability = price ? railAvailability(price.num) : 'unknown';
        const quote: CostItem = {
          id: randomUUID(),
          label: `${ticket.start_train_code ?? '铁路'} ${price?.seat_name ?? '中转席别待确认'}`,
          category: 'transport',
          scopeKey: `outbound:${optionId}`,
          priceType: amount === null ? 'unknown' : 'estimate',
          unitAmountMinor: amount,
          currency: 'CNY',
          quantity: request.adults ?? 1,
          unit: 'person',
          required: true,
          selected: false,
          includes: [],
          provenance: 'mcp',
          provider: '12306 MCP',
          sourceUrl: 'https://www.12306.cn/',
          evidenceIds: [],
          checkedAt: now,
          validUntil: null,
          conditions: {
            ...requestConditions(request),
            mandatoryFeesIncluded: true,
          },
          notes: '查询到的成人票面参考价；儿童票、起售时点和最终出票需要核实。尚未包含接驳费用。',
        };
        return transportOptionSchema.parse({
          id: optionId,
          mode: 'rail',
          label: String(
            ticket.start_train_code ??
              legs.map((leg) => leg.start_train_code).join('→') ??
              '铁路选项',
          ),
          origin: String(ticket.from_station ?? ticket.from_station_name ?? input.origin),
          destination: String(ticket.to_station ?? ticket.end_station_name ?? input.destination),
          departure: ticket.start_time
            ? `${ticket.start_date ?? input.date}T${ticket.start_time}:00+08:00`
            : null,
          arrival:
            ticket.arrive_date && ticket.arrive_time
              ? `${ticket.arrive_date}T${ticket.arrive_time}:00+08:00`
              : null,
          durationMinutes: durationMinutes(ticket.lishi),
          accessMinutes: input.accessMinutes,
          bufferMinutes: input.bufferMinutes,
          egressMinutes: input.egressMinutes,
          transfers: input.interline ? Math.max(1, legs.length - 1) : 0,
          availability,
          seatType: price?.seat_name ?? null,
          quote,
          evidenceIds: [],
          checkedAt: now,
          notes: `门到门还需${input.accessMinutes + input.bufferMinutes + input.egressMinutes}分钟接驳与缓冲；${request.children ? '儿童票种与年龄尚需核验。' : ''}${input.interline ? '中转段席别和总价未合并，价格保持未知。' : ''}`,
        });
      });
    });
    return this.repository.mutate(userId, id, revision, (document) => {
      document.transport.push(...options);
      document.costs.push(...options.flatMap((option) => (option.quote ? [option.quote] : [])));
      return document;
    });
  }
  /** 航班必须明确IATA代码、日期和成人儿童，不能把测试环境价格称为生产实时报价。 */
  async flights(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof flightQuerySchema.parse>,
    signal: AbortSignal,
  ) {
    const workspace = await this.repository.get(userId, id);
    const request = workspace.document.request;
    if (
      workspace.revision !== revision ||
      !request.startDate ||
      request.adults === null ||
      request.children === null
    )
      throw new BadRequestException('请刷新并先确认出发日期、成人及儿童人数');
    if (request.childAges.length !== request.children || request.childAges.some((age) => age < 2))
      throw new BadRequestException('请补全儿童年龄；婴儿票需要单独确认，不能按普通儿童查询');
    const data = await this.supplier.amadeus(
      '/v2/shopping/flight-offers',
      {
        originLocationCode: input.originCode,
        destinationLocationCode: input.destinationCode,
        departureDate: request.startDate,
        adults: String(request.adults),
        children: String(request.children),
        currencyCode: request.budget.currency,
        max: '4',
        ...(input.returnDate ? { returnDate: input.returnDate } : {}),
      },
      signal,
    );
    const now = new Date().toISOString();
    const production = this.supplier.status()[0]?.environment === 'production';
    const options = asRecords(data.data)
      .slice(0, 4)
      .flatMap((offer) => {
        const itineraries = asRecords(offer.itineraries);
        const segments = itineraries.flatMap((itinerary) => asRecords(itinerary.segments));
        const first = segments[0];
        const last = segments.at(-1);
        const currency = currencySchema.parse(offer.price?.currency);
        const amount = decimalMinor(
          String(offer.price?.grandTotal ?? offer.price?.total ?? ''),
          currency,
        );
        const optionId = randomUUID();
        const quote: CostItem = {
          id: randomUUID(),
          label: `航班${offer.id}`,
          category: 'transport',
          scopeKey: `flight:${optionId}`,
          priceType: production ? 'live_quote' : 'estimate',
          unitAmountMinor: amount,
          currency,
          quantity: 1,
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
            endDate: input.returnDate ?? request.endDate,
            mandatoryFeesIncluded: true,
          },
          notes: '全体旅客供应商返回总价；行李、退改、座位与出票前最终核价需再次确认。',
        };
        /** 往返产品共用一份总报价，各程仍保留独立的真实时刻。 */
        return itineraries.map((itinerary, index) => {
          const legSegments = asRecords(itinerary.segments);
          const start = legSegments[0];
          const end = legSegments.at(-1);
          const duration = String(itinerary.duration ?? '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
          return transportOptionSchema.parse({
            id: randomUUID(),
            mode: 'flight',
            label:
              legSegments
                .map((segment) => String(segment.carrierCode ?? '') + String(segment.number ?? ''))
                .join(' → ') || '供应商航班',
            origin:
              start?.departure?.iataCode ?? (index ? input.destinationCode : input.originCode),
            destination:
              end?.arrival?.iataCode ?? (index ? input.originCode : input.destinationCode),
            departure: start?.departure?.at ?? null,
            arrival: end?.arrival?.at ?? null,
            durationMinutes: duration
              ? Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)
              : null,
            accessMinutes: 60,
            bufferMinutes: 120,
            egressMinutes: 45,
            transfers: Math.max(0, legSegments.length - 1),
            availability: Number(offer.numberOfBookableSeats) > 0 ? 'available' : 'unknown',
            seatType: null,
            quote,
            evidenceIds: [],
            checkedAt: now,
            notes:
              '接驳60分钟、起飞前120分钟、落地45分钟为估算；往返各程共用同一总价，不重复累计。',
          });
        });
      });
    if (!options.length) throw new BadRequestException('供应商未返回航班选项');
    return this.repository.mutate(userId, id, revision, (document) => {
      document.transport.push(...options);
      document.costs.push(
        ...new Map(
          options.flatMap((option) =>
            option.quote ? [[option.quote.id, option.quote] as const] : [],
          ),
        ).values(),
      );
      return document;
    });
  }
  /** 城市编码返回值可能是字符串或包含station_code/telecode的对象。 */
  private code(value: unknown): string | null {
    const record = asRecord(value);
    const candidate =
      typeof value === 'string' ? value : (record.station_code ?? record.telecode ?? record.code);
    return typeof candidate === 'string' && /^[A-Z]{3}$/.test(candidate) ? candidate : null;
  }
}
