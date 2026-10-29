/** 安全边界纯函数不调用真实供应商。 */
import { describe, expect, it } from 'vitest';
/** MCP工具中心实际脱敏实现，不在测试里复制实现。 */
import { ToolSafety, isPublicUrl } from '../apps/api/src/modules/mcp/tool-safety.js';
/** 智能体编排只从公开text提取最终回答。 */
import { publicAnswer } from '../apps/api/dist/modules/agent/agent.service.js';
/** 服务端校验与网页历史保护共用同一个分类器。 */
import { answerFormatIssue, answerForDisplay } from '@journey/contracts';
/** 业务能力不应顺带把所有底层MCP Schema重复发给模型。 */
import { ToolSelection } from '../apps/api/dist/modules/agent/tool-selection.js';
/** 供应商专属参数只能发往可信的对应服务。 */
import { providerModelOptions } from '../apps/api/dist/modules/agent/model-options.js';
/** 检查隐藏推理、凭据和工具大输出边界。 */
describe('旅行服务公开输出边界', () => {
  /** DeepSeek默认思考模式需要SDK尚未回传的字段；明确禁用，且不能误发给别家。 */
  it('按官方主机选择模型兼容参数', () => {
    expect(providerModelOptions('https://api.deepseek.com/v1')).toEqual({
      modelKwargs: { thinking: { type: 'disabled' } },
    });
    expect(providerModelOptions('https://api.deepseek.com.evil.example/v1')).toEqual({});
    expect(providerModelOptions('https://api.openai.com/v1')).toEqual({});
    expect(providerModelOptions()).toEqual({});
  });
  /** 只有模型明确选择独立原始查询时，才增加相应供应商目录。 */
  it('业务工具目录与独立MCP目录分开加载', async () => {
    const selection = new ToolSelection();
    await selection.tool().invoke({ domains: ['experiences', 'transport'] });
    expect(selection.allows('journey_places')).toBe(true);
    expect(selection.allows('journey_rail')).toBe(true);
    expect(selection.allows('amap__maps_text_search')).toBe(false);
    expect(selection.allows('train__get_tickets')).toBe(false);
    await selection.tool().invoke({ domains: ['maps', 'rail_tools'] });
    expect(selection.allows('amap__maps_text_search')).toBe(true);
    expect(selection.allows('train__get_tickets')).toBe(true);
  });
  /** 覆盖实际模型故障中的全角工具标记，不能将其作为HTML或正文展示。 */
  it.each([
    '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="journey_hotels">参数</｜｜DSML｜｜ invoke>',
    '<|DSML|function_calls>工具</|DSML|function_calls>',
    '&lt;｜｜DSML｜｜ calls&gt;内部调用',
    '<｜tool▁calls▁begin｜>内部调用',
    '<tool_call>{"name":"journey_hotels"}</tool_call>',
    '<div><h2>上海行程</h2></div>',
    '&lt;div&gt;上海行程&lt;/div&gt;',
    '乱码\uFFFD正文',
    '孤立代理项\uD83D',
  ])('异常格式被识别且历史展示不暴露原文：%s', (text) => {
    expect(answerFormatIssue(text)).not.toBeNull();
    expect(answerForDisplay(text)).toContain('异常的模型输出格式');
    expect(answerForDisplay(text)).not.toContain(text);
  });
  /** 正常中文、emoji和用户要求的代码示例必须完整保留。 */
  it('合法Markdown与HTML代码示例不会被误拦截', () => {
    const text =
      '## 上海旅行 🧭\n\n| 项目 | 状态 |\n| --- | --- |\n| 酒店 | 待确认 |\n\n```html\n<div>代码示例</div>\n```';
    expect(answerFormatIssue(text)).toBeNull();
    expect(answerForDisplay(text)).toBe(text);
  });
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
  /** 大结果不能再变成半截JSON，金额字段仍可直接读取。 */
  it('大工具结果保留JSON结构与金额，业务通道避免提前截断', () => {
    const safety = new ToolSafety([]);
    const raw = Array.from({ length: 4 }, (_, index) => ({
      train: 'G' + index,
      priceMinor: 10050,
      notes: '查询记录'.repeat(800),
    }));
    const publicResult = safety.result(raw);
    expect(Array.isArray(publicResult.data)).toBe(true);
    expect((publicResult.data as any[])[0].priceMinor).toBe(10050);
    expect(publicResult.truncated).toBe(true);
    const business = safety.result(raw, 'mcp', 128000);
    expect(business.truncated).toBe(false);
    expect(business.data).toEqual(raw);
    expect(
      safety.result({ url: 'https://example.org/?token=secret' }, 'mcp', 128000).truncated,
    ).toBe(false);
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
