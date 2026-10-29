/** 外部业务查询共享限流、并发、取消和可观测记录。 */
import { HttpException, Injectable, Logger } from '@nestjs/common';
/** 随机操作ID用于有界并发槽位，不保存用户提示词。 */
import { randomUUID } from 'node:crypto';
/** 复用真实Redis和PostgreSQL，不引入进程内假限流。 */
import { StorageService } from '../../storage/storage.module.js';
/** Redis命名空间由部署配置隔离。 */
import { AppConfig } from '../../config/config.module.js';
/** 查询归属先于供应商消耗。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 同一用户最多两个领域外部操作，每五分钟三十次。 */
@Injectable()
export class TravelOperations {
  /** 固定文字日志不打印网络地址和凭据。 */
  private readonly logger = new Logger(TravelOperations.name);
  /** 连接资源全部归StorageService拥有。 */
  constructor(
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly repository: TravelRepository,
  ) {}
  /** 实际操作在租约内执行，供应商超时和浏览器取消传到同一信号。 */
  async run<T>(
    userId: string,
    tripId: string,
    module: number,
    name: string,
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    /** 所有权失败不能占用别人的配额或调用外部服务。 */
    await this.repository.get(userId, tripId);
    signal.throwIfAborted();
    const id = randomUUID();
    const prefix = this.config.env.REDIS_PREFIX;
    const slots = `${prefix}:travel:slots:${userId}`;
    const rate = `${prefix}:travel:rate:${userId}`;
    const now = Date.now();
    /** Lua原子执行清理、限频和占位；崩溃后槽位也会到期。 */
    const acquired = Number(
      await this.storage.redis.eval(
        "local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],300) end; if n>30 then return -1 end; redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1])>=2 then return 0 end; redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('EXPIRE',KEYS[1],120); return 1",
        {
          keys: [slots, rate],
          arguments: [String(now), String(now + 100000), id],
        },
      ),
    );
    if (acquired !== 1)
      throw new HttpException(
        acquired === -1 ? '旅行查询过于频繁，请稍后重试' : '旅行查询正在进行，请等待或取消',
        429,
      );
    /** 信号涵盖真实HTTP连接关闭与领域90秒硬上限。 */
    const combined = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
    let status = 'completed';
    let code: string | null = null;
    const start = performance.now();
    try {
      return await work(combined);
    } catch (error) {
      status = combined.aborted ? 'cancelled' : 'failed';
      code =
        error instanceof HttpException
          ? `HTTP_${error.getStatus()}`
          : combined.aborted
            ? 'OPERATION_ABORTED'
            : 'OPERATION_FAILED';
      throw error;
    } finally {
      await this.storage.redis.zRem(slots, id).catch(() => undefined);
      try {
        await this.storage.sql.query(
          'INSERT INTO trip_operations(user_id,trip_id,module,operation,status,duration_ms,code) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [userId, tripId, module, name, status, Math.round(performance.now() - start), code],
        );
      } catch {
        this.logger.warn('业务操作指标暂未写入');
      }
    }
  }
  /** 仅返回当前用户的运维摘要，不能用监控接口窥探别人旅行。 */
  async metrics(userId: string) {
    const operations = await this.storage.sql.query(
      "SELECT module,status,count(*)::int AS count,round(avg(duration_ms))::int AS avg_ms FROM trip_operations WHERE user_id=$1 AND created_at>now()-interval '1 day' GROUP BY module,status ORDER BY module,status",
      [userId],
    );
    const usage = await this.storage.sql.query(
      "SELECT DISTINCT ON (e.run_id) e.event->'payload' AS usage FROM run_events e JOIN runs r ON r.id=e.run_id WHERE r.user_id=$1 AND r.created_at>now()-interval '1 day' AND e.event->>'type'='agent.step' ORDER BY e.run_id,e.sequence DESC",
      [userId],
    );
    const counts = usage.rows.reduce(
      (sum, row) => ({
        modelCalls: sum.modelCalls + Number(row.usage.modelCalls ?? 0),
        toolCalls: sum.toolCalls + Number(row.usage.toolCalls ?? 0),
        tokens: sum.tokens + Number(row.usage.totalTokens ?? 0),
        estimated: sum.estimated || Boolean(row.usage.estimated),
      }),
      { modelCalls: 0, toolCalls: 0, tokens: 0, estimated: false },
    );
    return {
      windowHours: 24,
      operations: operations.rows,
      usage: counts,
      billing: 'token使用量不等于供应商账单，未配置单价时不虚报货币成本',
    };
  }
}
