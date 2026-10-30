/** 独立确定性验证器不相信模型自报“行程合理”。 */
import type {
  ConstraintViolation,
  CostBreakdown,
  GeoPoint,
  PlanDraft,
  TripDocument,
} from '@journey/contracts';
/** 相邻日期运算使用日历函数，不受服务器时区影响。 */
import { addDays } from '../trip-request/request.service.js';
/** 球面直线距离只是实际道路的下限，不能宣称是实际导航里程。 */
export function distanceLowerBound(a: GeoPoint, b: GeoPoint): number {
  const radians = (v: number) => (v * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
/** HH:mm转换还要验证范围，正则形式正确并不代表99:99合法。 */
function minute(value: string): number | null {
  const [hour, min] = value.split(':').map(Number);
  return hour !== undefined &&
    min !== undefined &&
    hour >= 0 &&
    hour <= 24 &&
    min >= 0 &&
    min < 60 &&
    (hour < 24 || min === 0)
    ? hour * 60 + min
    : null;
}
/** 所有结论带稳定code和对应活动/日期，网页可直接定位问题。 */
export function validatePlan(
  draft: PlanDraft,
  document: TripDocument,
  budget: CostBreakdown,
  now = new Date(),
): ConstraintViolation[] {
  /** 每轮新建结果数组，不把上一版本的错误偷偷带入。 */
  const issues: ConstraintViolation[] = [];
  const request = document.request;
  const add = (
    code: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
    itemId: string | null = null,
    day: string | null = null,
  ) => issues.push({ code, message, severity, itemId, day });
  /** 时区必须明确有效且与需求一致。 */
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: draft.timeZone });
  } catch {
    add('INVALID_TIME_ZONE', '行程时区无效');
  }
  if (!request.destinationTimeZone || draft.timeZone !== request.destinationTimeZone)
    add('TIME_ZONE_MISMATCH', '请确认目的地当地时区，不能沿用未知或不同的时区');
  /** 日期、人数和完整长度是最基本的执行条件。 */
  if (request.adults === null || request.children === null)
    add('UNKNOWN_PARTY', '成人和儿童人数尚未确认');
  if (request.startDate === null || request.days === null)
    add('UNKNOWN_DATES', '出发日期或旅行天数尚未确认');
  if (request.days !== null && draft.days.length !== request.days)
    add('DAY_COUNT_MISMATCH', '行程天数与需求不一致');
  /** 费用引用只允许当前项目已保存报价，选中的包价不能跨项目引用。 */
  const costs = new Map(document.costs.map((cost) => [cost.id, cost]));
  const selected = new Set(draft.costIds);
  if (selected.size !== draft.costIds.length) add('DUPLICATE_COST', '方案重复引用同一费用');
  for (const id of selected)
    if (!costs.has(id)) add('UNKNOWN_COST', '方案引用的费用不属于当前项目');
  /** 预算缺失不能用0元掩盖；广告价与过期价不具备完整报价资格。 */
  if (!budget.complete) add('INCOMPLETE_BUDGET', '费用尚未齐全，当前只有已知小计', 'warning');
  if (!budget.rankingEligible)
    add('PRICE_NOT_RANKABLE', '当前价格含缺失、起价、过期或口径问题，不能作最低价承诺', 'warning');
  const people =
    request.adults !== null && request.children !== null ? request.adults + request.children : null;
  const limit =
    request.budget.maxMinor === null
      ? null
      : request.budget.maxMinor * (request.budget.scope === 'per_person' ? (people ?? 1) : 1);
  if (limit !== null && budget.totalWithReserveMinor > limit)
    add('OVER_BUDGET', '已知费用与预备金已经超过预算上限');
  /** 常见全程费用分类缺失时明确提醒，不把少几项的方案当便宜方案。 */
  const covered = new Set(
    [...selected].flatMap((id) => {
      const cost = costs.get(id);
      return cost ? [cost.category, ...cost.includes] : [];
    }),
  );
  /** 自驾车辆费用承担本次交通，不应要求再虚构一张火车票才能比较。 */
  if (covered.has('driving')) covered.add('transport');
  for (const category of ['transport', 'meal', ...(request.nights ? ['lodging'] : [])])
    if (!covered.has(category as 'transport'))
      add('MISSING_COST_CATEGORY', `未覆盖${category}费用，不能比较完整出行总价`, 'warning');
  /** 模式能力必须有真实候选依据，不能只改显示方式就宣称已完成规划。 */
  const referenced = new Set(
    draft.days.flatMap((day) =>
      day.items.flatMap((item) => (item.referenceId ? [item.referenceId] : [])),
    ),
  );
  if (draft.mode === 'driving' && !document.driving.some((route) => referenced.has(route.id)))
    add('DRIVING_ROUTE_MISSING', '自驾方案尚未绑定真实路线和车辆费用', 'warning');
  if (draft.mode === 'group' && !document.tours.some((tour) => referenced.has(tour.id)))
    add('TOUR_PRODUCT_MISSING', '跟团方案尚未绑定指定团期产品', 'warning');
  /** 必去点与团条款必须核对，已有候选不等于本方案已经选择。 */
  for (const place of request.mustVisit)
    if (!draft.days.some((day) => day.items.some((item) => item.title.includes(place))))
      add('MUST_VISIT_MISSING', `尚未安排必去地点：${place}`, 'warning');
  for (const tour of document.tours.filter((tour) => referenced.has(tour.id))) {
    if (tour.departureDate !== request.startDate || tour.days !== request.days)
      add('TOUR_DATE_MISMATCH', '旅行团团期或天数与需求不一致');
    if (tour.needsConfirmation.length || !tour.dailySchedule.length)
      add('TOUR_TERMS_UNKNOWN', '旅行团逐日安排或费用条款尚未确认', 'warning');
  }
  if (
    request.children &&
    [...selected].some(
      (id) => costs.get(id)?.provenance === 'mcp' && costs.get(id)?.category === 'transport',
    )
  )
    add(
      'CHILD_POLICY_UNKNOWN',
      '铁路票面查询只核实成人参考价，儿童票或免费条件需另行确认',
      'warning',
    );
  /** ID、日期和点位的真实性在所有日程上统一检查。 */
  const ids = new Set<string>();
  const dates = new Set<string>();
  const evidence = new Map(document.evidence.map((item) => [item.id, item]));
  for (const [dayIndex, day] of draft.days.entries()) {
    /** 日程日期应连续，并从用户确认的出发日开始。 */
    if (dates.has(day.date)) add('DUPLICATE_DAY', '同一天重复出现', 'error', null, day.date);
    dates.add(day.date);
    if (request.startDate && day.date !== addDays(request.startDate, dayIndex))
      add('NON_CONTIGUOUS_DAYS', '日程日期不连续或不从出发日开始', 'error', null, day.date);
    let previous: (typeof day.items)[number] | undefined;
    let walk = 0;
    let drive = 0;
    let rests = 0;
    for (const item of day.items) {
      /** 所有活动ID唯一，结束时间必须晚于开始时间。 */
      if (ids.has(item.id)) add('DUPLICATE_ITEM', '活动ID重复', 'error', item.id, day.date);
      ids.add(item.id);
      walk += item.walkMinutes;
      drive += item.driveMinutes;
      if (item.kind === 'rest' || item.kind === 'charging')
        rests += item.endMinute - item.startMinute;
      if (item.endMinute <= item.startMinute)
        add('INVALID_DURATION', '活动结束不晚于开始', 'error', item.id, day.date);
      /** 相邻活动不能只比较起止，还必须给出移动时间。 */
      if (previous) {
        const travel = item.travelBeforeMinutes ?? 0;
        if (item.startMinute < previous.endMinute + travel)
          add('TIME_CONFLICT', '活动与前项或接驳时间冲突', 'error', item.id, day.date);
        if (previous.point && item.point) {
          const meters = distanceLowerBound(previous.point, item.point);
          if (item.travelBeforeMinutes === null && meters > 200)
            add('UNVERIFIED_TRANSFER', '相邻点位尚未核实交通时间', 'warning', item.id, day.date);
          if (
            item.travelBeforeMinutes !== null &&
            meters > Math.max(200, item.travelBeforeMinutes * 2500)
          )
            add(
              'GEOGRAPHIC_IMPOSSIBLE',
              '直线距离已超过该交通时间内合理可达下限，请重查路线',
              'error',
              item.id,
              day.date,
            );
        }
      }
      /** 资料过期、预约未核实和开放时间缺失都保持可见。 */
      for (const id of item.evidenceIds) {
        const source = evidence.get(id);
        if (!source)
          add('UNKNOWN_EVIDENCE', '引用了当前项目不存在的来源', 'error', item.id, day.date);
        else if (Date.parse(source.expiresAt) <= now.getTime())
          add('STALE_EVIDENCE', '活动依据的资料已过期，请刷新', 'warning', item.id, day.date);
      }
      for (const id of item.costIds)
        if (!selected.has(id))
          add('UNSELECTED_ITEM_COST', '活动引用的费用未进入当前方案', 'error', item.id, day.date);
      /** 只从真实保存候选读取营业和无障碍条件，不能信任模型填一句“已确认”。 */
      const experience = item.referenceId
        ? document.experiences.find((entry) => entry.id === item.referenceId)
        : undefined;
      const referenceKnown =
        !item.referenceId ||
        experience ||
        document.transport.some((entry) => entry.id === item.referenceId) ||
        document.driving.some((entry) => entry.id === item.referenceId) ||
        document.tours.some((entry) => entry.id === item.referenceId);
      if (!referenceKnown)
        add('UNKNOWN_REFERENCE', '活动引用的候选不属于当前项目', 'error', item.id, day.date);
      /** 实际余票为不可用时不能继续当成可执行交通；未知仍显示待确认。 */
      const transport = document.transport.find((entry) => entry.id === item.referenceId);
      /** 手工调整也不能缩短真实班次耗时，或把另一日班次搬到当天。 */
      if (transport?.departure && transport.departure.slice(0, 10) !== day.date)
        add('TRANSPORT_DATE_MISMATCH', '交通班次日期与日程日期不一致', 'error', item.id, day.date);
      if (
        transport?.durationMinutes !== null &&
        transport?.durationMinutes !== undefined &&
        item.endMinute - item.startMinute <
          transport.durationMinutes +
            transport.accessMinutes +
            transport.bufferMinutes +
            transport.egressMinutes
      )
        add(
          'TRANSPORT_DURATION_TOO_SHORT',
          '日程没有保留真实班次与接驳缓冲所需时长',
          'error',
          item.id,
          day.date,
        );
      if (transport?.availability === 'unavailable')
        add('TRANSPORT_UNAVAILABLE', '所选交通目前不可用', 'error', item.id, day.date);
      if (transport?.availability === 'unknown')
        add('TRANSPORT_AVAILABILITY_UNKNOWN', '所选交通库存尚未确认', 'warning', item.id, day.date);
      if (experience) {
        /** 查到景点不代表免费；需明确门票报价、0元确认或覆盖门票的包价。 */
        if (experience.kind === 'attraction' && !experience.quote && !covered.has('ticket'))
          add(
            'ACTIVITY_PRICE_UNKNOWN',
            '景点门票尚未明确，不能自动视为免费',
            'warning',
            item.id,
            day.date,
          );
        if (
          experience.point &&
          item.point &&
          distanceLowerBound(experience.point, item.point) > 100
        )
          add('POINT_MISMATCH', '活动坐标与保存地点不一致', 'error', item.id, day.date);
        if (experience.closedDates.includes(day.date))
          add('CLOSED_DATE', '所选地点当天闭园或不营业', 'error', item.id, day.date);
        if (experience.reservation === 'required' && item.reservationConfirmed !== true)
          add(
            'RESERVATION_REQUIRED',
            '预约尚未确认，当前方案不能等同已预约',
            'warning',
            item.id,
            day.date,
          );
        if (request.mobility === 'wheelchair') {
          if (experience.accessible === false)
            add(
              'ACCESSIBILITY_CONFLICT',
              '地点不满足已确认的轮椅通行要求',
              'error',
              item.id,
              day.date,
            );
          else if (experience.accessible === null)
            add('ACCESSIBILITY_UNKNOWN', '尚未核实无障碍条件', 'warning', item.id, day.date);
        }
        if (experience.kind !== 'hotel') {
          const weekday = new Date(`${day.date}T00:00:00Z`).getUTCDay();
          const windows = experience.opening.filter((window) => window.dayOfWeek === weekday);
          if (!windows.length)
            add('OPENING_UNKNOWN', '当天开放时间尚未核实', 'warning', item.id, day.date);
          else if (
            !windows.some((window) => {
              const open = minute(window.open);
              const close = minute(window.close);
              return (
                open !== null &&
                close !== null &&
                item.startMinute >= open &&
                item.endMinute <= close
              );
            })
          )
            add('OUTSIDE_OPENING', '活动未完整处在确认的开放时段内', 'error', item.id, day.date);
        }
      } else if (item.kind === 'visit' || item.kind === 'meal' || item.kind === 'hotel')
        add(
          'UNVERIFIED_ACTIVITY',
          '此活动尚未绑定核实后的地点或产品',
          'warning',
          item.id,
          day.date,
        );
      previous = item;
    }
    /** 老人、儿童与步行驾驶限制通过真实分钟累加，不由模型宣告“轻松”。 */
    if (request.maxWalkMinutes !== null && walk > request.maxWalkMinutes)
      add('WALK_LIMIT', '当天步行超过用户上限', 'error', null, day.date);
    if (request.maxDriveMinutes !== null && drive > request.maxDriveMinutes)
      add('DRIVE_LIMIT', '当天驾驶超过用户上限', 'error', null, day.date);
    if (drive > 120 && rests < 20)
      add('MISSING_DRIVING_REST', '长时间驾驶尚未安排足够休息', 'warning', null, day.date);
    if ((request.seniors ?? 0) > 0 && walk > 180)
      add('SENIOR_PACE', '当天步行较多，请结合老人实际能力确认节奏', 'warning', null, day.date);
    if ((request.children ?? 0) > 0 && request.childAges.length < request.children!)
      add('CHILD_POLICY_UNKNOWN', '儿童年龄或票种条件尚未完整确认', 'warning', null, day.date);
    /** 空白天可以保存草案，但不能标成完整可执行行程。 */
    if (!day.items.length) add('EMPTY_DAY', '这一天尚未安排活动', 'warning', null, day.date);
  }
  return issues.slice(0, 300);
}
