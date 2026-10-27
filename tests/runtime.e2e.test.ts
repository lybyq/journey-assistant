/** 第三模块测试使用真实且独立的PostgreSQL数据库，不污染开发数据。 */
import { Pool } from 'pg';
/** Redis测试只清理随机命名空间，不使用FLUSHDB。 */
import { createClient } from 'redis';
/** 真实API子进程保留Nest装饰器元数据。 */
import { spawn, type ChildProcess } from 'node:child_process';
/** 随机命名与JWT边界测试使用Node密码学工具。 */
import { randomBytes, randomUUID } from 'node:crypto';
/** 使用真实HTTP断言而非mock身份服务。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
/** 认证响应采用网页共同使用的schema。 */
import { conversationSnapshotSchema, startRunResponseSchema, serverEventSchema, type ServerEvent, authResponseSchema, type AuthResponse } from '@journey/contracts';
/** 随机数据库名被严格限制为本测试自己的资源。 */
const databaseName = `journey_runtime_test_${randomUUID().replaceAll('-', '')}`;
/** 测试数据库连接可显式配置，默认使用本项目独立容器。 */
const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgresql://journey:journey_local@127.0.0.1:55433/journey';
/** 管理连接只创建和清理严格命名的测试数据库。 */
const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
/** 测试客户端仅访问专属数据库。 */
const testUrl = new URL(adminUrl); testUrl.pathname = `/${databaseName}`;
/** 直接数据库查询只用于断言摘要、审计和持久化行为。 */
const db = new Pool({ connectionString: testUrl.href });
/** 缓存键有每次运行独立前缀。 */
const prefix = `test_${randomUUID().replaceAll('-', '')}`;
/** 测试Redis使用本项目独立端口，不连接其他项目缓存。 */
const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379'; const cache = createClient({ url: redisUrl, socket: { reconnectStrategy: false, connectTimeout: 5000 } });
/** 测试秘密只在本进程和子进程内存中使用。 */
const secret = randomBytes(48).toString('base64url'); const password = 'A-long-test-passphrase-2026!';
/** 保留当前测试服务器及监听地址。 */
let server: ChildProcess; let base = '';
/** 保存两个独立认证上下文来验证跨用户隔离。 */
let alice: AuthResponse; let bob: AuthResponse; let aliceCookie = ''; let bobCookie = ''; let conversationId = '';
/** 在随机端口启动服务，初始化会自动验证迁移账本。 */
async function startServer(): Promise<void> {
  /** 用文件URL导入编译产物，兼容空格和中文路径。 */
  const bootstrap = new URL('../apps/api/dist/bootstrap.js', import.meta.url).href;
  /** 测试不暴露公网，也不调用模型或MCP。 */
  const script = `import { createApplication } from ${JSON.stringify(bootstrap)}; const app=await createApplication({logger:false}); await app.listen(0,'127.0.0.1'); console.log('RUNTIME_TEST:'+await app.getUrl());`;
  /** 显式设置存储配置，覆盖开发环境文件但不修改文件。 */
  server = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_ENV: 'test', STORAGE_ENABLED: 'true', DATABASE_URL: testUrl.href, REDIS_URL: redisUrl, REDIS_PREFIX: prefix, AUTH_SECRET: secret, ENABLE_DIAGNOSTICS: 'false', CORS_ORIGINS: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  /** 只有实际监听后才允许发送测试请求。 */
  base = await new Promise<string>((resolve, reject) => { let output = ''; let errors = ''; const timer = setTimeout(() => reject(new Error('身份测试服务启动超时')), 15000); server.stderr?.on('data', (chunk) => { errors += String(chunk); }); server.stdout?.on('data', (chunk) => { output += String(chunk); const match = /RUNTIME_TEST:(http:\/\/[^\s]+)/.exec(output); if (match?.[1]) { clearTimeout(timer); resolve(match[1]); } }); server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`身份测试服务退出：${code} ${errors}`)); }); server.once('error', (error) => { clearTimeout(timer); reject(error); }); });
/** 结束真实服务启动。 */
}
/** 每次服务重启都等待进程退出后再继续访问数据库。 */
async function stopServer(): Promise<void> { if (!server || server.exitCode !== null) return; await new Promise<void>((resolve) => { server.once('exit', () => resolve()); server.kill(); }); }
/** 封装HTTP请求；Cookie仅在测试中作为原始头传递以验证安全标志。 */
function request(path: string, options: { method?: string; body?: unknown; token?: string; cookie?: string; origin?: string; client?: boolean } = {}): Promise<Response> { return fetch(`${base}/api/v1${path}`, { method: options.method ?? 'GET', headers: { 'Content-Type': 'application/json', ...(options.client === false ? {} : { 'x-journey-client': 'web' }), ...(options.origin ? { Origin: options.origin } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) }, ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(12000) }); }
/** 仅提取刷新Cookie键值，不把Cookie打印到测试输出。 */
function cookie(response: Response): string { return response.headers.get('set-cookie')?.split(';')[0] ?? ''; }
/** 先建立独立测试数据库与Redis连接。 */
beforeAll(async () => { await admin.query(`CREATE DATABASE ${databaseName}`); cache.on('error', () => undefined); await cache.connect(); await startServer(); }, 20000);
/** 清理仅属于本次测试的资源，绝不清空开发数据库或共享Redis。 */
afterAll(async () => {
  /** 服务必须先退出，防止连接阻止测试数据库清理。 */
  await stopServer(); await db.end();
  /** 随机前缀扫描仅删除本次测试的认证计数键。 */
  if (cache.isReady) { for await (const keys of cache.scanIterator({ MATCH: `${prefix}:*`, COUNT: 100 })) { if (keys.length) await cache.del(keys); } cache.destroy(); }
  /** 删除前再次检查生成名称边界，不能接受任意环境变量作为删除目标。 */
  if (!/^journey_runtime_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('拒绝清理不安全的测试数据库名');
  /** 只移除本测试随机创建的数据库。 */
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.end();
/** 结束测试资源回收。 */
}, 15000);
/** 轮询真实持久化状态，等待语义条件而不是猜测固定执行时长。 */
async function waitFor(check: () => Promise<boolean>, timeout = 10000): Promise<void> { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('未等到持久化条件'); }
/** 读取当前用户的一致性消息与事件快照。 */
async function snapshot(id = conversationId, token = alice.accessToken, query = '') { const response = await request(`/conversations/${id}/messages${query}`, { token }); expect(response.status).toBe(200); return conversationSnapshotSchema.parse(await response.json()); }
/** 提交真实自检运行，所有请求均经身份和归属检查。 */
async function start(message: string, requestId = randomUUID(), id = conversationId) { const response = await request(`/conversations/${id}/runs`, { token: alice.accessToken, method: 'POST', body: { message, requestId } }); expect(response.status).toBe(201); return startRunResponseSchema.parse(await response.json()).run; }
/** 收集真实SSE，达到目标后主动断开；取消连接不会取消任务。 */
async function stream(after: number, until: (events: ServerEvent[]) => boolean, token = alice.accessToken): Promise<{ events: ServerEvent[]; heartbeat: boolean }> {
  /** 每个测试流只有一个独立中止句柄。 */
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000); const events: ServerEvent[] = []; let heartbeat = false;
  /** 按实际帧读取，兼容JSON跨网络块。 */
  try { const response = await fetch(`${base}/api/v1/conversations/${conversationId}/events?after=${after}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store'); const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = ''; while (!until(events)) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); let end; while ((end = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (frame.startsWith(': heartbeat')) heartbeat = true; const data = frame.split('\n').find((line) => line.startsWith('data: ')); if (data) events.push(serverEventSchema.parse(JSON.parse(data.slice(6)))); } } return { events, heartbeat }; }
  /** 只释放本测试连接，不影响执行器与其他用户。 */
  finally { clearTimeout(timer); controller.abort(); }
/** 结束真实流探针。 */
}
/** 覆盖身份隔离、重放一致性与真实任务生命周期。 */
describe('第三模块持久化运行验收', () => {
  /** 注册独立用户并创建真实归属会话。 */
  it('准备两个独立账户和会话', async () => { for (const name of ['alice','bob']) { const response = await request('/auth/register', { method: 'POST', body: { email: `${name}@example.invalid`, password, displayName: `${name}运行验收` } }); const auth = authResponseSchema.parse(await response.json()); if (name === 'alice') { alice = auth; aliceCookie = cookie(response); } else { bob = auth; bobCookie = cookie(response); } } const response = await request('/conversations', { method: 'POST', token: alice.accessToken, body: { title: '持久化旅行对话' } }); conversationId = (await response.json()).id; expect((await snapshot()).items).toEqual([]); });
  /** HTTP、历史、流和取消都要求当前有效用户且不能越权。 */
  it('拒绝匿名、跨用户、伪造字段与未来游标', async () => { expect((await request(`/conversations/${conversationId}/messages`)).status).toBe(401); for (const suffix of ['messages','events']) expect((await request(`/conversations/${conversationId}/${suffix}`, { token: bob.accessToken })).status).toBe(404); expect((await request(`/conversations/${conversationId}/runs`, { method: 'POST', token: bob.accessToken, body: { requestId: randomUUID(), message: '越权' } })).status).toBe(404); expect((await request(`/conversations/${conversationId}/runs`, { method: 'POST', token: alice.accessToken, body: { requestId: randomUUID(), message: '注入', userId: bob.user.id } })).status).toBe(400); expect((await request(`/conversations/${conversationId}/events?after=999`, { token: alice.accessToken })).status).toBe(400); });
  /** 流关闭后运行继续完成，重连仅补发最后序号之后的事件。 */
  it('真实工具流可断线补发且消息正文不重复', async () => {
    /** 启动并等待至少收到一个正文增量再断线。 */
    const run = await start('杭州三天两晚，验证断线恢复'); const first = await stream(0, (events) => events.some((event) => event.type === 'message.delta')); expect(first.heartbeat).toBe(true); const cursor = first.events.at(-1)!.sequence;
    /** 连接断开不取消执行器，补发最终能收到成功终态。 */
    const replay = await stream(cursor, (events) => events.some((event) => event.type === 'run.completed')); const events = [...first.events, ...replay.events]; expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1)); expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    /** 已保存正文必须和所有增量恰好一致。 */
    const saved = await snapshot(); const text = events.filter((event) => event.type === 'message.delta').map((event) => event.payload.content).join(''); expect(saved.items).toHaveLength(2); expect(saved.items.find((item) => item.role === 'assistant')!.content).toBe(text); expect(saved.run?.id).toBe(run.id); expect(saved.run?.status).toBe('completed'); expect(saved.sequence).toBe(events.length); expect(saved.events.filter((event) => ['run.completed','run.failed','run.cancelled'].includes(event.type))).toHaveLength(1); const tool = saved.events.find((event) => event.type === 'tool.completed'); expect(tool?.type === 'tool.completed' && tool.payload.output.runtime).toBe(process.version);
  /** 结束真实重放验证。 */
  });
  /** 重试同一请求ID不会再次执行，也不能修改原始输入。 */
  it('请求重试幂等且每用户并发配额生效', async () => { const requestId = randomUUID(); const first = await start('取消与重试验证', requestId); const repeat = await start('取消与重试验证', requestId); expect(repeat.id).toBe(first.id); expect((await request(`/conversations/${conversationId}/runs`, { token: alice.accessToken, method: 'POST', body: { requestId, message: '篡改内容' } })).status).toBe(409); expect((await request(`/conversations/${conversationId}/runs`, { token: alice.accessToken, method: 'POST', body: { requestId: randomUUID(), message: '重复并发' } })).status).toBe(429); expect((await request(`/conversations/${conversationId}/runs/${first.id}/cancel`, { token: bob.accessToken, method: 'POST', body: {} })).status).toBe(404); await request(`/conversations/${conversationId}/runs/${first.id}/cancel`, { token: alice.accessToken, method: 'POST', body: {} }); await waitFor(async () => (await snapshot()).run?.status === 'cancelled'); const saved = await snapshot(); const size = saved.events.length; await new Promise((resolve) => setTimeout(resolve, 250)); expect((await snapshot()).events).toHaveLength(size); expect(saved.events.filter((event) => event.type === 'run.cancelled')).toHaveLength(1); expect(saved.events.some((event) => event.type === 'run.completed')).toBe(false); expect((await db.query('SELECT count(*)::int AS n FROM messages WHERE run_id=$1', [first.id])).rows[0].n).toBe(2); });
  /** 已取消运行再次取消也不能改成其他终态。 */
  it('取消幂等并保留多轮历史与稳定分页', async () => { const all = await snapshot(); const runId = all.run!.id; await request(`/conversations/${conversationId}/runs/${runId}/cancel`, { token: alice.accessToken, method: 'POST', body: {} }); const newest = await snapshot(conversationId, alice.accessToken, '?limit=2'); expect(newest.items).toHaveLength(2); expect(newest.nextCursor).toBeTruthy(); const older = await snapshot(conversationId, alice.accessToken, `?limit=2&before=${newest.nextCursor}`); expect(older.items).toHaveLength(2); expect(older.nextCursor).toBeNull(); expect(older.items[1]!.position).toBeLessThan(newest.items[0]!.position); expect(new Set([...older.items,...newest.items].map((item) => item.id)).size).toBe(4); const bobConversation = await request('/conversations', { method: 'POST', token: bob.accessToken, body: { title: '另一个会话' } }); const id = (await bobConversation.json()).id; expect((await request(`/conversations/${id}/messages?before=${newest.items[0]!.id}`, { token: bob.accessToken })).status).toBe(404); });
  /** 同账户三条连接上限由真实Redis原子执行。 */
  it('实时连接受共享配额限制并在关闭后回收', async () => { const controllers: AbortController[] = []; try { for (let index=0; index<3; index+=1) { const controller = new AbortController(); controllers.push(controller); const response = await fetch(`${base}/api/v1/conversations/${conversationId}/events?after=${(await snapshot()).sequence}`, { headers: { Authorization: `Bearer ${alice.accessToken}` }, signal: controller.signal }); expect(response.status).toBe(200); } expect((await request(`/conversations/${conversationId}/events`, { token: alice.accessToken })).status).toBe(429); } finally { for (const controller of controllers) controller.abort(); } await waitFor(async () => Number(await cache.zCard(`${prefix}:streams:${alice.user.id}`)) === 0); });
  /** 归档会话允许查历史，但不能执行新任务。 */
  it('归档会话拒绝新运行且不破坏历史', async () => { await request(`/conversations/${conversationId}`, { method: 'PATCH', token: alice.accessToken, body: { archived: true } }); expect((await request(`/conversations/${conversationId}/runs`, { method: 'POST', token: alice.accessToken, body: { requestId: randomUUID(), message: '不应执行' } })).status).toBe(409); expect((await snapshot()).items).toHaveLength(4); await request(`/conversations/${conversationId}`, { method: 'PATCH', token: alice.accessToken, body: { archived: false } }); });
  /** 模拟执行进程真正终止，重启后租约恢复器不能冒充成功重跑工具。 */
  it('进程中断后恢复唯一失败终态，已完成历史仍可读取', async () => { const run = await start('进程中断验收'); await stopServer(); await db.query('UPDATE runs SET lease_until=now()-interval \'1 second\' WHERE id=$1', [run.id]); await startServer(); await waitFor(async () => (await snapshot()).run?.status === 'failed'); const saved = await snapshot(); expect(saved.items).toHaveLength(6); expect(saved.events.filter((event) => event.type === 'run.failed')).toHaveLength(1); expect(saved.events.some((event) => event.type === 'run.completed')).toBe(false); expect((await db.query('SELECT name FROM journey_migrations')).rows).toHaveLength(2); }, 20000);
  /** 退出后流连接会关闭，已发出的JWT也不能继续读取历史。 */
  it('登出撤销长连接和活动任务', async () => { await start('退出时停止任务'); const controller = new AbortController(); const response = await fetch(`${base}/api/v1/conversations/${conversationId}/events?after=${(await snapshot()).sequence}`, { headers: { Authorization: `Bearer ${alice.accessToken}` }, signal: controller.signal }); const reader = response.body!.getReader(); await reader.read(); await request('/auth/logout', { method: 'POST', cookie: aliceCookie }); let done = false; const timer = setTimeout(() => controller.abort(), 5000); try { while (!done) done = (await reader.read()).done; } finally { clearTimeout(timer); controller.abort(); } expect(done).toBe(true); expect((await request(`/conversations/${conversationId}/messages`, { token: alice.accessToken })).status).toBe(401); await waitFor(async () => (await db.query('SELECT status FROM runs ORDER BY created_at DESC LIMIT 1')).rows[0].status === 'cancelled'); expect(bobCookie).toBeTruthy(); });
/** 结束第三模块真实资源验收。 */
});
