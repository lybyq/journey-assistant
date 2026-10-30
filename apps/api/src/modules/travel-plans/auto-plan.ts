/** 确定性初排只消费已保存候选，模型不能借此生成供应商库存。 */
import { BadRequestException } from '@nestjs/common';
/** 活动ID在服务端生成，候选ID保持不变以便回溯来源。 */
import { randomUUID } from 'node:crypto';
/** HTTP、Agent和网页共同使用同一严格输入契约。 */
import {
  generatePlanSchema,
  type TripDocument,
  type PlanDraft,
  type ScheduleItem,
} from '@journey/contracts';
/** 日历加法独立于服务器时区，地理排序只使用距离下限。 */
import { addDays } from '../trip-request/request.service.js';
/** 距离下限仅用于选点顺序，绝不替代真实导航时间。 */
import { distanceLowerBound } from './plan-validator.js';
/** 活动的公共默认值明确表示未知接驳和未确认预约。 */
function activity(
  title: string,
  kind: ScheduleItem['kind'],
  start: number,
  end: number,
  rest: Partial<ScheduleItem> = {},
): ScheduleItem {
  return {
    id: randomUUID(),
    title,
    kind,
    startMinute: start,
    endMinute: end,
    point: null,
    referenceId: null,
    evidenceIds: [],
    costIds: [],
    travelBeforeMinutes: null,
    walkMinutes: 0,
    driveMinutes: 0,
    reservationConfirmed: null,
    notes: '',
    ...rest,
  };
}
/** 读取供应商当地钟面，不把没有偏移的航班时间当作UTC转换。 */
function localMinute(value: string | null): number | null {
  const match = value?.match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
/** 首先放入不可移动的真实交通，再在空隙安排景点和休息。 */
export function buildAutoPlan(
  document: TripDocument,
  raw: ReturnType<typeof generatePlanSchema.parse>,
): PlanDraft {
  const input = generatePlanSchema.parse(raw);
  const request = document.request;
  if (!request.startDate || !request.days || !request.destinationTimeZone)
    throw new BadRequestException('请先确认出发日期、旅行天数和目的地时区');
  const days: PlanDraft['days'] = Array.from({ length: request.days }, (_, index) => ({
    date: addDays(request.startDate!, index),
    items: [],
  }));
  const costs = new Set(input.costIds);
  const assumptions = [
    '点间30分钟与游览90分钟是初排估算，需使用真实接驳路线进一步核实',
    '航班跨时区或跨午夜需人工核对目的地当地时间；无法转换的交通不伪造日程',
  ];
  /** 每个选择都必须属于当前聚合，不能用不存在的ID获得看似完整的方案。 */
  const lookup = <T extends { id: string }>(
    items: T[],
    id: string | null,
    label: string,
  ): T | undefined => {
    if (!id) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new BadRequestException(`所选${label}不存在`);
    return item;
  };
  for (const id of input.transportIds) {
    const option = lookup(document.transport, id, '交通')!;
    if (option.quote) costs.add(option.quote.id);
    const date = option.departure?.slice(0, 10);
    const day = days.find((entry) => entry.date === date);
    const departure = localMinute(option.departure);
    if (!day || departure === null || option.durationMinutes === null) {
      assumptions.push(`${option.label}时间或日期尚不能放入当前日程`);
      continue;
    }
    const start = departure - option.accessMinutes - option.bufferMinutes;
    const end = departure + option.durationMinutes + option.egressMinutes;
    if (start < 0 || end > 1440) {
      assumptions.push(`${option.label}跨午夜，请拆分日程并确认两地时区`);
      continue;
    }
    day.items.push(
      activity(
        `${option.label} · ${option.origin}→${option.destination} · ${option.seatType ?? '席别待核实'}`.slice(
          0,
          300,
        ),
        'transit',
        start,
        end,
        {
          referenceId: option.id,
          evidenceIds: option.evidenceIds,
          costIds: option.quote ? [option.quote.id] : [],
          travelBeforeMinutes: 0,
          notes: `班次当地时刻${option.departure?.slice(11, 16)}—${option.arrival?.slice(11, 16) ?? '待核实'}，车上历时${option.durationMinutes}分钟；进站接驳${option.accessMinutes}、候车缓冲${option.bufferMinutes}、离站${option.egressMinutes}分钟均为规划预留，接驳仍需核实。${option.notes}`,
        },
      ),
    );
  }
  /** 自驾按真实总驾驶分钟拆段，每段最多120分钟，实际休息和充电单独占时。 */
  const route = lookup(document.driving, input.drivingId, '自驾路线');
  if (input.mode === 'driving' && route) {
    for (const cost of route.costs) costs.add(cost.id);
    let drive = route.driveMinutes;
    let rests = route.restMinutes;
    let charging = route.chargingMinutes;
    for (const day of days) {
      let cursor = Math.max(8 * 60, ...day.items.map((item) => item.endMinute));
      let daily = 0;
      const max = Math.min(600, request.maxDriveMinutes ?? 360);
      while (drive > 0 && daily < max && cursor < 18 * 60) {
        const part = Math.min(120, drive, max - daily, 18 * 60 - cursor);
        if (part <= 0) break;
        drive -= part;
        daily += part;
        day.items.push(
          activity('自驾路线分段', 'transit', cursor, cursor + part, {
            referenceId: route.id,
            costIds: route.costs.map((cost) => cost.id),
            driveMinutes: part,
            travelBeforeMinutes: 0,
            point: drive === 0 ? route.destination : null,
            notes: '按真实路线总驾驶时间拆段；分段停靠点尚需按导航确认',
          }),
        );
        cursor += part;
        if (rests > 0 && cursor + 20 <= 19 * 60) {
          const partRest = Math.min(20, rests);
          day.items.push(
            activity('驾驶休息', 'rest', cursor, cursor + partRest, {
              travelBeforeMinutes: 0,
            }),
          );
          cursor += partRest;
          rests -= partRest;
        }
      }
      if (charging > 0 && cursor + charging <= 20 * 60) {
        day.items.push(
          activity('充电（站点待核实）', 'charging', cursor, cursor + charging, {
            travelBeforeMinutes: 0,
          }),
        );
        charging = 0;
      }
    }
    if (drive || rests || charging)
      assumptions.push(
        `路线尚有驾驶${drive}分钟、休息${rests}分钟、充电${charging}分钟未能安排；请增加天数或调整限制`,
      );
  }
  /** 旅行团日程只使用供应商或人工明确录入的条目；没有日程不编故事。 */
  const tour = lookup(document.tours, input.tourId, '旅行团');
  if (input.mode === 'group' && tour) {
    costs.add(tour.quote.id);
    for (const [index, day] of days.entries()) {
      const entries = tour.dailySchedule.filter((entry) => entry.day === index + 1);
      if (entries.length)
        for (const entry of entries)
          day.items.push(
            activity(entry.title, 'visit', entry.startMinute, entry.endMinute, {
              point: entry.point,
              referenceId: tour.id,
              evidenceIds: tour.evidenceIds,
              costIds: [tour.quote.id],
              notes: entry.notes,
            }),
          );
      else
        day.items.push(
          activity(`${tour.name} · 第${index + 1}天安排待确认`, 'visit', 9 * 60, 10 * 60, {
            referenceId: tour.id,
            evidenceIds: tour.evidenceIds,
            costIds: [tour.quote.id],
            notes: '占位仅提醒索取供应商逐日安排，不代表真实活动或可订库存',
          }),
        );
    }
  }
  /** 住宿只引用用户指定酒店，不把任意搜索第一条当作已经入住的酒店。 */
  const hotel = lookup(document.experiences, input.hotelId, '酒店');
  if (hotel && hotel.kind !== 'hotel') throw new BadRequestException('住宿选择必须是酒店');
  if (hotel?.quote) costs.add(hotel.quote.id);
  const candidates = input.experienceIds.length
    ? input.experienceIds.map((id) => lookup(document.experiences, id, '地点')!)
    : document.experiences.filter((item) => item.kind === 'attraction').slice(0, 9);
  const remaining = candidates.filter((item) => item.kind !== 'hotel');
  let previous = route?.destination ?? null;
  for (const [index, day] of days.entries()) {
    /** 跟团时不额外塞入自由行景点，避免与供应商日程重叠。 */
    if (input.mode !== 'group') {
      /** 返程是当天不可移动的结束边界，不能把晚班车结束时间当作游玩起点。 */
      const returns = day.items.filter(
        (item) =>
          item.kind === 'transit' &&
          document.transport.some(
            (option) =>
              option.id === item.referenceId &&
              (option.queryOrigin ?? option.origin).includes(request.destination ?? '') &&
              (option.queryDestination ?? option.destination).includes(request.origin ?? ''),
          ),
      );
      const latest = Math.min(18 * 60, ...returns.map((item) => item.startMinute - 30));
      let cursor = Math.max(
        9 * 60,
        ...day.items.filter((item) => !returns.includes(item)).map((item) => item.endMinute + 30),
      );
      const slots = Math.min(
        request.pace === 'relaxed' ? 2 : 3,
        Math.ceil(remaining.length / (days.length - index)),
      );
      for (let slot = 0; slot < slots && remaining.length; slot++) {
        remaining.sort((a, b) => {
          const mandatory = (name: string) =>
            request.mustVisit.some((required) => name.includes(required));
          return (
            Number(mandatory(b.name)) - Number(mandatory(a.name)) ||
            (previous && a.point && b.point
              ? distanceLowerBound(previous, a.point) - distanceLowerBound(previous, b.point)
              : 0)
          );
        });
        const place = remaining[0]!;
        let start = cursor;
        const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
        const windows = place.opening
          .filter((window) => window.dayOfWeek === weekday)
          .map((window) => ({
            start: Number(window.open.slice(0, 2)) * 60 + Number(window.open.slice(3)),
            end: Number(window.close.slice(0, 2)) * 60 + Number(window.close.slice(3)),
          }));
        if (windows.length) {
          const window = windows.find((window) => Math.max(start, window.start) + 90 <= window.end);
          if (!window) break;
          start = Math.max(start, window.start);
        }
        if (start + 90 > latest || place.closedDates.includes(day.date)) break;
        remaining.shift();
        if (place.quote) costs.add(place.quote.id);
        day.items.push(
          activity(place.name, place.kind === 'restaurant' ? 'meal' : 'visit', start, start + 90, {
            point: place.point,
            referenceId: place.id,
            evidenceIds: place.evidenceIds,
            costIds: place.quote ? [place.quote.id] : [],
            travelBeforeMinutes: day.items.length ? 30 : 0,
            walkMinutes: place.kind === 'attraction' ? 45 : 0,
            notes: '游览90分钟、点间30分钟属于估算；开放时间采用已保存窗口，预约需另行确认',
          }),
        );
        cursor = start + 120;
        previous = place.point;
      }
      const last = Math.max(
        12 * 60,
        ...day.items.filter((item) => !returns.includes(item)).map((item) => item.endMinute + 30),
      );
      if (last + 60 <= Math.min(20 * 60, ...returns.map((item) => item.startMinute - 30)))
        day.items.push(
          activity('用餐与休息（地点待确认）', 'meal', last, last + 60, {
            notes: '餐厅、餐费和饮食限制待确认',
          }),
        );
    }
    if (hotel && index < Math.min(request.nights ?? 0, days.length)) {
      const start = Math.max(20 * 60, ...day.items.map((item) => item.endMinute + 30));
      if (start + 60 <= 1440)
        day.items.push(
          activity(hotel.name, 'hotel', start, start + 60, {
            point: hotel.point,
            referenceId: hotel.id,
            evidenceIds: hotel.evidenceIds,
            costIds: hotel.quote ? [hotel.quote.id] : [],
            notes: '此段表示到店办理入住，不代表已预订；整段住宿报价仅在总预算计一次',
          }),
        );
    }
    day.items.sort((a, b) => a.startMinute - b.startMinute);
  }
  if (remaining.length && input.mode !== 'group')
    assumptions.push(`${remaining.length}个候选未排入，避免突破营业或每日时长`);
  return {
    title: input.title,
    mode: input.mode,
    timeZone: request.destinationTimeZone,
    days,
    costIds: [...costs],
    assumptions: assumptions.slice(0, 30),
  };
}
