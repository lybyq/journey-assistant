/** 第二模块测试使用真实且独立的PostgreSQL数据库，不污染开发数据。 */
import { Pool } from 'pg';
/** Redis测试只清理随机命名空间，不使用FLUSHDB。 */
import { createClient } from 'redis';
/** 真实API子进程保留Nest装饰器元数据。 */
import { spawn, type ChildProcess } from 'node:child_process';
/** 随机命名与JWT边界测试使用Node密码学工具。 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
/** 使用真实HTTP断言而非mock身份服务。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
/** 认证响应采用网页共同使用的schema。 */
import { authResponseSchema, type AuthResponse } from '@journey/contracts';
/** 随机数据库名被严格限制为本测试自己的资源。 */
const databaseName = `journey_identity_test_${randomUUID().replaceAll('-', '')}`;
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
  const script = `import { createApplication } from ${JSON.stringify(bootstrap)}; const app=await createApplication({logger:false}); await app.listen(0,'127.0.0.1'); console.log('IDENTITY_TEST:'+await app.getUrl());`;
  /** 显式设置存储配置，覆盖开发环境文件但不修改文件。 */
  server = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, NODE_ENV: 'test', STORAGE_ENABLED: 'true', DATABASE_URL: testUrl.href, REDIS_URL: redisUrl, REDIS_PREFIX: prefix, AUTH_SECRET: secret, ENABLE_DIAGNOSTICS: 'false', CORS_ORIGINS: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] });
  /** 只有实际监听后才允许发送测试请求。 */
  base = await new Promise<string>((resolve, reject) => { let output = ''; let errors = ''; const timer = setTimeout(() => reject(new Error('身份测试服务启动超时')), 15000); server.stderr?.on('data', (chunk) => { errors += String(chunk); }); server.stdout?.on('data', (chunk) => { output += String(chunk); const match = /IDENTITY_TEST:(http:\/\/[^\s]+)/.exec(output); if (match?.[1]) { clearTimeout(timer); resolve(match[1]); } }); server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`身份测试服务退出：${code} ${errors}`)); }); server.once('error', (error) => { clearTimeout(timer); reject(error); }); });
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
  if (!/^journey_identity_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('拒绝清理不安全的测试数据库名');
  /** 只移除本测试随机创建的数据库。 */
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); await admin.end();
/** 结束测试资源回收。 */
}, 15000);
/** 按真实用户流程验证身份、持久化与数据隔离。 */
describe('第二模块真实数据验收', () => {
  /** 就绪状态必须来自真实数据库和Redis探针。 */
  it('数据服务真实就绪并完成一次迁移', async () => { const response = await request('/system/storage'); expect(await response.json()).toEqual({ enabled: true, postgres: 'ready', redis: 'ready' }); const rows = await db.query('SELECT name FROM journey_migrations'); expect(rows.rows).toHaveLength(2); });
  /** 没有认证时不能访问任何用户私有数据。 */
  it('匿名请求不能读取账户或会话', async () => { expect((await request('/me')).status).toBe(401); expect((await request('/conversations')).status).toBe(401); });
  /** CSRF边界在执行密码派生和业务写入前拒绝请求。 */
  it('缺少客户端头或跨站来源时拒绝注册', async () => { const body = { email: 'blocked@example.invalid', password, displayName: '不应创建' }; expect((await request('/auth/register', { method: 'POST', body, client: false })).status).toBe(403); expect((await request('/auth/register', { method: 'POST', body, origin: 'https://untrusted.example' })).status).toBe(403); });
  /** 注册必须落库摘要，并将刷新秘密限制在HttpOnly Cookie。 */
  it('注册两个独立账户且不泄漏凭据', async () => {
    /** Alice和Bob的邮箱均属于保留的测试域名。 */
    const a = await request('/auth/register', { method: 'POST', body: { email: 'ALICE@example.invalid', password, displayName: 'Alice旅行测试' } }); const b = await request('/auth/register', { method: 'POST', body: { email: 'bob@example.invalid', password, displayName: 'Bob旅行测试' } });
    /** 成功结果必须通过实际网页使用的schema。 */
    expect(a.status).toBe(201); expect(b.status).toBe(201); alice = authResponseSchema.parse(await a.json()); bob = authResponseSchema.parse(await b.json()); aliceCookie = cookie(a); bobCookie = cookie(b);
    /** Cookie防止JS读取且不随不相关API请求发送。 */
    expect(a.headers.get('set-cookie')).toContain('HttpOnly'); expect(a.headers.get('set-cookie')).toContain('SameSite=Strict'); expect(a.headers.get('set-cookie')).toContain('Path=/api/v1/auth'); expect(alice.user.email).toBe('alice@example.invalid');
    /** 数据库密码和刷新令牌都必须是单向摘要。 */
    const stored = await db.query('SELECT password_hash FROM credentials WHERE user_id=$1', [alice.user.id]); expect(stored.rows[0].password_hash).toMatch(/^scrypt\$32768\$8\$3\$/); expect(stored.rows[0].password_hash).not.toContain(password); const tokens = await db.query('SELECT token_hash FROM refresh_tokens'); expect(tokens.rows.every((entry) => /^[a-f0-9]{64}$/.test(entry.token_hash))).toBe(true); expect(JSON.stringify(alice)).not.toContain('passwordHash'); expect(JSON.stringify(alice)).not.toContain(aliceCookie);
  /** 结束注册验证。 */
  });
  /** 规范化唯一邮箱和严格请求字段在并发边界仍有效。 */
  it('拒绝重复邮箱与伪造所有者字段', async () => { expect((await request('/auth/register', { method: 'POST', body: { email: 'alice@example.invalid', password, displayName: '重复' } })).status).toBe(409); expect((await request('/conversations', { method: 'POST', token: alice.accessToken, body: { title: '伪造', userId: bob.user.id } })).status).toBe(400); });
  /** 资料读取和更新只由可信actor决定归属。 */
  it('旅行偏好互相隔离且显示名可持久化', async () => { const changed = await request('/me/profile', { method: 'PATCH', token: alice.accessToken, body: { homeCity: '杭州', preferredMode: 'driving', pace: 'relaxed' } }); expect(changed.status).toBe(200); const own = await request('/me', { method: 'PATCH', token: alice.accessToken, body: { displayName: 'Alice已保存' } }); expect((await own.json()).displayName).toBe('Alice已保存'); expect((await (await request('/me/profile', { token: bob.accessToken })).json()).homeCity).toBe(''); expect((await request('/me/profile', { method: 'PATCH', token: alice.accessToken, body: { userId: bob.user.id, homeCity: '伪造' } })).status).toBe(400); });
  /** 已知UUID不是访问权限，读、改、分页游标都必须校验所有者。 */
  it('另一个用户无法读取、修改或用游标探测会话', async () => { const created = await request('/conversations', { method: 'POST', token: alice.accessToken, body: { title: '杭州周末旅行' } }); const body = await created.json(); conversationId = body.id; expect(created.status).toBe(201); expect((await request(`/conversations/${conversationId}`, { token: bob.accessToken })).status).toBe(404); expect((await request(`/conversations/${conversationId}`, { method: 'PATCH', token: bob.accessToken, body: { archived: true } })).status).toBe(404); expect((await request(`/conversations?cursor=${conversationId}`, { token: bob.accessToken })).status).toBe(404); expect((await (await request('/conversations', { token: bob.accessToken })).json()).items).toEqual([]); });
  /** 归档可恢复，不破坏会话数据。 */
  it('支持会话改名、归档与恢复', async () => { expect((await request(`/conversations/${conversationId}`, { method: 'PATCH', token: alice.accessToken, body: { title: '已改名旅行', archived: true } })).status).toBe(200); const active = await (await request('/conversations', { token: alice.accessToken })).json(); const archived = await (await request('/conversations?archived=true', { token: alice.accessToken })).json(); expect(active.items).toEqual([]); expect(archived.items[0].title).toBe('已改名旅行'); await request(`/conversations/${conversationId}`, { method: 'PATCH', token: alice.accessToken, body: { archived: false } }); });
  /** 重启服务器验证实际持久化，并再次执行迁移检测幂等性。 */
  it('服务重启后账户、资料、会话与登录仍有效', async () => { await stopServer(); await startServer(); expect((await request('/me', { token: alice.accessToken })).status).toBe(200); expect((await (await request('/me/profile', { token: alice.accessToken })).json()).homeCity).toBe('杭州'); expect((await (await request(`/conversations/${conversationId}`, { token: alice.accessToken })).json()).title).toBe('已改名旅行'); expect((await db.query('SELECT name FROM journey_migrations')).rows).toHaveLength(2); }, 20000);
  /** 每次刷新改变Cookie；旧秘密重放后新旧访问JWT都必须失效。 */
  it('刷新轮换并检测重放，撤销事务不会回滚', async () => { const oldCookie = aliceCookie; const response = await request('/auth/refresh', { method: 'POST', cookie: oldCookie }); expect(response.status).toBe(201); const renewed = authResponseSchema.parse(await response.json()); aliceCookie = cookie(response); expect(aliceCookie).not.toBe(oldCookie); expect((await request('/me', { token: renewed.accessToken })).status).toBe(200); expect((await request('/auth/refresh', { method: 'POST', cookie: oldCookie })).status).toBe(401); expect((await request('/me', { token: renewed.accessToken })).status).toBe(401); expect((await request('/auth/refresh', { method: 'POST', cookie: aliceCookie })).status).toBe(401); expect((await db.query("SELECT id FROM audit_events WHERE action='session.replay_rejected'")).rows).toHaveLength(1); });
  /** 登出服务端会话后，即使JWT未过期也不能继续访问。 */
  it('重新登录保留数据，退出立即撤销访问令牌', async () => { const response = await request('/auth/login', { method: 'POST', body: { email: 'alice@example.invalid', password } }); expect(response.status).toBe(201); alice = authResponseSchema.parse(await response.json()); aliceCookie = cookie(response); expect((await request(`/conversations/${conversationId}`, { token: alice.accessToken })).status).toBe(200); expect((await request('/auth/logout', { method: 'POST', cookie: aliceCookie })).status).toBe(201); expect((await request('/me', { token: alice.accessToken })).status).toBe(401); });
  /** 无效秘密不能仅凭猜到会话ID撤销别人的登录。 */
  it('伪造刷新秘密不影响其他有效会话', async () => { const raw = decodeURIComponent(bobCookie.split('=')[1] ?? ''); const fake = `journey_refresh=${raw.slice(0, 36)}.${'x'.repeat(43)}`; expect((await request('/auth/refresh', { method: 'POST', cookie: fake })).status).toBe(401); expect((await request('/me', { token: bob.accessToken })).status).toBe(200); });
  /** 即使签名正确，也必须校验JWT受众和到期时间。 */
  it('拒绝错误受众、过期与篡改的访问JWT', async () => { const [header, payload] = bob.accessToken.split('.'); const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()); for (const changes of [{ aud: 'another-app' }, { exp: 1 }]) { const encoded = Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url'); const signature = createHmac('sha256', secret).update(`${header}.${encoded}`).digest('base64url'); expect((await request('/me', { token: `${header}.${encoded}.${signature}` })).status).toBe(401); } expect((await request('/me', { token: `${bob.accessToken.slice(0, -8)}tampered` })).status).toBe(401); });
  /** 全设备退出后，该用户不同登录均被撤销而不影响其他用户。 */
  it('全部设备退出撤销同用户的所有会话', async () => { const login = await request('/auth/login', { method: 'POST', body: { email: 'bob@example.invalid', password } }); const second = authResponseSchema.parse(await login.json()); expect((await request('/auth/logout-all', { method: 'POST', token: bob.accessToken })).status).toBe(201); expect((await request('/me', { token: second.accessToken })).status).toBe(401); expect((await request('/auth/refresh', { method: 'POST', cookie: bobCookie })).status).toBe(401); });
  /** 无效请求同样消耗认证速率额度，且不会执行昂贵密码派生。 */
  it('认证请求通过真实Redis原子限流', async () => { let status = 0; for (let index = 0; index < 35; index += 1) { status = (await request('/auth/login', { method: 'POST', body: { email: 'invalid', password: '' } })).status; if (status === 429) break; } expect(status).toBe(429); });
/** 结束第二模块验收。 */
});
