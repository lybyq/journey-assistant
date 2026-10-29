/** 使用 Markdown 解析器处理标题、列表、表格和代码块。 */
import { marked } from 'marked';
/** 已保存的旧异常正文也不能把内部协议标签直接显示给用户。 */
import { answerForDisplay } from '@journey/contracts';
/** 对解析后的 HTML 做允许列表净化，阻止外部内容注入脚本。 */
import DOMPurify from 'dompurify';
/** 按需注册少量语言，避免把所有高亮语言打进首屏。 */
import hljs from 'highlight.js/lib/core';
/** 仅注册项目实际展示的 TypeScript、JavaScript 和 JSON。 */
import typescript from 'highlight.js/lib/languages/typescript';
/** JavaScript 常用于工具示例和 SDK 代码块。 */
import javascript from 'highlight.js/lib/languages/javascript';
/** JSON 用于展示结构化参数与返回值示例。 */
import json from 'highlight.js/lib/languages/json';
/** 为 TypeScript 围栏代码启用高亮。 */
hljs.registerLanguage('typescript', typescript);
/** 为 JavaScript 围栏代码启用高亮。 */
hljs.registerLanguage('javascript', javascript);
/** 为 JSON 围栏代码启用高亮。 */
hljs.registerLanguage('json', json);
/** 对未知语言的代码逐字符转义，绝不原样插入 HTML。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
/** 配置代码渲染器，同时处理未闭合流式代码围栏。 */
const renderer = new marked.Renderer();
/** 代码块先转义或高亮，最终还会经过统一净化。 */
renderer.code = ({ text, lang }) => {
  /** 只取围栏的第一个语言标识，其他文字不能成为 HTML 属性。 */
  const language = (lang ?? '').split(/\s+/)[0] ?? '';
  /** 未注册语言使用纯文本转义；禁止直接插入语言声明。 */
  const content = hljs.getLanguage(language)
    ? hljs.highlight(text, { language }).value
    : escapeHtml(text);
  /** 高亮器生成的 class 属于内置代码样式，不包含外部 URL。 */
  return `<pre><code>${content}</code></pre>`;
  /** 结束代码渲染器。 */
};
/** 将不可信 Markdown 转为可展示 HTML；纯 HTML、远程图片和嵌入内容均不开放。 */
export function renderMarkdown(source: string, headingPrefix?: string): string {
  /** 每次解析有独立标题计数，流式刷新不会累积旧状态或串到另一条回答。 */
  const localRenderer = new marked.Renderer();
  localRenderer.code = renderer.code;
  let section = 0;
  if (headingPrefix)
    localRenderer.heading = function (token) {
      const id = headingPrefix.replace(/[^a-zA-Z0-9-]/g, '') + '-section-' + section++;
      return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`;
    };
  /** 表格保持原生语义，外层只承担横向滚动与视觉分组。 */
  const table = localRenderer.table;
  localRenderer.table = function (token) {
    return `<div class="table-shell">${table.call(this, token)}</div>`;
  };
  /** 限制单次渲染文本量，后续长报告将使用单独的文档组件。 */
  const html = marked.parse(answerForDisplay(source).slice(0, 100000), {
    async: false,
    gfm: true,
    breaks: true,
    renderer: localRenderer,
  });
  /** 仅允许阅读所需元素；禁止图片追踪、脚本、表单和样式注入。 */
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      'blockquote',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'pre',
      'code',
      'span',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'hr',
      'div',
    ],
    ALLOWED_ATTR: ['href', 'title', 'class', ...(headingPrefix ? ['id'] : [])],
    ALLOW_DATA_ATTR: false,
  });
  /** 结束安全 Markdown 渲染。 */
}
