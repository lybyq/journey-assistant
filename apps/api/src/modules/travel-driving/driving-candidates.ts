/** 驾车字段解析兼容MCP旧格式和Web路径2.0；缺失与明确零值严格区分。 */
import type { GeoPoint } from '@journey/contracts';
import { asRecord, asRecords } from '../travel/travel-mcp.service.js';
import { decimalMinor } from '../travel-pricing/pricing.service.js';
/** 收费单位为元，进入业务统一转换为整数分；非法或缺失不补零。 */
export function routeTollMinor(path: Record<string, any>): number | null {
  const value = asRecord(path.cost).tolls ?? path.tolls;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  return decimalMinor(text, 'CNY');
}
/** 未提供的数值保留null，不能用Number('')误读为0。 */
function metric(value: unknown): number | null {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '')
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}
/** 仅保留真正返回的折线；没有时显示示意，不能伪造道路形状。 */
export function routeGeometry(path: Record<string, any>): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const step of asRecords(path.steps))
    for (const coordinate of String(step.polyline ?? '').split(';')) {
      const parts = coordinate.split(',');
      if (parts.length !== 2 || !parts.every((part) => part.trim())) continue;
      const [lng, lat] = parts.map(Number);
      if (
        Number.isFinite(lng) &&
        Number.isFinite(lat) &&
        Math.abs(lng!) <= 180 &&
        Math.abs(lat!) <= 90
      )
        points.push({ lng: lng!, lat: lat!, coordinateSystem: 'GCJ-02' });
      if (points.length >= 1500) return points;
    }
  return points;
}
/** 返回真实候选而非把同一路线改三个标题；无法识别距离/耗时的记录不进入比较。 */
export function drivingCandidates(paths: Record<string, any>[]) {
  const seen = new Set<string>();
  return paths
    .flatMap((path, index) => {
      const cost = asRecord(path.cost),
        distance = metric(path.distance),
        seconds = metric(cost.duration ?? path.duration);
      if (distance === null || seconds === null) return [];
      const points = routeGeometry(path),
        toll = routeTollMinor(path);
      /** 同一道路折线不能仅因动态耗时变化就被算作另一条路线。 */
      const signature = JSON.stringify(
        points.length ? { distance, points } : { distance, seconds, toll },
      );
      if (seen.has(signature)) return [];
      seen.add(signature);
      const strategy = ['recommended', 'less_tolls', 'fastest', 'provider_alternative'].includes(
        path.planningStrategy,
      )
        ? path.planningStrategy
        : index === 0
          ? 'recommended'
          : 'provider_alternative';
      return [
        {
          strategy: strategy as 'recommended' | 'less_tolls' | 'fastest' | 'provider_alternative',
          distance,
          minutes: Math.ceil(seconds / 60),
          toll,
          tollDistance: metric(cost.toll_distance ?? path.toll_distance),
          trafficLights: metric(cost.traffic_lights ?? path.traffic_lights),
          points,
        },
      ];
    })
    .slice(0, 3);
}
