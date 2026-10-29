/** 日期、人数和预算规范化是独立领域逻辑，不依赖模型。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 需求契约对所有来源执行同一套校验。 */
import {
  tripRequestSchema,
  tripRequestPatchSchema,
  type TripRequest,
  type TripRequestPatch,
} from '@journey/contracts';
/** 解析支持日常中文数量，不接受无限制的模糊人数。 */
export function chineseNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [a, b] = value.split('十');
    return (a ? (digits[a] ?? 0) : 1) * 10 + (b ? (digits[b] ?? 0) : 0);
  }
  return digits[value] ?? NaN;
}
/** UTC仅用于日历加减；日期本身始终由目标时区先确定。 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
/** 当前日期明确采用上海，而不是宿主机器默认时区。 */
export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
/** 纯提取器只输出能够从文字确认的候选，未知字段不补造。 */
@Injectable()
export class TripRequestService {
  /** 合并PATCH后校验日期、晚数、儿童年龄与预算范围的一致性。 */
  normalize(patch: TripRequestPatch, base: TripRequest = tripRequestSchema.parse({})): TripRequest {
    /** 显式null允许用户清除条件；只有undefined表示沿用旧字段。 */
    const checked = tripRequestPatchSchema.safeParse(patch);
    if (!checked.success)
      throw new BadRequestException(checked.error.issues[0]?.message ?? '需求字段不合法');
    const merged = { ...base, ...checked.data };
    /** 修改起日或天数时派生止日；显式同时给出冲突条件则拒绝。 */
    if (merged.startDate && merged.days && (!('endDate' in patch) || patch.endDate === null))
      merged.endDate = addDays(merged.startDate, merged.days - 1);
    /** 起止日期齐全时校验包含首尾的实际天数。 */
    if (merged.startDate && merged.endDate) {
      const days =
        Math.round((Date.parse(merged.endDate) - Date.parse(merged.startDate)) / 86400000) + 1;
      if (days < 1 || days > 30) throw new BadRequestException('旅行日期范围必须为1～30天');
      if (patch.days !== undefined && patch.days !== null && days !== patch.days)
        throw new BadRequestException('日期范围与旅行天数不一致');
      merged.days = days;
    }
    /** 三天两晚是常见住宿口径；用户明确填写的晚数不能超过行程长度。 */
    if (merged.days && (merged.nights === null || ('days' in patch && !('nights' in patch))))
      merged.nights = Math.max(0, merged.days - 1);
    /** 跨字段限制不能只依赖每个字段自己的最大值。 */
    if (merged.nights !== null && merged.days !== null && merged.nights >= merged.days)
      throw new BadRequestException('住宿晚数必须少于旅行天数');
    /** 儿童可先只报数量；已填年龄数不能超过儿童数。 */
    if (merged.children !== null && merged.childAges.length > merged.children)
      throw new BadRequestException('儿童年龄条数超过儿童人数');
    /** 老人是成人子集，不能额外重复加到总人数里。 */
    if (merged.seniors !== null && merged.adults !== null && merged.seniors > merged.adults)
      throw new BadRequestException('老人数量不能超过成人数量');
    /** 完整契约还会拒绝不存在的日历日期和非法时区。 */
    const parsed = tripRequestSchema.safeParse(merged);
    if (!parsed.success)
      throw new BadRequestException(parsed.error.issues[0]?.message ?? '旅行需求不合法');
    return parsed.data;
  }
  /** 提取常见中文表达，复杂描述仍可由模型通过受校验PATCH工具补充。 */
  extract(text: string, now = new Date()): TripRequestPatch {
    /** 只声明候选，避免把默认值当作用户已经确认的事实。 */
    const patch: TripRequestPatch = {};
    const number = '([零一二两三四五六七八九十\\d]+)';
    /** 两大一小、2位成人、1名儿童都映射为明确字段。 */
    const adults = new RegExp(`${number}\\s*(?:大(?:人)?|(?:位|名|个)?成人)`).exec(text);
    const children = new RegExp(`${number}\\s*(?:小(?:孩)?|(?:位|名|个)?儿童)`).exec(text);
    if (adults) patch.adults = chineseNumber(adults[1]!);
    if (children) patch.children = chineseNumber(children[1]!);
    /** 成人儿童未拆分的“共3人”不能猜成3成人，只留给澄清流程。 */
    const days = new RegExp(`${number}\\s*(?:天|日游)`).exec(text);
    const nights = new RegExp(`${number}\\s*晚`).exec(text);
    if (days) patch.days = chineseNumber(days[1]!);
    if (nights) patch.nights = chineseNumber(nights[1]!);
    /** 日期识别先接受明确ISO，再处理上海日历中的明天、后天和下周。 */
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/g);
    if (iso?.[0]) patch.startDate = iso[0];
    if (iso?.[1]) patch.endDate = iso[1];
    const today = shanghaiDate(now);
    if (!patch.startDate) {
      if (text.includes('后天')) patch.startDate = addDays(today, 2);
      else if (text.includes('明天')) patch.startDate = addDays(today, 1);
      else if (text.includes('今天')) patch.startDate = today;
      else {
        const week = /下周([一二三四五六日天])/.exec(text);
        if (week) {
          const target = '一二三四五六日'.indexOf(week[1] === '天' ? '日' : week[1]!) + 1;
          const current = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
          patch.startDate = addDays(today, 7 - current + target);
        }
      }
    }
    /** 地点仅接受“从A出发到B/从A去B”，不按含混句子猜测出发地。 */
    const route =
      /从\s*([^，。\s]{1,20}?)(?:出发)?\s*(?:去|到|前往)\s*([^，。\s\d]{1,20}?)(?=旅游|旅行|游玩|玩|自驾|自由行|跟团|[，。\s]|$)/.exec(
        text,
      );
    if (route) {
      patch.origin = route[1]!;
      patch.destination = route[2]!;
    } else {
      const origin = /从([^，。\s]{1,20}?)出发/.exec(text);
      if (origin) patch.origin = origin[1]!;
    }
    /** 金额以小数文本转分，避免0.1+0.2式浮点误差；本提取器只处理人民币。 */
    const budget =
      /(?:人均(?:预算)?|总预算|预算)\s*(\d+(?:\.\d{1,2})?)(?:\s*[-～到至]\s*(\d+(?:\.\d{1,2})?))?\s*(万)?\s*(?:元|块)?/.exec(
        text,
      );
    if (budget) {
      const toMinor = (s: string) => {
        const [whole, fraction = ''] = s.split('.');
        return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      };
      const a = toMinor(budget[1]!) * (budget[3] ? 10000 : 1);
      const b = budget[2] ? toMinor(budget[2]) * (budget[3] ? 10000 : 1) : a;
      patch.budget = {
        currency: 'CNY',
        scope: budget[0].startsWith('人均') ? 'per_person' : 'total',
        minMinor: a,
        maxMinor: b,
      };
    }
    /** 出行方式只有用户明确表达时才保存。 */
    if (text.includes('自驾')) patch.mode = 'driving';
    else if (text.includes('跟团') || text.includes('旅行团')) patch.mode = 'group';
    else if (text.includes('自由行')) patch.mode = 'independent';
    /** 房间、车辆与儿童年龄的提取均保留明确数量。 */
    const rooms = new RegExp(`${number}\\s*间(?:房)?`).exec(text);
    const cars = new RegExp(`${number}\\s*(?:辆|台)车`).exec(text);
    if (rooms) patch.rooms = chineseNumber(rooms[1]!);
    if (cars) patch.vehicles = chineseNumber(cars[1]!);
    const ages = [...text.matchAll(/(?:儿童|孩子|小孩)?\s*(\d{1,2})岁/g)].map((match) =>
      Number(match[1]),
    );
    if (ages.length) patch.childAges = ages;
    /** 只提取结构，调用normalize时才与既有需求合并。 */
    return patch;
  }
  /** 关键缺失项有固定问题，前端与智能体使用同一份澄清清单。 */
  clarifications(request: TripRequest) {
    /** 核心条件没有确认前，不能声称生成了可预订完整方案。 */
    const fields: [keyof TripRequest, string, boolean][] = [
      ['origin', '从哪个城市出发？', true],
      ['destination', '想去哪个城市或目的地？', true],
      ['startDate', '哪天出发？请确认具体日期。', true],
      ['days', '计划旅行几天、住几晚？', true],
      ['adults', '有几位成人？', true],
      ['children', '有几位儿童？没有请填0。', true],
      ['mode', '自由行、自驾还是跟团？', true],
      ['destinationTimeZone', '目的地当地时区是什么？国内填写Asia/Shanghai。', true],
      ['rooms', '需要几间房？', false],
    ];
    /** null和空地名均视为未知，不能用布尔短路把0儿童误判成缺失。 */
    const missing = fields
      .filter(([field]) => request[field] === null || request[field] === '')
      .map(([field, question, required]) => ({ field, question, required }));
    /** 人均预算需要明确成人加儿童总人数后才能换算总预算。 */
    if (request.budget.maxMinor === null)
      missing.push({
        field: 'budget',
        question: '预算上限是多少，是全程总预算还是每人预算？',
        required: true,
      });
    if (request.children !== null && request.childAges.length < request.children)
      missing.push({
        field: 'childAges',
        question: '请补充每位儿童年龄，用于核对交通票种与加床条件。',
        required: false,
      });
    return missing;
  }
}
