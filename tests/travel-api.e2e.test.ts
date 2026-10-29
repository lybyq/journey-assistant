/** 真实Nest/HTTP/PostgreSQL/Redis验证归属、报价、版本与分享。 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
/** 每轮独立数据库、命名空间与签名密钥。 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
/** 测试启动编译后的真实服务，不依赖浏览器开发端口。 */
import { spawn, type ChildProcess } from 'node:child_process';
/** PostgreSQL与Redis使用本项目独立端口。 */
import { Pool } from 'pg';
/** 不清空共享Redis，只删除随机前缀。 */
import { createClient } from 'redis';
/** API结果在进入断言前经过共享schema。 */
import {
  authResponseSchema,
  tripWorkspaceSchema,
  planVersionSchema,
  type AuthResponse,
  type TripWorkspace,
  type CostItem,
  type PlanVersion,
} from '@journey/contracts';
/** 本测试不请求任何真实供应商。 */
const databaseName = `journey_travel_test_${randomUUID().replaceAll('-', '')}`;
const adminUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://journey:journey_local@127.0.0.1:55433/journey';
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const admin = new Pool({ connectionString: adminUrl });
const db = new Pool({ connectionString: testUrl.href });
const prefix = `travel_test_${randomUUID().replaceAll('-', '')}`;
const redisUrl = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379';
const redis = createClient({
  url: redisUrl,
  socket: { reconnectStrategy: false },
});
/** 账户完全属于本次随机数据库。 */
let server: ChildProcess;
let base = '';
let alice: AuthResponse;
let bob: AuthResponse;
let trip: TripWorkspace;
let version: PlanVersion;
let firstItem = '';
let sourceId = '';
let shareUrl = '';
let shareId = '';
/** 只打印固定启动前缀，禁止在失败日志中输出实际配置。 */
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${databaseName}`);
  redis.on('error', () => undefined);
  await redis.connect();
  const bootstrap = new URL('../apps/api/dist/bootstrap.js', import.meta.url).href;
  const script = `import {createApplication} from ${JSON.stringify(bootstrap)};const app=await createApplication({logger:false});await app.listen(0,'127.0.0.1');console.log('TRAVEL_READY:'+await app.getUrl());`;
  server = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STORAGE_ENABLED: 'true',
      DATABASE_URL: testUrl.href,
      REDIS_URL: redisUrl,
      REDIS_PREFIX: prefix,
      AUTH_SECRET: randomBytes(40).toString('base64url'),
      CHAT_EXECUTOR: 'diagnostic',
      MCP_SERVERS: '',
      AMADEUS_CLIENT_ID: '',
      AMADEUS_CLIENT_SECRET: '',
      TOUR_GATEWAY_URL: '',
      TOUR_GATEWAY_KEY: '',
      ENABLE_DIAGNOSTICS: 'false',
      PUBLIC_WEB_URL: 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('旅行测试API启动超时')), 20000);
    server.stdout?.on('data', (part) => {
      output += String(part);
      const match = /TRAVEL_READY:(http:\/\/[^\s]+)/.exec(output);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`旅行测试API退出${code}`));
    });
  });
}, 30000);
/** 清理仅针对本次明确命名的数据库和Redis键。 */
afterAll(async () => {
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      server.once('exit', () => resolve());
      server.kill();
    });
  await db.end();
  if (redis.isReady) {
    for await (const keys of redis.scanIterator({
      MATCH: `${prefix}:*`,
      COUNT: 100,
    }))
      if (keys.length) await redis.del(keys);
    redis.destroy();
  }
  if (!/^journey_travel_test_[a-f0-9]{32}$/.test(databaseName))
    throw new Error('拒绝清理其他数据库');
  await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  await admin.end();
}, 20000);
/** HTTP助手不输出Token和Cookie；所有私有访问使用Bearer。 */
function request(
  path: string,
  body?: unknown,
  token = alice?.accessToken,
  method = body === undefined ? 'GET' : 'POST',
) {
  return fetch(`${base}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-journey-client': 'web',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
}
/** 只在状态成功后更新本地测试快照。 */
async function update(path: string, body: unknown, method = 'POST') {
  const response = await request(`/trips/${trip.id}${path}`, body, alice.accessToken, method);
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  trip = tripWorkspaceSchema.parse(await response.json());
  return trip;
}
/** 人工估算条件来自已保存需求；未知字段仍为null。 */
function quote(label: string, category: CostItem['category'], amount: number): CostItem {
  const r = trip.document.request;
  return {
    id: randomUUID(),
    label,
    category,
    scopeKey: randomUUID(),
    priceType: 'estimate',
    unitAmountMinor: amount,
    currency: 'CNY',
    quantity: 1,
    unit: 'trip',
    required: true,
    selected: true,
    includes: [],
    provenance: 'manual',
    provider: '用户确认预算',
    sourceUrl: 'https://example.org/cost',
    evidenceIds: [sourceId],
    checkedAt: new Date().toISOString(),
    validUntil: null,
    conditions: {
      startDate: r.startDate,
      endDate: r.endDate,
      adults: r.adults,
      children: r.children,
      rooms: r.rooms,
      nights: r.nights,
      hotelStandard: r.hotelStandard,
      mandatoryFeesIncluded: true,
    },
    notes: '用户明确同意的估算，不是可订价格',
  };
}
/** 所有流程经真实身份边界与数据库事务执行。 */
describe('旅行服务生产HTTP链路', () => {
  /** 建立两个账户，后续验证不能跨账户读取或引用。 */
  it('创建账户、规范化需求并拒绝越权', async () => {
    for (const name of ['alice', 'bob']) {
      const response = await request(
        '/auth/register',
        {
          email: `${name}@example.invalid`,
          password: 'Travel-domain-test-password-2026!',
          displayName: name,
        },
        '',
      );
      expect(response.status).toBe(201);
      const auth = authResponseSchema.parse(await response.json());
      if (name === 'alice') alice = auth;
      else bob = auth;
    }
    const response = await request('/trips', {
      title: '学习验收旅行',
      text: '2026-11-01从杭州去苏州，两大零小，一天零晚，总预算1000元，自由行',
      request: {
        destinationTimeZone: 'Asia/Shanghai',
        rooms: 1,
        hotelStandard: '舒适型',
      },
      conversationId: null,
    });
    expect(response.status).toBe(201);
    trip = tripWorkspaceSchema.parse(await response.json());
    expect(trip.document.request).toMatchObject({
      adults: 2,
      children: 0,
      days: 1,
      nights: 0,
    });
    expect((await request(`/trips/${trip.id}`, undefined, bob.accessToken)).status).toBe(404);
    expect((await request(`/trips/${trip.id}`, undefined, '')).status).toBe(401);
  });
  /** 旧revision绝不覆盖已保存更改。 */
  it('并发修改只有一个CAS成功且拒绝未知字段', async () => {
    const responses = await Promise.all([
      request(
        `/trips/${trip.id}`,
        { revision: trip.revision, title: '新版A' },
        alice.accessToken,
        'PATCH',
      ),
      request(
        `/trips/${trip.id}`,
        { revision: trip.revision, title: '新版B' },
        alice.accessToken,
        'PATCH',
      ),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    trip = tripWorkspaceSchema.parse(await (await request(`/trips/${trip.id}`)).json());
    expect(
      (
        await request(
          `/trips/${trip.id}`,
          { revision: trip.revision, userId: bob.user.id },
          alice.accessToken,
          'PATCH',
        )
      ).status,
    ).toBe(400);
  });
  /** 缺供应商不返回预制库存；外部查询在未启用状态安全失败。 */
  it('供应商未授权时明确失败，不制造酒店和团产品', async () => {
    expect(
      (
        await request(`/trips/${trip.id}/transport/flights`, {
          revision: trip.revision,
          input: {
            originCode: 'HGH',
            destinationCode: 'SHA',
            returnDate: null,
          },
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await request(`/trips/${trip.id}/tours/search`, {
          revision: trip.revision,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await request(`/trips/${trip.id}/research`, {
          revision: trip.revision,
          input: { query: '苏州博物馆官方', extract: true, refresh: false },
        })
      ).status,
    ).toBe(503);
    trip = tripWorkspaceSchema.parse(await (await request(`/trips/${trip.id}`)).json());
    expect(trip.document.transport).toHaveLength(0);
    expect(trip.document.tours).toHaveLength(0);
  });
  /** 保存可核实公共来源，摘录和查询时间不能混为一谈。 */
  it('保存人工证据并拒绝内网来源', async () => {
    expect(
      (
        await request(`/trips/${trip.id}/research/manual`, {
          revision: trip.revision,
          input: {
            url: 'http://127.0.0.1/private',
            title: '不允许',
            excerpt: 'test',
            publishedAt: null,
            claims: [],
          },
        })
      ).status,
    ).toBe(400);
    await update('/research/manual', {
      revision: trip.revision,
      input: {
        url: 'https://example.org/official?tracking=1',
        title: '用户核对的公开资料',
        excerpt: '开放09:00至17:00，票务需另确认',
        publishedAt: null,
        claims: [],
      },
    });
    sourceId = trip.document.evidence[0]!.id;
    expect(trip.document.evidence[0]!.url).toBe('https://example.org/official');
    expect(trip.document.evidence[0]!.kind).toBe('manual');
  });
  /** 模型和浏览器不能提交一份自称live_quote的人工价格。 */
  it('拒绝人工供应商身份、跨项目来源与费用篡改', async () => {
    const invalid = {
      ...quote('伪实时', 'transport', 100),
      provenance: 'supplier',
      priceType: 'live_quote',
      validUntil: new Date(Date.now() + 60000).toISOString(),
    };
    expect(
      (
        await request(`/trips/${trip.id}/pricing/items`, {
          revision: trip.revision,
          input: invalid,
        })
      ).status,
    ).toBe(400);
    const foreign = {
      ...quote('外部来源', 'meal', 100),
      evidenceIds: [randomUUID()],
    };
    expect(
      (
        await request(`/trips/${trip.id}/pricing/items`, {
          revision: trip.revision,
          input: foreign,
        })
      ).status,
    ).toBe(400);
    for (const item of [quote('交通全程', 'transport', 20000), quote('餐费全程', 'meal', 10000)])
      await update('/pricing/items', { revision: trip.revision, input: item });
    const tampered = trip.document.costs.map((item) => ({
      ...item,
      unitAmountMinor: 1,
    }));
    expect(
      (
        await request(
          `/trips/${trip.id}/pricing`,
          {
            revision: trip.revision,
            costs: tampered,
            rates: [],
            reserveBps: 1000,
          },
          alice.accessToken,
          'PUT',
        )
      ).status,
    ).toBe(400);
    const budget = await (await request(`/trips/${trip.id}/pricing`)).json();
    expect(budget.knownTotalMinor).toBe(30000);
    expect(budget.totalWithReserveMinor).toBe(33000);
  });
  /** 活动绑定真实候选和证据后进入行程验证。 */
  it('保存核实地点并创建有报价快照的不可变版本', async () => {
    const id = randomUUID();
    await update('/experiences/manual', {
      revision: trip.revision,
      input: {
        id,
        kind: 'attraction',
        name: '核实地点',
        point: { lng: 120.6, lat: 31.3, coordinateSystem: 'GCJ-02' },
        address: '公共景点',
        opening: [{ dayOfWeek: 0, open: '09:00', close: '17:00' }],
        closedDates: [],
        reservation: 'not_required',
        accessible: true,
        childPolicy: '无儿童',
        cancellation: '无预付费用',
        breakfastIncluded: null,
        evidenceIds: [sourceId],
        quote: null,
        notes: '用户已核对',
      },
    });
    const item = {
      id: randomUUID(),
      title: '核实地点',
      kind: 'visit',
      startMinute: 540,
      endMinute: 630,
      point: { lng: 120.6, lat: 31.3, coordinateSystem: 'GCJ-02' },
      referenceId: id,
      evidenceIds: [sourceId],
      costIds: [],
      travelBeforeMinutes: 0,
      walkMinutes: 30,
      driveMinutes: 0,
      reservationConfirmed: false,
      notes: '公开地点',
    };
    firstItem = item.id;
    const response = await request(`/trips/${trip.id}/plans`, {
      revision: trip.revision,
      draft: {
        title: '第一版',
        mode: 'independent',
        timeZone: 'Asia/Shanghai',
        days: [{ date: '2026-11-01', items: [item] }],
        costIds: trip.document.costs.map((cost) => cost.id),
        assumptions: ['仅用户确认估算，不是库存承诺'],
      },
    });
    expect(response.status).toBe(201);
    version = planVersionSchema.parse(await response.json());
    expect(version.version).toBe(1);
    expect(version.prices).toHaveLength(2);
    expect(version.sources).toHaveLength(1);
    expect(version.comparisonKey).toHaveLength(64);
    expect(
      (await request(`/trips/${trip.id}/plans/${version.id}`, undefined, bob.accessToken)).status,
    ).toBe(404);
    trip = tripWorkspaceSchema.parse(await (await request(`/trips/${trip.id}`)).json());
  });
  /** 局部调整另存版本，旧内容可再次读取且没有被覆盖。 */
  it('局部调整、回退与同口径比较保留旧版本', async () => {
    const original = version;
    const replacement = {
      ...version.draft.days[0]!.items[0]!,
      startMinute: 600,
      endMinute: 690,
    };
    const response = await request(`/trips/${trip.id}/plans/replace`, {
      revision: trip.revision,
      input: {
        baseVersionId: version.id,
        itemId: firstItem,
        replacement,
        reason: '用户调整开始时间',
      },
    });
    expect(response.status).toBe(201);
    version = planVersionSchema.parse(await response.json());
    expect(version.version).toBe(2);
    expect(version.parentId).toBe(original.id);
    const old = planVersionSchema.parse(
      await (await request(`/trips/${trip.id}/plans/${original.id}`)).json(),
    );
    expect(old.draft.days[0]?.items[0]?.startMinute).toBe(540);
    trip = tripWorkspaceSchema.parse(await (await request(`/trips/${trip.id}`)).json());
    await update(`/plans/${original.id}/activate`, { revision: trip.revision });
    expect(trip.activeVersionId).toBe(original.id);
    const comparison = await (
      await request(`/trips/${trip.id}/plans/compare`, {
        versionIds: [original.id, version.id],
      })
    ).json();
    expect(comparison.rows).toHaveLength(2);
    expect(comparison.differences[0].changedDays).toEqual(['2026-11-01']);
  });
  /** 分享固定版本，即使当前指针切换，匿名读取仍是创建时的版本。 */
  it('分享只存摘要、固定版本、撤销后立即拒绝匿名读取', async () => {
    const response = await request(`/trips/${trip.id}/delivery/shares`, {
      versionId: version.id,
      expiresInHours: 1,
    });
    expect(response.status).toBe(201);
    const share = await response.json();
    shareUrl = share.url;
    shareId = share.id;
    const token = shareUrl.split('#')[1]!;
    const stored = await db.query('SELECT token_hash FROM trip_shares WHERE id=$1', [shareId]);
    expect(stored.rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored.rows)).not.toContain(token);
    const resolved = await request('/shared/resolve', { token }, '');
    expect(resolved.status).toBe(201);
    const data = await resolved.json();
    expect(data.version.id).toBe(version.id);
    expect(JSON.stringify(data)).not.toContain(alice.user.email);
    expect(
      (await request(`/trips/${trip.id}/delivery/shares/${shareId}/revoke`, {}, bob.accessToken))
        .status,
    ).toBe(404);
    expect((await request(`/trips/${trip.id}/delivery/shares/${shareId}/revoke`, {})).status).toBe(
      201,
    );
    expect((await request('/shared/resolve', { token }, '')).status).toBe(404);
  });
  /** PDF是真二进制且中文字体嵌入，Markdown包含来源和待确认说明。 */
  it('导出真实Markdown与中文PDF，并保留版本报价条件', async () => {
    const markdown = await request(`/trips/${trip.id}/delivery/${version.id}/markdown`);
    expect(markdown.status).toBe(200);
    const text = await markdown.text();
    expect(text).toContain('公开来源');
    expect(text).toContain('https://example.org/official');
    const pdf = await request(`/trips/${trip.id}/delivery/${version.id}/pdf`);
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(3000);
  });
  /** 归档与恢复都保留资料，归档分享不能继续读取。 */
  it('归档阻止修改，恢复保留版本并提供当前用户指标', async () => {
    await update('', { revision: trip.revision, archived: true }, 'PATCH');
    expect(
      (
        await request(
          `/trips/${trip.id}`,
          { revision: trip.revision, title: '禁止改写' },
          alice.accessToken,
          'PATCH',
        )
      ).status,
    ).toBe(400);
    await update('', { revision: trip.revision, archived: false }, 'PATCH');
    expect(trip.versions).toHaveLength(2);
    const metrics = await (await request('/travel/metrics')).json();
    expect(metrics.windowHours).toBe(24);
    expect(metrics.operations.some((row: any) => row.status === 'failed')).toBe(true);
    const migrations = await db.query('SELECT name FROM journey_migrations');
    expect(migrations.rows).toHaveLength(4);
  });
});
