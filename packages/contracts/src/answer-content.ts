/** 仅提取公开文本块；隐藏推理和非文本内容不能成为用户答案。 */
export function extractPublicAnswer(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => block?.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('')
        : '';
  return text
    .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*$/gi, '')
    .trim();
}
/** 分类只用于拒绝异常输出，绝不把文本标签解析成可执行工具调用。 */
export function answerFormatIssue(text: string): 'tool_protocol' | 'html' | 'unicode' | null {
  /** 兼容半角与全角竖线，涵盖实际故障中的DeepSeek内部工具标记。 */
  if (
    /(?:<|&(?:amp;)?lt;)[|｜][^\n>]{0,80}(?:DSML|tool[_▁ ]?calls?|im_start|im_end)[^\n>]{0,80}(?:>|&(?:amp;)?gt;)|<\/?(?:tool_call|function_calls|invoke|parameter)\b|<(?:function|tool)\s*=/i.test(
      text,
    )
  )
    return 'tool_protocol';
  /** 代码示例中的HTML保持原文；普通回答不能整段输出页面或转义后的标签。 */
  const prose = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g, '');
  if (
    /<\/?(?:html|head|body|div|span|h[1-6]|p|table|tr|td|th|ul|ol|li|style|script|iframe)\b[^>]*>|&(?:amp;)?lt;\/?(?:html|div|span|p|table|h[1-6])\b/i.test(
      prose,
    )
  )
    return 'html';
  /** 替换字符和孤立代理项表示上游文本损坏；前端不能靠重新解码猜回原文。 */
  if (/\uFFFD|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
    return 'unicode';
  return null;
}
/** 历史异常回答保留原始审计数据，网页只展示清晰提示，避免再次泄露内部格式。 */
export function answerForDisplay(text: string): string {
  return answerFormatIssue(text)
    ? '> 这条回答包含异常的模型输出格式，已停止展示。请重新提问；工具调用文本不代表查询已经执行。'
    : text;
}
