/** 业务工具把完整记录留在项目中，给模型和执行面板返回保留关键事实的紧凑投影。 */
import type { TripWorkspace, TransportOption, Experience, Evidence } from '@journey/contracts';
/** 分页结果必须有总数和下一页位置，不能把未展示候选误称为不存在。 */
export function travelToolSummary(
  trip: TripWorkspace,
  section: string,
  previous?: TripWorkspace,
  offset = 0,
) {
  const document = trip.document;
  const source: { id: string }[] =
    section === 'plans'
      ? trip.versions
      : section === 'request'
        ? []
        : (document[section as 'evidence'] ?? []);
  const before: { id: string }[] = previous?.document[section as 'evidence'] ?? [];
  const relevant = previous
    ? source.filter(
        (item) =>
          !before.some((old) => old.id === item.id && JSON.stringify(old) === JSON.stringify(item)),
      )
    : source;
  /** 一页四个完整候选，优先保留价格和ID；重复的入住/乘客条件只在context给出一次。 */
  const entries = relevant.slice(offset, offset + 4).map((item) => {
    if (section === 'transport') {
      const option = item as TransportOption;
      return {
        id: option.id,
        mode: option.mode,
        label: option.label,
        origin: option.origin,
        destination: option.destination,
        departure: option.departure,
        arrival: option.arrival,
        durationMinutes: option.durationMinutes,
        availability: option.availability,
        seatType: option.seatType,
        checkedAt: option.checkedAt,
        checkedAtLocal:
          new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Shanghai',
            dateStyle: 'short',
            timeStyle: 'medium',
          }).format(new Date(option.checkedAt)) + ' Asia/Shanghai',
        quote: option.quote
          ? {
              id: option.quote.id,
              priceType: option.quote.priceType,
              unitAmountMinor: option.quote.unitAmountMinor,
              currency: option.quote.currency,
              quantity: option.quote.quantity,
              unit: option.quote.unit,
              selected: option.quote.selected,
              notes: option.quote.notes,
              sourceUrl: option.quote.sourceUrl,
              provider: option.quote.provider,
              checkedAt: option.quote.checkedAt,
            }
          : null,
      };
    }
    if (section === 'experiences') {
      const experience = item as Experience;
      return {
        id: experience.id,
        kind: experience.kind,
        name: experience.name,
        point: experience.point,
        address: experience.address,
        opening: experience.opening,
        reservation: experience.reservation,
        quote: experience.quote,
        notes: experience.notes,
      };
    }
    if (section === 'evidence') {
      const evidence = item as Evidence;
      return {
        id: evidence.id,
        title: evidence.title,
        url: evidence.url,
        summary: evidence.excerpt.slice(0, 500),
        checkedAt: evidence.checkedAt,
      };
    }
    return item;
  });
  return {
    tripId: trip.id,
    revision: trip.revision,
    section,
    ...(section === 'request'
      ? { request: document.request, clarifications: trip.clarifications }
      : {
          context: {
            destination: document.request.destination,
            startDate: document.request.startDate,
            queryTimeZone: 'Asia/Shanghai',
            adults: document.request.adults,
            children: document.request.children,
            rooms: document.request.rooms,
            nights: document.request.nights,
            moneyUnit: '所有AmountMinor金额为最小货币单位；CNY为分',
          },
        }),
    total: source.length,
    matched: relevant.length,
    offset,
    nextOffset: offset + entries.length < relevant.length ? offset + entries.length : null,
    data: entries,
  };
}
