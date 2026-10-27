/** 安全标识用于真实工具调用关联。 */
import { randomUUID } from 'node:crypto';
/** 可取消等待用于流式节奏，不冒充工具耗时。 */
import { setTimeout as delay } from 'node:timers/promises';
/** 生命周期在停服时中止本进程所有工作。 */
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
/** 使用可信认证上下文创建运行。 */
import type { Actor } from '../identity/auth.service.js';
/** 真实健康工具复用现有实现。 */
import { HealthService } from '../health/health.module.js';
/** 持久化状态机负责并发配额、序号和终态。 */
import { RuntimeRepository } from './runtime.repository.js';
/** 已保存的任务不会因网页断线而被误取消。 */
@Injectable()
/** 第四模块可替换execute内部执行器，保持相同取消与持久化出口。 */
export class RuntimeService implements OnModuleInit, OnModuleDestroy {
  /** 最多二十个运行由数据库配额约束；Map只保存中止句柄。 */
  private readonly active = new Map<string, AbortController>();
  /** 恢复定时器独立于连接，崩溃任务租约到期后会进入失败终态。 */
  private recovery?: ReturnType<typeof setInterval>; private recovering = false; private closing = false;
  /** 日志只有固定文字，不输出请求原文和底层异常。 */
  private readonly logger = new Logger(RuntimeService.name);
  /** 依赖真实仓储和工具服务。 */
  constructor(private readonly repository: RuntimeRepository, private readonly health: HealthService) {}
  /** 未启用存储时恢复器安全跳过，不影响无数据库诊断。 */
  onModuleInit(): void { this.recovery = setInterval(() => { void this.recover(); }, 5000); this.recovery.unref(); }
  /** 幂等提交只有首次创建才启动工作，不会重复调用工具。 */
  async start(actor: Actor, conversationId: string, input: { requestId: string; message: string }) {
    /** 数据库先提交运行，工作随后执行。 */
    const result = await this.repository.start(actor, conversationId, input);
    /** 一个运行只有创建它的进程执行，其他实例返回原运行。 */
    if (result.created) { const controller = new AbortController(); this.active.set(result.run.id, controller); void this.execute(result.run.id, controller); }
    /** 对外不暴露created或内部中止控制器。 */
    return { run: result.run };
  /** 结束运行创建。 */
  }
  /** 取消标志跨实例可见，本进程则立即传播AbortSignal。 */
  async cancel(actor: Actor, conversationId: string, runId: string): Promise<{ accepted: true }> { await this.repository.cancel(actor.userId, conversationId, runId); this.active.get(runId)?.abort('cancelled'); return { accepted: true }; }
  /** 恢复器只处理租约过期运行，成功与取消都不能被再次覆盖。 */
  private async recover(): Promise<void> {
    /** 防止数据库故障时重叠启动恢复扫描。 */
    if (this.recovering || this.closing) return; this.recovering = true;
    /** 恢复失败留给下一次扫描，不打印数据库连接串。 */
    try { for (const id of await this.repository.expired()) await this.repository.append(id, 'run.failed', { code: 'WORKER_INTERRUPTED', message: '执行进程中断；已保存内容可查看，请重新发送继续。' }, true); }
    /** 无存储模式保持安静，其他故障也不产生未处理Promise。 */
    catch { /* 存储就绪后下一次扫描继续恢复。 */ }
    /** 无论成功与否释放扫描状态。 */
    finally { this.recovering = false; }
  /** 结束恢复扫描。 */
  }
  /** 执行器边界统一传播取消、超时、会话撤销和停服信号。 */
  private async execute(runId: string, controller: AbortController): Promise<void> {
    /** 硬超时独立于浏览器是否在线，避免无限运行。 */
    const timeout = setTimeout(() => controller.abort('timeout'), 90000); timeout.unref();
    /** 每次发布前校验会话和租约，并把取消传递到实际等待。 */
    const publish = async (type: Parameters<RuntimeRepository['append']>[1], payload: unknown) => { controller.signal.throwIfAborted(); if (!await this.repository.renew(runId)) { controller.abort('cancelled'); controller.signal.throwIfAborted(); } if (!await this.repository.append(runId, type, payload)) { controller.abort('cancelled'); controller.signal.throwIfAborted(); } };
    /** 运行最终只有一个数据库终态，即使取消与完成同时发生。 */
    try {
      /** 只公开可核验执行步骤，不输出模型内部思维链。 */
      await publish('run.progress', { title: '检查持久化对话通道', detail: '真实读取服务状态；消息与工具事件同步保存，可刷新恢复。' });
      /** 工具参数明确为空，不把用户输入当可执行代码。 */
      const callId = randomUUID(); await publish('tool.started', { callId, name: 'system.health', input: {} });
      /** 记录实际调用耗时，等待节奏不计入工具耗时。 */
      const started = performance.now(); controller.signal.throwIfAborted(); const output = this.health.snapshot();
      /** 返回真实公开结果。 */
      await publish('tool.completed', { callId, name: 'system.health', output, durationMs: performance.now() - started });
      /** 当前阶段只证明真实基础设施，绝不编造旅行方案和价格。 */
      const markdown = `## 对话已保存，随时回来继续\n\n第三模块已接入**身份绑定的持久化运行**。本次执行的是系统自检，尚未调用语言模型或旅游 MCP。\n\n### 本次真实执行\n\n- 调用 \`system.health\`，读取 API 与数据服务状态\n- 保存用户消息、助手正文、公开步骤及工具结果\n- 按会话序号补发事件，刷新或断线后恢复\n\n| 检查项 | 当前状态 |\n| --- | --- |\n| Node.js | ${output.runtime} |\n| 消息历史 | PostgreSQL 持久化 |\n| 取消与断线 | 可停止运行；断线后继续执行 |\n| 模型编排 | 第四模块接入 Deep Agents |\n| 旅游工具 | 第五模块接入 MCP |\n\n> 这里展示的是执行摘要和真实工具返回值；本次没有生成旅游报价。\n`;
      /** 增量体积固定；可取消等待让界面能验证实时传输与停止。 */
      for (let index = 0; index < markdown.length; index += 48) { await publish('message.delta', { content: markdown.slice(index, index + 48) }); await delay(80, undefined, { signal: controller.signal }); }
      /** 完成前再次检查撤销，不能把已取消的运行标成成功。 */
      await publish('run.progress', { title: '正文与轨迹已保存', detail: '可以刷新页面恢复本轮回答，或继续发送下一条消息。' });
      /** 取消与完成竞争时以数据库锁裁决。 */
      if (!await this.repository.append(runId, 'run.completed', { message: '持久化自检完成' })) await this.repository.append(runId, 'run.cancelled', { message: '运行已停止，已发送内容已保存。' });
    /** 异常不把内部堆栈和凭据返回给浏览器。 */
    } catch {
      /** 超时明确为失败，用户取消和登出均停止实际执行。 */
      try { if (controller.signal.aborted && controller.signal.reason !== 'timeout' && controller.signal.reason !== 'shutdown') await this.repository.append(runId, 'run.cancelled', { message: '运行已停止，已发送内容已保存。' }); else await this.repository.append(runId, 'run.failed', { code: controller.signal.reason === 'timeout' ? 'RUN_TIMEOUT' : 'RUN_INTERRUPTED', message: controller.signal.reason === 'timeout' ? '运行超时，已停止执行。' : '运行中断，已保存内容可恢复。' }); }
      /** 数据库不可用则保留租约，恢复器稍后写入失败终态。 */
      catch { this.logger.warn('运行终态等待租约恢复'); }
    /** 清理句柄不依赖网络连接和数据库可用性。 */
    } finally { clearTimeout(timeout); this.active.delete(runId); }
  /** 结束受控执行器。 */
  }
  /** 停服先传播中止信号，再等待已启动的执行器释放资源。 */
  async onModuleDestroy(): Promise<void> { this.closing = true; clearInterval(this.recovery); for (const controller of this.active.values()) controller.abort('shutdown'); for (let attempt = 0; attempt < 40 && this.active.size; attempt += 1) await delay(50); }
/** 结束运行服务。 */
}
