/** 在独立 Node 进程运行 tsc 产物，保留 Nest 装饰器元数据。 */
import { spawn, type ChildProcess } from 'node:child_process';
/** 标准 UUID 与实际客户端请求标识保持一致。 */
import { randomUUID } from 'node:crypto';
/** 使用真实 WebSocket 客户端验证协议，不 mock 服务端。 */
import { WebSocket } from 'ws';
/** Vitest 管理真实服务的测试前后生命周期。 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
/** 服务响应必须与网页使用的同一 schema 一致。 */
import { healthSchema, serverEventSchema, type ServerEvent } from '@journey/contracts';
/** 保留独立服务进程引用，以便测试结束时回收。 */
let server: ChildProcess;
/** 测试服务监听随机空闲端口，避免冲突或占用用户的开发端口。 */
let baseUrl = '';
/** 每个用例结束后关闭自身创建的所有连接。 */
const sockets = new Set<WebSocket>();
/** 以实际编译后的服务入口装配应用，不调用任何外部模型或供应商。 */
beforeAll(async () => {
  /** 把中文和空格路径转换成 Node 能稳定导入的文件 URL。 */
  const bootstrapUrl = new URL('../apps/api/dist/bootstrap.js', import.meta.url).href;
  /** 子进程脚本仅启动真实应用并报告随机监听地址。 */
  const script = `import { createApplication } from ${JSON.stringify(bootstrapUrl)}; const app = await createApplication({ logger: false }); await app.listen(0, '127.0.0.1'); console.log('TEST_SERVER:' + await app.getUrl());`;
  /** 填入哨兵密钥，确保公开响应中不会出现秘密值。 */
  server = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      STORAGE_ENABLED: 'false',
      NODE_ENV: 'test',
      CHAT_EXECUTOR: 'diagnostic',
      MCP_SERVERS: '',
      ENABLE_DIAGNOSTICS: 'true',
      LLM_API_KEY: 'test-key-never-expose',
      LLM_MODEL: 'model-not-called',
      AMAP_MAPS_API_KEY: 'amap-key-never-expose',
      TAVILY_API_KEY: 'tavily-key-never-expose',
      CORS_ORIGINS: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /** 在真正监听成功后再开始发请求。 */
  baseUrl = await new Promise<string>((resolve, reject) => {
    /** 启动失败时快速报错，避免测试永久等待。 */
    const timer = setTimeout(() => reject(new Error('测试服务启动超时')), 12000);
    /** 累积输出以兼容一条日志跨多个数据块的情况。 */
    let output = '';
    let errors = '';
    /** 启动错误只在失败用例中输出。 */
    server.stderr?.on('data', (chunk) => {
      errors += String(chunk);
    });
    /** 提取框架报告的实际监听 URL。 */
    server.stdout?.on('data', (chunk) => {
      output += String(chunk);
      const match = output.match(/TEST_SERVER:(http:\/\/[^\s]+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    /** 子进程退出时及时结束等待。 */
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`测试服务提前退出：${code} ${errors}`));
    });
    /** Node 无法启动等系统错误进入同一失败通道。 */
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    /** 结束服务就绪等待。 */
  });
  /** 结束真实服务准备。 */
}, 15000);
/** 每个用例独立连接，杜绝活动运行与请求去重状态互相影响。 */
afterEach(() => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
});
/** 测试完成后结束服务进程，不留后台测试端口。 */
afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    server.once('exit', () => resolve());
    server.kill();
  });
});
/** 创建带历史队列的真实协议探针，避免漏掉快速发送的握手事件。 */
async function openProbe(origin = 'http://localhost:5173') {
  /** 将 HTTP 地址转换成同源 WebSocket 地址。 */
  const socket = new WebSocket(baseUrl.replace('http:', 'ws:') + '/ws/chat', { origin });
  /** 将连接纳入统一资源清理。 */
  sockets.add(socket);
  /** 保存所有通过校验的服务事件。 */
  const events: ServerEvent[] = [];
  /** 观察者集合允许等待指定终态或工具完成。 */
  const observers = new Set<() => void>();
  /** 从构造连接开始记录事件，避免 open 与首条 message 之间的竞态。 */
  socket.on('message', (data) => {
    events.push(serverEventSchema.parse(JSON.parse(String(data))));
    for (const observer of observers) observer();
  });
  /** 确认底层连接已真正建立。 */
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  /** 返回发送、事件历史与基于语义事件的等待函数。 */
  return {
    socket,
    events,
    until: (predicate: (event: ServerEvent) => boolean) =>
      new Promise<ServerEvent>((resolve, reject) => {
        /** 先检查历史，工具事件可能已经到达。 */
        const existing = events.find(predicate);
        /** 已存在的事件无需等待。 */
        if (existing) {
          resolve(existing);
          return;
        }
        /** 超时只用于断言失败，不用固定 sleep 猜测服务完成。 */
        const timeout = setTimeout(() => {
          observers.delete(check);
          reject(new Error('未收到预期服务事件'));
        }, 7000);
        /** 每次收到新事件检查目标条件。 */
        function check(): void {
          const value = events.find(predicate);
          if (value) {
            clearTimeout(timeout);
            observers.delete(check);
            resolve(value);
          }
        }
        /** 注册事件观察者。 */
        observers.add(check);
        /** 结束等待 Promise。 */
      }),
  };
  /** 结束协议探针创建。 */
}
/** 通过真实 HTTP 与 WebSocket 验证可观察交互底座。 */
describe('框架端到端', () => {
  /** 就绪范围、配置与连接状态必须准确，并且不泄漏密钥。 */
  it('健康响应准确区分配置与连接且不包含密钥', async () => {
    /** 发起真实 HTTP 请求。 */
    const response = await fetch(`${baseUrl}/api/v1/system/health`);
    /** 解析并验证公开结构。 */
    const text = await response.text();
    const health = healthSchema.parse(JSON.parse(text));
    /** 只有框架范围声明为可用。 */
    expect(health.scope).toBe('foundation');
    expect(health.integrations.every((item) => !item.connected)).toBe(true);
    /** 哨兵密钥不能出现在任何公开字段中。 */
    expect(text).not.toContain('never-expose');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    /** 结束健康验证。 */
  });
  /** 未定义路由也应返回统一错误结构和有效请求标识。 */
  it('未知路由返回受控错误且清理非法追踪标识', async () => {
    const response = await fetch(`${baseUrl}/api/v1/missing`, {
      headers: { 'x-request-id': 'bad value' },
    });
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.requestId).not.toBe('bad value');
    expect(body).not.toHaveProperty('stack');
  });
  /** 模块状态必须与用户要求的逐步交付一致。 */
  it('路线清单明确标记十四个已实现模块', async () => {
    const response = await fetch(`${baseUrl}/api/v1/system/modules`);
    const modules = (await response.json()) as { phase: number; status: string }[];
    expect(modules).toHaveLength(14);
    expect(modules.filter((item) => item.status === 'ready').map((item) => item.phase)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
  });
  /** 验证工具结果、逐段文本、序号和唯一成功终态来自真实服务。 */
  it('完整自检返回真实工具结果与有序文本增量', async () => {
    /** 先等协议握手，再发送运行请求。 */
    const probe = await openProbe();
    await probe.until((event) => event.type === 'session.ready');
    /** 每次请求都使用全新运行标识。 */
    const requestId = randomUUID();
    probe.socket.send(
      JSON.stringify({ event: 'diagnostic.start', data: { requestId, message: '验证框架' } }),
    );
    /** 按完成事件等待，不使用不稳定的固定睡眠。 */
    await probe.until((event) => event.type === 'run.completed');
    /** 必须存在工具完成且输出为当前 Node 进程的真实信息。 */
    const tool = probe.events.find((event) => event.type === 'tool.completed');
    expect(tool?.type).toBe('tool.completed');
    /** 类型收窄之后验证精确工具与结构。 */
    if (tool?.type === 'tool.completed') {
      expect(tool.payload.name).toBe('system.health');
      expect(healthSchema.parse(tool.payload.output).runtime).toBe(process.version);
      expect(JSON.stringify(tool)).not.toContain('never-expose');
    }
    /** 多个文本块组成回答，并且明确标记诊断范围。 */
    const deltas = probe.events.filter((event) => event.type === 'message.delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((event) => event.payload.content).join('')).toContain('没有调用语言模型');
    /** 序号必须严格递增，成功终态只能出现一次。 */
    expect(probe.events.map((event) => event.sequence)).toEqual(
      probe.events.map((_, index) => index + 1),
    );
    expect(probe.events.filter((event) => event.type === 'run.completed')).toHaveLength(1);
    /** 结束完整链路验证。 */
  });
  /** 停止必须中止服务端活动流程，不能只把前端按钮变灰。 */
  it('取消运行后没有成功终态和后续文本', async () => {
    /** 为取消用例建立独立连接。 */
    const probe = await openProbe();
    await probe.until((event) => event.type === 'session.ready');
    /** 等到首个增量后取消，确认可中止实际发送流程。 */
    const requestId = randomUUID();
    probe.socket.send(
      JSON.stringify({ event: 'diagnostic.start', data: { requestId, message: '停止测试' } }),
    );
    await probe.until((event) => event.type === 'message.delta');
    /** 发送与当前连接运行精确匹配的取消命令。 */
    probe.socket.send(JSON.stringify({ event: 'run.cancel', data: { requestId } }));
    await probe.until((event) => event.type === 'run.cancelled');
    /** 取消终态必须是收到的最后一个事件且不存在成功终态。 */
    expect(probe.events.at(-1)?.type).toBe('run.cancelled');
    expect(probe.events.some((event) => event.type === 'run.completed')).toBe(false);
    /** 结束取消验证。 */
  });
  /** 不合法请求不能触发任何工具或回显任意参数。 */
  it('拒绝格式错误的运行请求', async () => {
    const probe = await openProbe();
    await probe.until((event) => event.type === 'session.ready');
    probe.socket.send(
      JSON.stringify({ event: 'diagnostic.start', data: { requestId: 'not-a-uuid', message: '' } }),
    );
    const failed = await probe.until((event) => event.type === 'run.failed');
    expect(failed.type === 'run.failed' && failed.payload.code).toBe('INVALID_REQUEST');
    expect(probe.events.some((event) => event.type === 'tool.started')).toBe(false);
  });
  /** 不允许非白名单网页在用户浏览器中使用本机诊断服务。 */
  it('拒绝未授权网页来源', async () => {
    const probe = await openProbe('https://untrusted.example');
    const code = await new Promise<number>((resolve) => probe.socket.once('close', resolve));
    expect(code).toBe(1008);
    expect(probe.events).toHaveLength(0);
  });
  /** 结束端到端测试。 */
});
