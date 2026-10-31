/** 真实高德路线与确定性车辆费用，车辆总费和人均费用严格分开。 */
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
/** 路线和费用ID由服务端生成，不能把模型编造ID当作证据。 */
import { AmapDrivingClient } from './amap-driving.client.js';
import { drivingCandidates, routeTollMinor } from './driving-candidates.js';
import { randomUUID } from 'node:crypto';
/** 入参、结果和费用都经过共享契约。 */
import {
  drivingInputSchema,
  drivingRouteSchema,
  type CostItem,
  type DrivingRoute,
  type GeoPoint,
} from '@journey/contracts';
/** 复用预算计算的整数除法和口径生成。 */
import { requestConditions, roundedDivide } from '../travel-pricing/pricing.service.js';
/** 归属校验在任何外部消耗之前执行。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 真实地图查询统一通过MCP工具中心的受限连接。 */
import { TravelMcpService, asRecord, asRecords } from '../travel/travel-mcp.service.js';
/** 里程×百公里消耗×单位价格；三位小数消耗先转为千分整数。 */
export function energyCostMinor(
  distanceMeters: number,
  consumption: string,
  unitPriceMinor: number,
): number {
  const [whole, fraction = ''] = consumption.split('.');
  const scaled = BigInt(whole!) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return Number(
    roundedDivide(BigInt(distanceMeters) * scaled * BigInt(unitPriceMinor), 100000000n),
  );
}
/** 路线结果保留实际路径和所有估算假设。 */
@Injectable()
export class DrivingService {
  /** 外部路线与持久化分别注入，便于真实协议fixture验收。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly mcp: TravelMcpService,
    @Optional() private readonly webRoutes?: AmapDrivingClient,
  ) {}
  /** 未提供车辆能耗时先保存真实路线，所有费用保持未知，不能以零元假设启动成本计算。 */
  async preview(
    userId: string,
    id: string,
    revision: number,
    origin: GeoPoint,
    destination: GeoPoint,
    signal: AbortSignal,
  ) {
    return this.compareAndSave(userId, id, revision, origin, destination, signal);
  }
  /** 来源查询与费用构造分开；有Web权限时取得三种策略，否则保留MCP实际备选。 */
  private async compareAndSave(
    userId: string,
    id: string,
    revision: number,
    origin: GeoPoint,
    destination: GeoPoint,
    signal: AbortSignal,
    input?: ReturnType<typeof drivingInputSchema.parse>,
  ) {
    const workspace = await this.repository.get(userId, id),
      request = workspace.document.request;
    if (workspace.revision !== revision) throw new BadRequestException('项目已变化，请刷新');
    if (request.vehicles === null) throw new BadRequestException('请先确认车辆数量');
    const vehicles = request.vehicles,
      warnings: string[] = [];
    let paths: Record<string, any>[] = [];
    let source: 'amap_web' | 'amap_mcp' = 'amap_mcp';
    if (this.webRoutes?.configured) {
      try {
        const result = await this.webRoutes.compare(origin, destination, signal);
        paths = result.paths;
        source = result.source;
        warnings.push(...result.warnings);
      } catch (error) {
        if (signal.aborted) throw error;
        warnings.push('Web策略查询暂不可用，使用MCP已返回路线；未返回的策略不做成功承诺。');
      }
    }
    if (!paths.length) {
      const call = await this.mcp.session(signal);
      const raw = asRecord(
        await call('amap__maps_direction_driving', {
          origin: origin.lng + ',' + origin.lat,
          destination: destination.lng + ',' + destination.lat,
        }),
      );
      paths = asRecords(asRecord(raw.route ?? asRecord(raw.data).route ?? raw).paths);
    }
    const candidates = drivingCandidates(paths);
    if (!candidates.length) throw new BadRequestException('高德未返回有效自驾距离或时间');
    const groupId = randomUUID(),
      now = new Date().toISOString();
    const routes = candidates.map((candidate) => {
      const routeId = randomUUID();
      const restEvery = input?.restEveryMinutes ?? 120,
        restEach = input?.restMinutes ?? 20;
      const rest = Math.max(0, Math.ceil(candidate.minutes / restEvery) - 1) * restEach;
      const energy = input
        ? energyCostMinor(candidate.distance, input.consumptionPer100, input.energyUnitPriceMinor)
        : null;
      const toll = input?.tollMinor ?? candidate.toll;
      const values: [string, string, number | null][] = [
        ['能源费', 'energy', energy],
        ['过路费', 'toll', toll],
        ['停车费', 'parking', input?.parkingMinor ?? null],
        ['租车费', 'rental', input?.rentalMinor ?? null],
        ['车辆保险', 'insurance', input?.insuranceMinor ?? null],
      ];
      const costs: CostItem[] = values.map(([label, key, amount]) => ({
        id: randomUUID(),
        label,
        category: 'driving',
        scopeKey: 'driving:' + routeId + ':' + key,
        priceType: amount === null ? 'unknown' : 'estimate',
        unitAmountMinor: amount,
        currency: 'CNY',
        quantity: vehicles,
        unit: 'vehicle',
        required: true,
        selected: true,
        includes: [],
        provenance: 'calculation',
        provider:
          key === 'toll' && input?.tollMinor == null
            ? '高德路线收费估算'
            : '高德路线 + 用户费用假设',
        sourceUrl:
          key === 'toll' && input?.tollMinor == null
            ? 'https://developer.amap.com/api/webservice/guide/api/newroute'
            : null,
        evidenceIds: [],
        checkedAt: now,
        validUntil: null,
        conditions: requestConditions(request),
        notes:
          key === 'toll'
            ? input?.tollMinor != null
              ? '采用用户明确输入的每车单程路费。'
              : '高德返回的每车单程收费估算；节假日、车型、ETC优惠及出发日最终收费需核实。'
            : key === 'energy' && input
              ? '里程' +
                candidate.distance +
                '米；百公里消耗' +
                input.consumptionPer100 +
                '；单价来源：' +
                input.energyPriceSource
              : '每辆车单程费用；没有数据保持未知，不补零。',
      }));
      const unknown = costs
        .filter((cost) => cost.unitAmountMinor === null)
        .map((cost) => cost.label);
      const known = costs.reduce(
        (sum, cost) => sum + (cost.unitAmountMinor ?? 0) * cost.quantity,
        0,
      );
      const people =
        request.adults !== null && request.children !== null
          ? request.adults + request.children
          : null;
      return drivingRouteSchema.parse({
        id: routeId,
        comparisonGroupId: groupId,
        queryOrigin: request.origin,
        queryDestination: request.destination,
        strategy: candidate.strategy,
        source,
        tollMinor: toll,
        tollSource:
          input?.tollMinor != null
            ? 'user_assumption'
            : candidate.toll === null
              ? 'unknown'
              : 'amap_estimate',
        tollDistanceMeters: candidate.tollDistance,
        trafficLights: candidate.trafficLights,
        tripScope: 'one_way',
        origin,
        destination,
        waypoints: [],
        distanceMeters: candidate.distance,
        driveMinutes: candidate.minutes,
        restMinutes: rest,
        chargingMinutes: input?.chargingMinutes ?? 0,
        totalMinutes: candidate.minutes + rest + (input?.chargingMinutes ?? 0),
        energyMinor: energy === null ? null : energy * vehicles,
        knownVehicleMinor: known,
        unknownCosts: unknown,
        perPersonMinor: people && unknown.length === 0 ? Math.ceil(known / people) : null,
        checkedAt: now,
        assumptions: [
          input
            ? '起终点按用户提交的精确坐标计算。'
            : '起终点为用户城市地理编码中心，非精确门到门地址。',
          vehicles +
            '辆车；每驾驶' +
            restEvery +
            '分钟预留' +
            restEach +
            '分钟休息；当前仅比较单程。',
          input ? '能源费采用用户确认的百公里消耗和单价。' : '未提供能耗和单价，能源费用未知。',
        ],
        warnings: [
          ...warnings,
          '收费和路况是查询时参考，不保证未来出发日；往返及市内费用需要另行计算。',
          ...(!candidate.points.length ? ['未返回完整道路折线，地图只显示点位示意。'] : []),
          ...(request.maxDriveMinutes !== null && candidate.minutes > request.maxDriveMinutes
            ? ['驾驶时长超过已设每日上限，需要拆天。']
            : []),
          ...(input?.energy === 'electric' && input.chargingMinutes === 0
            ? ['电动车充电安排尚需核实。']
            : []),
        ],
        path: candidate.points,
        costs,
      });
    });
    signal.throwIfAborted();
    return this.repository.mutate(userId, id, revision, (doc) => {
      doc.driving.push(...routes);
      doc.costs.push(...routes.flatMap((route) => route.costs));
      return doc;
    });
  }
  /** 每条途经路段单独查询，调用次数被最多5个途经点硬限制。 */
  async query(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof drivingInputSchema.parse>,
    signal: AbortSignal,
  ) {
    /** 无途经点时使用同一多策略比较入口，避免表单查询退回到单路线。 */
    if (!input.waypoints.length)
      return this.compareAndSave(
        userId,
        id,
        revision,
        input.origin,
        input.destination,
        signal,
        input,
      );
    /** 人数、车辆和驾驶限制使用已保存需求，不把未知人数默认为1。 */
    const workspace = await this.repository.get(userId, id);
    const request = workspace.document.request;
    if (workspace.revision !== revision) throw new BadRequestException('项目已变化，请刷新');
    if (request.vehicles === null) throw new BadRequestException('请先确认车辆数量');
    /** 工具会话共用取消信号，停止网页操作会取消真实请求。 */
    const call = await this.mcp.session(signal);
    const points = [input.origin, ...input.waypoints, input.destination];
    let distance = 0;
    let duration = 0;
    let returnedTolls: number | null = 0;
    const path: GeoPoint[] = [];
    const warnings: string[] = [];
    /** 逐段查询避免错误假设供应商支持任意途经点参数。 */
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const data = asRecord(
        await call('amap__maps_direction_driving', {
          origin: `${from.lng},${from.lat}`,
          destination: `${to.lng},${to.lat}`,
        }),
      );
      const route = asRecord(data.route ?? data);
      const first = asRecords(route.paths)[0];
      if (!first) throw new BadRequestException('高德未返回可用驾驶路线');
      const meters = Number(first.distance);
      const seconds = Number(first.duration ?? asRecord(first.cost).duration);
      if (!Number.isFinite(meters) || meters < 0 || !Number.isFinite(seconds) || seconds < 0)
        throw new BadRequestException('供应商路线缺少有效距离或耗时');
      const legToll = routeTollMinor(first);
      returnedTolls = returnedTolls === null || legToll === null ? null : returnedTolls + legToll;
      distance += Math.round(meters);
      duration += Math.ceil(seconds / 60);
      let found = false;
      for (const step of asRecords(first.steps)) {
        for (const coordinate of String(step.polyline ?? '').split(';')) {
          const [lng, lat] = coordinate.split(',').map(Number);
          if (
            Number.isFinite(lng) &&
            Number.isFinite(lat) &&
            Math.abs(lng!) <= 180 &&
            Math.abs(lat!) <= 90 &&
            path.length < 1500
          ) {
            path.push({ lng: lng!, lat: lat!, coordinateSystem: 'GCJ-02' });
            found = true;
          }
        }
      }
      if (!found) {
        path.push(from, to);
        warnings.push('供应商未提供完整折线，该路段地图仅示意起终点');
      }
    }
    /** 一天的疲劳驾驶限制不能靠拆分路段绕过。 */
    const restCount = Math.max(0, Math.ceil(duration / input.restEveryMinutes) - 1);
    const rest = restCount * input.restMinutes;
    const energy = energyCostMinor(distance, input.consumptionPer100, input.energyUnitPriceMinor);
    const vehicles = request.vehicles;
    const now = new Date().toISOString();
    const routeId = randomUUID();
    const unknown: string[] = [];
    /** 过路费、停车、租车和保险未知时不默认为0；能源费始终明确为估算。 */
    const values: [string, string, number | null][] = [
      ['能源费', 'energy', energy],
      ['过路费', 'toll', input.tollMinor ?? returnedTolls],
      ['停车费', 'parking', input.parkingMinor],
      ['租车费', 'rental', input.rentalMinor],
      ['车辆保险', 'insurance', input.insuranceMinor],
    ];
    const costs: CostItem[] = values.map(([label, key, amount]) => {
      if (amount === null) unknown.push(label);
      return {
        id: randomUUID(),
        label,
        category: 'driving',
        scopeKey: `driving:${routeId}:${key}`,
        priceType: amount === null ? 'unknown' : 'estimate',
        unitAmountMinor: amount,
        currency: 'CNY',
        quantity: vehicles,
        unit: 'vehicle',
        required: true,
        selected: true,
        includes: [],
        provenance: 'calculation',
        provider: '高德路线 + 用户确认单价',
        sourceUrl: null,
        evidenceIds: [],
        checkedAt: now,
        validUntil: null,
        conditions: requestConditions(request),
        notes:
          key === 'energy'
            ? `里程${distance}米；百公里消耗${input.consumptionPer100}；单价来源：${input.energyPriceSource}`
            : '每辆车全程金额；0代表用户明确确认无需该费用，null代表未知',
      };
    });
    /** 不宣称估算费用是供应商实时报价，已知车辆费按车辆数再乘一次。 */
    const known = costs.reduce((sum, item) => sum + (item.unitAmountMinor ?? 0) * item.quantity, 0);
    const people =
      request.adults !== null && request.children !== null
        ? request.adults + request.children
        : null;
    if (request.maxDriveMinutes !== null && duration > request.maxDriveMinutes)
      warnings.push('路线驾驶时长超过已设每日上限，生成行程时需要拆天');
    if (input.energy === 'electric' && input.chargingMinutes === 0)
      warnings.push('电动车尚未安排充电时长，需要核实续航与充电站');
    /** 任何路线是否可行，仍需行程版本结合每日其他活动再次验证。 */
    const result: DrivingRoute = drivingRouteSchema.parse({
      id: routeId,
      origin: input.origin,
      destination: input.destination,
      waypoints: input.waypoints,
      distanceMeters: distance,
      driveMinutes: duration,
      restMinutes: rest,
      chargingMinutes: input.chargingMinutes,
      totalMinutes: duration + rest + input.chargingMinutes,
      tollMinor: input.tollMinor ?? returnedTolls,
      tripScope: 'one_way',
      source: 'amap_mcp',
      energyMinor: energy * vehicles,
      knownVehicleMinor: known,
      unknownCosts: unknown,
      perPersonMinor: people && unknown.length === 0 ? Math.ceil(known / people) : null,
      checkedAt: now,
      assumptions: [
        `百公里消耗${input.consumptionPer100}${input.energy === 'fuel' ? '升' : '度'}`,
        `单价${input.energyUnitPriceMinor}分/${input.energy === 'fuel' ? '升' : '度'}；${input.energyPriceSource}`,
        `${vehicles}辆车；每驾驶${input.restEveryMinutes}分钟休息${input.restMinutes}分钟`,
      ],
      warnings: [...new Set(warnings)],
      path: path.slice(0, 1500),
      costs,
    });
    return this.repository.mutate(userId, id, revision, (document) => {
      document.driving.push(result);
      document.costs.push(...costs);
      return document;
    });
  }
}
