/** 授权供应商HTTP接入；没有授权时明确不可用，不使用演示库存。 */
import {
  BadGatewayException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
/** 部署配置只在后端注入。 */
import { AppConfig } from '../../config/config.module.js';
/** HTTP客户端注入令牌允许协议fixture替换，不向浏览器开放任意URL。 */
export const SUPPLIER_FETCH = Symbol('SUPPLIER_FETCH');
/** 令牌只存内存并有到期时间，不落库、不进入日志或公开状态。 */
@Injectable()
export class SupplierService {
  /** OAuth缓存不按用户无限增长，只有一个部署级供应商账户。 */
  private access?: { token: string; expiresAt: number };
  private pending?: Promise<string>;
  /** 原生fetch可由Nest测试注入本机协议适配器。 */
  constructor(
    private readonly config: AppConfig,
    @Inject(SUPPLIER_FETCH) private readonly fetcher: typeof fetch,
  ) {}
  /** 状态只报告配置与环境，test绝不等同生产可预订库存。 */
  status() {
    const e = this.config.env;
    return [
      {
        id: 'amadeus',
        modules: [8, 10],
        configured: Boolean(e.AMADEUS_CLIENT_ID && e.AMADEUS_CLIENT_SECRET),
        environment: e.AMADEUS_ENV,
      },
      {
        id: 'tour_gateway',
        modules: [11],
        configured: Boolean(e.TOUR_GATEWAY_URL && e.TOUR_GATEWAY_KEY),
        environment: 'contract-v1',
      },
    ];
  }
  /** 固定两种官方域名，不能从用户消息拼出其他主机。 */
  private origin() {
    return this.config.env.AMADEUS_ENV === 'production'
      ? 'https://api.amadeus.com'
      : 'https://test.api.amadeus.com';
  }
  /** 独立短超时、取消传播、大小限制和拒绝重定向保护实际网络调用。 */
  private async json(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Record<string, any>> {
    const response = await this.fetcher(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.env.SUPPLIER_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new BadGatewayException('授权供应商拒绝查询，请核对权限、配额或条件');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('供应商没有返回数据');
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 512000) throw new BadGatewayException('供应商结果超出体积限制');
        chunks.push(part.value);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data as Record<string, any>;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('供应商数据格式不被支持');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  /** OAuth合并并发请求；某个用户取消不应中断其他用户共用的认证握手。 */
  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt > Date.now() + 30000) return this.access.token;
    if (this.pending) return this.pending;
    const e = this.config.env;
    if (!e.AMADEUS_CLIENT_ID || !e.AMADEUS_CLIENT_SECRET)
      throw new ServiceUnavailableException('Amadeus授权接口未配置；当前不提供航班/酒店实时库存');
    this.pending = (async () => {
      const data = await this.json(
        `${this.origin()}/v1/security/oauth2/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: e.AMADEUS_CLIENT_ID,
            client_secret: e.AMADEUS_CLIENT_SECRET,
          }),
        },
        AbortSignal.timeout(e.SUPPLIER_TIMEOUT_MS),
      );
      if (typeof data.access_token !== 'string' || !Number.isFinite(Number(data.expires_in)))
        throw new BadGatewayException('供应商认证失败');
      this.access = {
        token: data.access_token,
        expiresAt: Date.now() + Number(data.expires_in) * 1000,
      };
      return this.access.token;
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  /** 对外只允许查询API路径，不提供订票、支付或乘客操作。 */
  async amadeus(
    path:
      | '/v2/shopping/flight-offers'
      | '/v1/reference-data/locations/hotels/by-city'
      | '/v3/shopping/hotel-offers',
    params: Record<string, string>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const token = await this.token();
    signal.throwIfAborted();
    try {
      return await this.json(
        `${this.origin()}${path}?${new URLSearchParams(params)}`,
        { headers: { Authorization: `Bearer ${token}` } },
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('供应商网络不可用或已超时');
    }
  }
  /** 团网关仅发送结构化旅行条件，不发送账户、Cookie、密钥或聊天历史。 */
  async tours(request: unknown, signal: AbortSignal) {
    const e = this.config.env;
    if (!e.TOUR_GATEWAY_URL || !e.TOUR_GATEWAY_KEY)
      throw new ServiceUnavailableException('旅行团授权供应商未配置；可先录入有来源的产品条款');
    try {
      return await this.json(
        `${e.TOUR_GATEWAY_URL.replace(/\/$/, '')}/v1/tours/search`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${e.TOUR_GATEWAY_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('旅行团供应商查询超时或不可用');
    }
  }
}
