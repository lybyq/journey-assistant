/** 纯脱敏类可独立测试，避免日志、网页或模型接收秘密值。 */
export class ToolSafety {
  /** 实际秘密仅保存在服务端用于精确替换。 */
  constructor(private readonly secrets: string[]) {}
  /** 按UTF-8字节限长，移除链接认证信息。 */
  text(value: string, maxBytes = 6000): string {
    /** 优先清理真实配置中的秘密。 */
    let clean = value
      .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*$/gi, '');
    for (const secret of this.secrets.filter((item) => item.length >= 6))
      clean = clean.split(secret).join('[已隐藏]');
    /** URL移除用户信息、查询和片段，随后匹配通用凭据。 */
    clean = clean
      .replace(/https?:\/\/[^\s<>"'\)\]\}]+/g, (raw) => {
        try {
          const url = new URL(raw);
          url.username = '';
          url.password = '';
          url.search = '';
          url.hash = '';
          return url.href;
        } catch {
          return '[无效链接]';
        }
      })
      .replace(
        /Bearer\s+[A-Za-z0-9._-]+|\b(?:sk-|tvly-)[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi,
        '[已隐藏]',
      );
    /** 字节裁剪不能留下半个中文字符。 */
    const bytes = Buffer.from(clean);
    return bytes.length <= maxBytes
      ? clean
      : `${bytes
          .subarray(0, maxBytes)
          .toString('utf8')
          .replace(/\uFFFD$/, '')}…[已截断]`;
    /** 结束文本清理。 */
  }
  /** 递归处理有限JSON结构，不调用外部对象方法。 */
  value(value: unknown, depth = 0): unknown {
    /** 限深后直接返回安全标量。 */
    if (depth > 6) return '[层级已截断]';
    if (typeof value === 'string') return this.text(value, 4000);
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    /** 数组最多三十项，控制上下文与UI体积。 */
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => this.value(item, depth + 1));
    /** 丢弃原型字段和媒体数据，认证字段整体替换。 */
    if (typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 50)
          .filter(
            ([key]) =>
              ![
                '__proto__',
                'prototype',
                'constructor',
                'blob',
                'base64',
                'audio',
                'image',
              ].includes(key),
          )
          .map(([key, item]) => [
            this.text(key, 100),
            /authorization|cookie|password|secret|api.?key|access.?token|refresh.?token/i.test(key)
              ? '[已隐藏]'
              : this.value(item, depth + 1),
          ]),
      );
    /** 不执行toString等潜在副作用。 */
    return '[非JSON数据]';
    /** 结束结构清理。 */
  }
  /** 模型与网页使用相同结果，且标记外部资料不可信。 */
  result(value: unknown, kind: 'mcp' | 'internal' = 'mcp') {
    /** 记录递归清理是否改变原始数据。 */
    const data = this.value(value);
    const encoded = JSON.stringify(data);
    let truncated = false;
    try {
      truncated = JSON.stringify(value) !== encoded;
    } catch {
      truncated = true;
    }
    /** 总体数据不超过约7KiB，给事件公共字段预留空间。 */
    return {
      kind,
      data:
        Buffer.byteLength(encoded) > 7000
          ? {
              preview: this.text(encoded, 6500),
              note: '结果过大，请缩小查询范围',
            }
          : data,
      truncated: truncated || Buffer.byteLength(encoded) > 7000,
      untrusted: kind === 'mcp',
      checkedAt: new Date().toISOString(),
    };
    /** 结束结果信封。 */
  }
}
/** 只允许公共HTTP来源，禁止本机、内网、IPv6字面量和凭据URL。 */
export function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !/^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|::)/.test(
        host,
      ) &&
      host.includes('.') &&
      !/^\d+$/.test(host)
    );
  } catch {
    return false;
  }
}
