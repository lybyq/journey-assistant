/** 流式HTTP通过标准Bearer鉴权，访问令牌不放URL。 */
import { Body, Controller, Get, Post, Param, ParseUUIDPipe, Query, Req, Res, UseGuards, HttpException, Injectable, type OnModuleDestroy } from '@nestjs/common';
/** OpenAPI明确需要访问身份。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** HTTP原生流处理支持真正背压。 */
import type { Response } from 'express';
/** 小批量等待可被断开信号中止。 */
import { setTimeout as delay } from 'node:timers/promises';
/** 连接槽位使用随机标识，不保存访问令牌。 */
import { randomUUID } from 'node:crypto';
/** 所有查询和请求字段来自共享严格schema。 */
import { startRunSchema, messageQuerySchema, eventQuerySchema } from '@journey/contracts';
/** 统一输入校验避免超长或非法游标进入数据库。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 使用第二模块守卫和可信请求。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 长连接持续检查用户会话，登出不能继续读取私有内容。 */
import { AuthService } from '../identity/auth.service.js';
/** 连接配额由Redis跨实例共享。 */
import { StorageService } from '../../storage/storage.module.js';
/** Redis键以当前项目命名空间隔离。 */
import { AppConfig } from '../../config/config.module.js';
/** 数据仓储和执行器各自负责一致性及实际工作。 */
import { RuntimeRepository } from './runtime.repository.js';
/** 可取消执行服务与HTTP连接生命周期分离。 */
import { RuntimeService } from './runtime.service.js';
/** 连接注册表只保存中止句柄，关闭服务时立即释放长连接。 */
@Injectable()
/** 每个实例最多一百条流，单用户通过Redis再限制为三条。 */
export class StreamConnections implements OnModuleDestroy {
  /** 有界集合由控制器在finally中清理。 */
  readonly active = new Set<AbortController>();
  /** 关闭时唤醒所有等待中的流。 */
  onModuleDestroy(): void { for (const controller of this.active) controller.abort(); }
/** 结束连接资源管理。 */
}
/** 对话运行与历史拥有独立文档分组。 */
@ApiTags('持久化对话与运行')
/** 公开声明Bearer认证要求。 */
@ApiBearerAuth()
/** 所有接口均逐次验证登录和会话撤销状态。 */
@UseGuards(AccessGuard)
/** 路径必须携带会话标识，归属由数据库查询确认。 */
@Controller('conversations/:id')
/** 采用fetch可读取的SSE格式，便于未来小程序更换传输适配器。 */
export class RuntimeController {
  /** 身份、仓储、运行与连接资源分别注入。 */
  constructor(private readonly repository: RuntimeRepository, private readonly runtime: RuntimeService, private readonly auth: AuthService, private readonly storage: StorageService, private readonly config: AppConfig, private readonly connections: StreamConnections) {}
  /** 最新历史与事件水位是同一一致性快照。 */
  @Get('messages')
  /** 分页向更早消息读取，不一次加载整个会话。 */
  messages(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Query(new SchemaPipe(messageQuerySchema)) query: ReturnType<typeof messageQuerySchema.parse>) { return this.repository.snapshot(request.actor.userId, id, query.before, query.limit); }
  /** 提交只保存一条幂等运行，绝不信任客户端工具或系统提示词。 */
  @Post('runs')
  /** 创建完成立即返回运行ID，事件由独立流补发。 */
  start(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Body(new SchemaPipe(startRunSchema)) input: ReturnType<typeof startRunSchema.parse>) { return this.runtime.start(request.actor, id, input); }
  /** 停止操作同样要求会话和运行同时属于当前用户。 */
  @Post('runs/:runId/cancel')
  /** 重复取消不会生成第二个终态。 */
  cancel(@Req() request: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string, @Param('runId', new ParseUUIDPipe()) runId: string) { return this.runtime.cancel(request.actor, id, runId); }
  /** 每条连接最多25秒，自动重连时重新获取短期访问令牌。 */
  @Get('events')
  /** 心跳和批次查询均有界，断线不会中止后台实际任务。 */
  async stream(@Req() request: AuthRequest, @Res() response: Response, @Param('id', new ParseUUIDPipe()) id: string, @Query(new SchemaPipe(eventQuerySchema)) query: ReturnType<typeof eventQuerySchema.parse>): Promise<void> {
    /** 在发送HTTP头之前拒绝越权和非法未来游标。 */
    await this.repository.own(request.actor.userId, id); const snapshot = await this.repository.snapshot(request.actor.userId, id, undefined, 2); if (query.after > snapshot.sequence) throw new HttpException('事件游标超出当前会话范围', 400);
    /** 服务器本身的连接数受硬上限保护。 */
    if (this.connections.active.size >= 100) throw new HttpException('实时连接已满，请稍后重试', 429);
    /** Redis有序集合以到期分数清理崩溃进程留下的槽位。 */
    const key = `${this.config.env.REDIS_PREFIX}:streams:${request.actor.userId}`; const slot = randomUUID(); const now = Date.now();
    /** 原子获取用户连接槽位，45秒后必然回收。 */
    const acquired = await this.storage.redis.eval("redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1])>=3 then return 0 end; redis.call('ZADD',KEYS[1],ARGV[2],ARGV[3]); redis.call('EXPIRE',KEYS[1],60); return 1", { keys: [key], arguments: [String(now), String(now + 45000), slot] });
    /** 超配额在发送响应正文前返回标准429。 */
    if (!acquired) throw new HttpException('此账户实时连接过多，请关闭其他页面', 429);
    /** 每条流独立中止信号，网络断开只释放此连接。 */
    const controller = new AbortController(); this.connections.active.add(controller); const closed = () => controller.abort(); response.once('close', closed);
    /** 连接最长25秒，同时用于清理失联浏览器资源。 */
    const deadline = setTimeout(closed, 25000); let after = query.after; let heartbeat = 0;
    /** 令牌不记录日志、不写入URL；定期重新核验数据库会话。 */
    const token = request.headers.authorization!.slice(7);
    /** 长连接内部错误在头发出后只结束流，不能再写普通JSON响应。 */
    try {
      /** 禁止代理缓存和缓冲，逐帧送达浏览器。 */
      response.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); response.flushHeaders();
      /** 初始注释确认流建立，心跳不是持久化业务事件。 */
      await this.write(response, ': connected\n\n', controller.signal);
      /** 每批最多64个事件，发送完后只保留最后确认序号。 */
      while (!controller.signal.aborted) {
        /** 每秒重新检查访问令牌和撤销，旧登录不能长期读取。 */
        if (Date.now() - heartbeat >= 1000) { await this.auth.authenticate(token); await this.write(response, `: heartbeat ${Date.now()}\n\n`, controller.signal); heartbeat = Date.now(); }
        /** SQL按序号补发，断线重连只请求after之后的数据。 */
        const events = await this.repository.events(id, after);
        /** 先完成背压写入再移动服务端游标，不无限缓存帧。 */
        for (const event of events) { await this.write(response, `id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`, controller.signal); after = event.sequence; }
        /** 空闲时降低轮询频率，断线信号会立即唤醒。 */
        await delay(events.length === 64 ? 1 : 150, undefined, { signal: controller.signal });
      /** 结束受控补发循环。 */
      }
    /** 断线、撤销、超时和数据库故障都结束当前流，客户端按游标恢复。 */
    } catch { /* 流中不返回内部异常信息或令牌。 */ }
    /** 清理连接槽位和所有生命周期监听。 */
    finally { clearTimeout(deadline); response.off('close', closed); controller.abort(); this.connections.active.delete(controller); if (!response.writableEnded) response.end(); try { await this.storage.redis.zRem(key, slot); } catch { /* Redis槽位自动到期，不无限保留。 */ } }
  /** 结束SSE传输方法。 */
  }
  /** 遵守Node写入背压，慢客户端最多等待五秒。 */
  private async write(response: Response, frame: string, signal: AbortSignal): Promise<void> {
    /** 已关闭的连接不再尝试追加字节。 */
    signal.throwIfAborted(); if (response.destroyed) throw new Error('连接关闭'); if (response.write(frame)) return;
    /** 每次最多一个待排空Promise，保证有界内存。 */
    await new Promise<void>((resolve, reject) => {
      /** 清理所有分支的监听和超时，避免连接积累监听器。 */
      const cleanup = () => { clearTimeout(timer); response.off('drain', drained); response.off('close', failed); signal.removeEventListener('abort', failed); };
      /** 排空后才允许读取下一批。 */
      const drained = () => { cleanup(); resolve(); }; const failed = () => { cleanup(); reject(new Error('传输中断')); };
      /** 慢消费者不能永久占用连接。 */
      const timer = setTimeout(failed, 5000); response.once('drain', drained); response.once('close', failed); signal.addEventListener('abort', failed, { once: true }); if (signal.aborted) failed();
    /** 结束背压Promise。 */
    });
  /** 结束背压写入。 */
  }
/** 结束生产对话控制器。 */
}
