/** 安全边界纯函数不调用真实供应商。 */
import { describe, expect, it } from 'vitest';
/** MCP工具中心实际脱敏实现，不在测试里复制实现。 */
import { ToolSafety, isPublicUrl } from '../apps/api/src/modules/mcp/tool-safety.js';
/** 智能体编排只从公开text提取最终回答。 */
import { publicAnswer } from '../apps/api/dist/modules/agent/agent.service.js';
/** 检查隐藏推理、凭据和工具大输出边界。 */
describe('旅行服务公开输出边界', () => {
  /** 模型的reasoning字段与think标签不能作为答案公开。 */
  it('隐藏推理不会进入公开正文', () => {
    expect(
      publicAnswer([
        {
          type: 'reasoning',
          reasoning: '私密推理',
        },
        {
          type: 'text',
          text: '<think>隐藏推理</think>公开答案',
        },
      ]),
    ).toBe('公开答案');
    expect(publicAnswer('<analysis>未闭合内部过程')).toBe('');
  });
  /** 嵌套凭据、URL和实际密钥同时清理。 */
  it('清理嵌套秘密且不执行资源内容', () => {
    const safety = new ToolSafety(['test-private-secret']);
    const value = safety.result({
      api_key: 'another-secret',
      nested: {
        Authorization: 'Bearer abc',
        url: 'https://user:pass@example.org/path?key=test-private-secret#token',
      },
      content: 'value=test-private-secret',
    });
    const text = JSON.stringify(value);
    expect(text).not.toContain('test-private-secret');
    expect(text).not.toContain('another-secret');
    expect(text).not.toContain('user:pass');
    expect(text).not.toContain('?key');
    expect(value.untrusted).toBe(true);
  });
  /** 链接脱敏要保留Markdown闭合符，网页仍可正确渲染来源。 */
  it('链接脱敏保留Markdown结构', () => {
    expect(new ToolSafety([]).text('[来源](https://example.org/trip?key=private#token)')).toBe(
      '[来源](https://example.org/trip)',
    );
  });
  /** 巨大中文结构也不能突破持久化事件体积。 */
  it('巨量结果有界且明确标注截断', () => {
    const result = new ToolSafety([]).result(
      Array.from(
        {
          length: 100,
        },
        () => ({
          text: '中文'.repeat(10000),
        }),
      ),
    );
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(8000);
    expect(result.truncated).toBe(true);
  });
  /** 私有或认证链接不能交给抽取工具。 */
  it('抽取只允许公共HTTP来源', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://localhost/a',
      'http://127.0.0.1',
      'http://10.0.0.1',
      'http://169.254.169.254/latest',
      'http://[::1]/',
      'https://user:pass@example.org',
    ])
      expect(isPublicUrl(url)).toBe(false);
    expect(isPublicUrl('https://example.org/travel')).toBe(true);
  });
  /** 结束安全边界用例。 */
});
