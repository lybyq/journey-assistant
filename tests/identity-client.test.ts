/** @vitest-environment jsdom */
/** 只模拟HTTP边界，保持真实身份状态与响应schema执行。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/** 每个用例重新加载模块，隔离内存令牌和刷新Promise。 */
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
/** 测试结束恢复网络全局，避免影响真实API集成测试。 */
afterEach(() => {
  vi.unstubAllGlobals();
});
/** 生成合法公开认证数据，令牌只作为测试哨兵。 */
const identity = (id = 'ec782c43-e687-457f-a41a-b1e322fe1f74') => ({
  user: {
    id,
    email: 'test@example.invalid',
    displayName: '测试用户',
    createdAt: new Date().toISOString(),
  },
  accessToken: 'memory-only-test-token',
  expiresIn: 900,
});
/** 身份竞态必须通过行为断言验证，不能只检查变量是否存在。 */
describe('浏览器身份边界', () => {
  /** 长流和普通请求采用相同账户隔离，退出后不能消费迟到响应。 */
  it('实时流拒绝退出前发起的迟到响应', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const client = await import('../apps/web/src/services/http-client');
    client.acceptIdentity(identity());
    const pending = client.authenticatedStream(
      '/conversations/test/events?after=0',
      new AbortController().signal,
    );
    client.clearIdentity();
    finish(new Response(': heartbeat\n\n', { status: 200 }));
    await expect(pending).rejects.toThrow('账户状态已变化');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  /** 请求地址不包含访问凭据，只能通过Authorization头发送。 */
  it('实时流在请求头附带凭据且不持久化令牌', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(': connected\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const client = await import('../apps/web/src/services/http-client');
    client.acceptIdentity(identity());
    const signal = new AbortController().signal;
    const response = await client.authenticatedStream(
      '/conversations/test/events?after=10',
      signal,
    );
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0]?.[0]).not.toContain('memory-only-test-token');
    expect(fetcher.mock.calls[0]?.[1].headers.Authorization).toBe('Bearer memory-only-test-token');
    expect(localStorage.length + sessionStorage.length).toBe(0);
    await response.body?.cancel();
  });
  /** 用户和访问凭据只进入内存，不写浏览器长期或会话存储。 */
  it('不把访问令牌持久化到浏览器存储', async () => {
    const client = await import('../apps/web/src/services/http-client');
    client.acceptIdentity(identity());
    expect(client.currentUser.value?.displayName).toBe('测试用户');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  /** 两个同时到来的401只允许消费同一个刷新Cookie一次。 */
  it('合并同一标签页并发刷新', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(identity()), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const client = await import('../apps/web/src/services/http-client');
    await Promise.all([client.refreshIdentity(), client.refreshIdentity()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  /** 旧刷新响应不能覆盖用户刚登录的另一个账户。 */
  it('拒绝账户切换前发起的迟到刷新', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const client = await import('../apps/web/src/services/http-client');
    const refreshing = client.refreshIdentity();
    client.acceptIdentity(identity('ac782c43-e687-457f-a41a-b1e322fe1f74'));
    finish(new Response(JSON.stringify(identity()), { status: 200 }));
    await expect(refreshing).rejects.toThrow('账户状态已变化');
    expect(client.currentUser.value?.id).toBe('ac782c43-e687-457f-a41a-b1e322fe1f74');
  });
  /** 退出后收到旧请求401不能自动刷新把用户重新登录。 */
  it('退出后不自动重试旧的受保护请求', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const client = await import('../apps/web/src/services/http-client');
    client.acceptIdentity(identity());
    const pending = client.authenticatedRequest('/me');
    client.clearIdentity();
    finish(new Response(JSON.stringify({ message: '已退出' }), { status: 401 }));
    await expect(pending).rejects.toThrow('账户状态已变化');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.currentUser.value).toBeNull();
  });
  /** 结束浏览器身份边界测试。 */
});
