/** 高德正式Web路线查询补足MCP未公开的算路策略和费用字段。 */
import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
/** 密钥仅从服务端配置取得，永不回传认证URL。 */
import { AppConfig } from '../../config/config.module.js';
/** 复用可替换HTTP传输，测试不访问真实供应商。 */
import { SUPPLIER_FETCH } from '../travel-suppliers/supplier.service.js';
import type { GeoPoint } from '@journey/contracts';
import { asRecord, asRecords } from '../travel/travel-mcp.service.js';
/** 策略名称来自正式驾车路径2.0文档，不随模型输入扩权。 */
const policies = [
  { code: '32', name: '高德推荐', strategy: 'recommended' },
  { code: '36', name: '少收费', strategy: 'less_tolls' },
  { code: '38', name: '速度优先', strategy: 'fastest' },
] as const;
@Injectable()
export class AmapDrivingClient {
  /** HTTP注入与其他供应商遵循同一测试边界。 */
  constructor(
    private readonly config: AppConfig,
    @Inject(SUPPLIER_FETCH) private readonly fetcher: typeof fetch,
  ) {}
  /** MCP官方Key本身为Web服务类型；另配Web Key时优先使用独立凭证。 */
  get configured() {
    return Boolean(this.config.env.AMAP_WEB_SERVICE_API_KEY || this.config.env.AMAP_MAPS_API_KEY);
  }
  /** 三个策略顺序请求，避免同时突发占用个人Key的QPS；最多保留九条原始候选。 */
  async compare(origin: GeoPoint, destination: GeoPoint, signal: AbortSignal) {
    const groups: { paths: Record<string, any>[]; strategy: string }[] = [];
    const warnings: string[] = [];
    for (const policy of policies) {
      signal.throwIfAborted();
      try {
        const url = new URL('https://restapi.amap.com/v5/direction/driving');
        url.search = new URLSearchParams({
          key: this.config.env.AMAP_WEB_SERVICE_API_KEY || this.config.env.AMAP_MAPS_API_KEY,
          origin: `${origin.lng.toFixed(6)},${origin.lat.toFixed(6)}`,
          destination: `${destination.lng.toFixed(6)},${destination.lat.toFixed(6)}`,
          strategy: policy.code,
          show_fields: 'cost,polyline',
          output: 'json',
        }).toString();
        const response = await this.fetcher(url, {
          redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new BadGatewayException('高德路线服务拒绝查询，请核对权限或配额');
        }
        const reader = response.body?.getReader();
        if (!reader) throw new BadGatewayException('高德路线未返回数据');
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > 512000) throw new BadGatewayException('高德路线数据超出处理范围');
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
        const data = asRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (data.status !== '1')
          throw new BadGatewayException('高德路线服务未授权、配额不足或未返回结果');
        const paths = asRecords(asRecord(data.route).paths).slice(0, 3);
        if (paths.length) groups.push({ paths, strategy: policy.strategy });
        else warnings.push(`${policy.name}未返回可用路线`);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        warnings.push(`${policy.name}暂不可用，未取得该策略结果`);
      }
    }
    if (!groups.length) throw new BadGatewayException('高德Web路线查询不可用');
    /** 每个策略先保留第一条，再补确有差异的供应商备选；下游负责实际路线去重。 */
    return {
      paths: [
        ...groups.map((group) => ({ ...group.paths[0], planningStrategy: group.strategy })),
        ...groups.flatMap((group) =>
          group.paths
            .slice(1)
            .map((path) => ({ ...path, planningStrategy: 'provider_alternative' })),
        ),
      ],
      warnings,
      source: 'amap_web' as const,
    };
  }
}
