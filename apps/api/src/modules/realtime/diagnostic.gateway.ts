/** 使用加密安全的随机标识关联每个事件、运行和工具调用。 */
import { randomUUID } from 'node:crypto';
/** 使用可取消的延时，仅调节诊断文本传输节奏，不伪造工具执行耗时。 */
import { setTimeout as delay } from 'node:timers/promises';
/** 引入 Nest WebSocket 路由与连接生命周期类型。 */
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
/** 引入真实 ws 客户端类型与连接状态常量。 */
import { WebSocket } from 'ws';
/** 读取握手来源，以便执行与 HTTP 一致的来源校验。 */
import type { IncomingMessage } from 'node:http';
/** 使用共享的严格请求校验和事件结构。 */
import {
  cancelRequestSchema,
  diagnosticRequestSchema,
  PROTOCOL_VERSION,
  serverEventSchema,
  type ServerEvent,
} from '@journey/contracts';
/** 读取服务端运行环境。 */
import { AppConfig } from '../../config/config.module.js';
/** 注入真实健康服务作为本阶段唯一可执行的诊断工具。 */
import { HealthService } from '../health/health.module.js';
/** 描述每个连接独有的状态，避免不同访客共享运行或取消令牌。 */
interface ConnectionState {
  /** 按连接递增的序号支持前端拒绝重复或乱序事件。 */
  sequence: number;
  /** 活动运行由请求标识和中止控制器共同管理。 */
  active?: { requestId: string; controller: AbortController };
  /** 记住本连接已处理的请求，防止重复发送触发多次执行。 */
  seen: Set<string>;
  /** 结束连接状态结构。 */
}
/** 限制单条消息体积；路径可直接由未来小程序的原生 WebSocket 访问。 */
@WebSocketGateway({ path: '/ws/chat', maxPayload: 16384 })
/** 此入口仅提供本机框架诊断，真实问答通过鉴权SSE与Agent执行器运行。 */
export class DiagnosticGateway implements OnGatewayConnection, OnGatewayDisconnect {
  /** WeakMap 隔离每个连接，连接回收后不保留对象引用。 */
  private readonly states = new WeakMap<WebSocket, ConnectionState>();
  /** 注入共享配置与真实健康服务，不访问外部供应商。 */
  constructor(
    private readonly config: AppConfig,
    private readonly health: HealthService,
  ) {}
  /** 接入时校验来源并告知客户端当前协议范围。 */
  handleConnection(client: WebSocket, request: IncomingMessage): void {
    /** 从握手请求读取浏览器 Origin，非浏览器客户端可不带该头。 */
    const origin = request.headers.origin;
    /** 开发诊断被关闭或来源不在白名单时，拒绝建立可用会话。 */
    if (!this.config.diagnosticsEnabled || (origin && !this.config.origins.includes(origin))) {
      client.close(1008, 'Connection not allowed');
      return;
    }
    /** 为本连接创建独立序号与请求去重集合。 */
    this.states.set(client, { sequence: 0, seen: new Set() });
    /** 通知网页此连接是底座诊断连接，而非已经接入模型的旅行对话。 */
    this.emit(client, null, 'session.ready', {
      scope: 'foundation',
      message: '框架诊断连接已建立；旅游智能体尚未开放。',
    });
    /** 结束连接建立流程。 */
  }
  /** 断开连接即终止该连接自己的活动任务。 */
  handleDisconnect(client: WebSocket): void {
    /** 通知可取消的文本发送停止。 */
    this.states.get(client)?.active?.controller.abort();
    /** 显式删除状态，避免断线后继续向旧连接发送。 */
    this.states.delete(client);
    /** 结束断开处理。 */
  }
  /** 声明框架自检命令，不接受客户端指定任意工具名称。 */
  @SubscribeMessage('diagnostic.start')
  /** 校验请求、限制并发，并在后台运行可取消诊断。 */
  start(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown): void {
    /** 对不可信网络数据执行运行时校验。 */
    const parsed = diagnosticRequestSchema.safeParse(data);
    /** 对当前连接读取独立状态。 */
    const state = this.states.get(client);
    /** 已关闭或未通过握手的连接不能运行任务。 */
    if (!state) return;
    /** 无效输入只返回通用错误，不反射原始用户数据。 */
    if (!parsed.success) {
      this.emit(client, null, 'run.failed', {
        code: 'INVALID_REQUEST',
        message: '请求格式无效，消息长度需为 1～2000 字。',
      });
      return;
    }
    /** 取出已经验证的请求标识。 */
    const { requestId } = parsed.data;
    /** 一个连接一次只允许一个活动运行，避免无限启动任务。 */
    if (state.active) {
      this.emit(client, requestId, 'run.failed', {
        code: 'RUN_BUSY',
        message: '请等待当前运行结束，或先停止它。',
      });
      return;
    }
    /** 同一请求不得执行两次，也限制每个连接的历史标识数量。 */
    if (state.seen.has(requestId) || state.seen.size >= 100) {
      this.emit(client, requestId, 'run.failed', {
        code: 'REQUEST_REJECTED',
        message: '请求重复或连接已达到运行上限，请重新连接。',
      });
      return;
    }
    /** 在异步任务启动前登记请求，防止同一事件循环中出现重复调用。 */
    state.seen.add(requestId);
    /** 每次运行持有独立取消信号。 */
    const controller = new AbortController();
    /** 将运行绑定到当前连接。 */
    state.active = { requestId, controller };
    /** 异步方法内部自行收尾，避免向 ws 适配器返回第二套隐式响应。 */
    void this.run(client, requestId, controller);
    /** 结束自检命令处理。 */
  }
  /** 声明停止当前运行的命令。 */
  @SubscribeMessage('run.cancel')
  /** 只允许停止当前连接拥有且标识匹配的运行。 */
  cancel(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown): void {
    /** 校验取消命令，不信任客户端提供的对象结构。 */
    const parsed = cancelRequestSchema.safeParse(data);
    /** 查询当前连接的活动运行。 */
    const active = this.states.get(client)?.active;
    /** 请求合法且运行归属匹配时发送中止信号。 */
    if (parsed.success && active?.requestId === parsed.data.requestId) active.controller.abort();
    /** 结束取消命令处理。 */
  }
  /** 执行真实健康工具，并将公开进度和结果统一转成事件。 */
  private async run(client: WebSocket, runId: string, controller: AbortController): Promise<void> {
    /** 为本次唯一的健康工具调用创建关联标识。 */
    const callId = randomUUID();
    /** 用 try/finally 保证成功、失败、取消都释放活动运行。 */
    try {
      /** 明确运行模式，防止诊断被误认为旅游智能体生成。 */
      this.emit(client, runId, 'run.started', {
        mode: 'diagnostic',
        message: '正在执行框架自检，不调用模型或外部 MCP。',
      });
      /** 展示可以核验的步骤摘要，而非模型内部思维链。 */
      this.emit(client, runId, 'run.progress', {
        title: '检查连接与服务状态',
        detail: '读取当前 API 进程和脱敏集成配置，再验证流式回答展示。',
      });
      /** 在调用前公开工具名称和实际参数。 */
      this.emit(client, runId, 'tool.started', {
        callId,
        name: 'system.health',
        input: {},
      });
      /** 记录真实工具开始时间，不使用人为延时制造耗时。 */
      const started = performance.now();
      /** 实际调用与 HTTP 健康探针共享的服务。 */
      const output = this.health.snapshot();
      /** 将真实结果和真实耗时返回到工具轨迹。 */
      this.emit(client, runId, 'tool.completed', {
        callId,
        name: 'system.health',
        output,
        durationMs: Math.max(0, performance.now() - started),
      });
      /** 生成明确说明当前阶段的 Markdown，不包含虚构车次或价格。 */
      const markdown = `## 诊断通道已就绪\n\n这次运行是**真实的框架自检**，没有调用语言模型，也没有搜索旅游信息。\n\n### 已验证\n\n- NestJS API 与 WebSocket 通道正常\n- 工具名称、参数、返回值和耗时可查看\n- Markdown 回答支持流式呈现与代码高亮\n\n| 检查项 | 当前状态 |\n| --- | --- |\n| API 服务 | 正常 |\n| Node.js | ${output.runtime} |\n| 外部 MCP | 本次诊断未调用 |\n| 旅行规划 | 通过旅行工作区与真实智能体使用 |\n\n> 当前尚未生成旅游方案或可预订报价。诊断与实际旅行查询分开；正常问答使用身份绑定的对话入口。\n`;
      /** 每次发送固定长度文本；延时只服务于流式呈现与取消交互验证。 */
      for (let index = 0; index < markdown.length; index += 32) {
        /** 检查用户停止或连接断开产生的中止信号。 */
        controller.signal.throwIfAborted();
        /** 发送下一段 Markdown，客户端追加到当前回答。 */
        this.emit(client, runId, 'message.delta', {
          content: markdown.slice(index, index + 32),
        });
        /** 可取消的传输节奏便于确认逐段呈现与停止按钮有效。 */
        await delay(24, undefined, { signal: controller.signal });
        /** 结束文本增量发送。 */
      }
      /** 全部文本发送成功后只发布一次完成终态。 */
      this.emit(client, runId, 'run.completed', { message: '框架自检完成' });
      /** 将中止和异常映射为不同终态。 */
    } catch {
      /** 不返回底层异常对象，避免网络地址和密钥泄漏。 */
      if (controller.signal.aborted)
        this.emit(client, runId, 'run.cancelled', {
          message: '已停止本次运行。',
        });
      /** 非用户取消的错误使用稳定错误码。 */ else
        this.emit(client, runId, 'run.failed', {
          code: 'DIAGNOSTIC_FAILED',
          message: '框架自检失败，请检查服务日志。',
        });
      /** 不论何种终态都清理活动运行。 */
    } finally {
      /** 连接可能已经断开，因此需要重新获取状态。 */
      const state = this.states.get(client);
      /** 只清理当前运行，避免意外影响后来新建的运行。 */
      if (state?.active?.requestId === runId) delete state.active;
      /** 结束资源清理。 */
    }
    /** 结束诊断运行。 */
  }
  /** 在同一出口校验事件、分配序号并安全发送。 */
  private emit(
    client: WebSocket,
    runId: string | null,
    type: ServerEvent['type'],
    payload: unknown,
  ): void {
    /** 获取连接专属序列状态。 */
    const state = this.states.get(client);
    /** 断线时立即放弃发送，避免关闭中的连接抛异常。 */
    if (!state || client.readyState !== WebSocket.OPEN) return;
    /** 严格校验协议结构，防止内部实现偏离前端约定。 */
    const event = serverEventSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      id: randomUUID(),
      runId,
      sequence: ++state.sequence,
      timestamp: new Date().toISOString(),
      type,
      payload,
    });
    /** 序列化为标准 JSON，兼容浏览器和未来小程序连接。 */
    client.send(JSON.stringify(event));
    /** 结束统一事件发送。 */
  }
  /** 结束诊断网关。 */
}
