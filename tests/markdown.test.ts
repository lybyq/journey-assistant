/** @vitest-environment jsdom */
/** 使用真实 DOM 净化器验证可执行内容边界，而不是 mock DOMPurify。 */
import { describe, expect, it } from 'vitest';
/** 引入网页实际使用的解析与净化入口。 */
import { renderMarkdown } from '../apps/web/src/features/chat/markdown';
/** 不可信供应商和用户文本必须经过相同安全渲染。 */
describe('Markdown 安全边界', () => {
  /** 同页多条回答使用独立锚点，目录不能跳到其他回答或注入HTML属性。 */
  it('为真实标题生成独立且经过清理的章节锚点', () => {
    const first = renderMarkdown('## 行程\n\n### 预算', 'answer-one');
    const second = renderMarkdown('## 另一回答', 'answer-two');
    expect(first).toContain('id="answer-one-section-0"');
    expect(first).toContain('id="answer-one-section-1"');
    expect(second).toContain('id="answer-two-section-0"');
    expect(renderMarkdown('## 标题', 'bad" onclick="alert(1)')).not.toContain('onclick=');
  });
  /** 脚本、事件属性、表单和 iframe 不得进入可展示 HTML。 */
  it('移除可执行标签和事件属性', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><iframe src="https://untrusted.example"></iframe><form><input></form><p onclick="alert(1)">正文</p>',
    );
    expect(html).not.toMatch(/<script|<iframe|<form|onclick=/i);
  });
  /** 链接解析不能保留 JavaScript URL。 */
  it('移除危险链接协议', () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">恶意链接</a>');
    expect(html).not.toContain('href=');
    expect(html).toContain('恶意链接');
  });
  /** 远程图片可能跟踪访问或加载未经验证的资源，当前不开放。 */
  it('不允许外部图片和跟踪像素', () => {
    expect(renderMarkdown('![图片](https://untrusted.example/pixel.png)')).not.toContain('<img');
  });
  /** 正常 Markdown 不能因净化而丢失主要阅读能力。 */
  it('保留标题、表格和代码高亮', () => {
    const html = renderMarkdown(
      '## 行程\n\n| 项目 | 金额 |\n| --- | --- |\n| 交通 | 待报价 |\n\n```json\n{"ok":true}\n```',
    );
    expect(html).toContain('<h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('hljs-attr');
  });
  /** 围栏内看似 HTML 的内容只能作为文本，不得成为实际图像节点。 */
  it('代码块中的 HTML 只作为文本显示', () => {
    const html = renderMarkdown('```unknown\n<img src=x onerror=alert(1)>\n```');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
  });
  /** 结束 Markdown 安全测试。 */
});
