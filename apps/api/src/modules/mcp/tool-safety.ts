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
  value(value: unknown, depth = 0, business = false): unknown {
    /** 限深后直接返回安全标量。 */
    if (depth > (business ? 10 : 6)) return '[层级已截断]';
    if (typeof value === 'string') return this.text(value, business ? 40000 : 4000);
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    /** 数组最多三十项，控制上下文与UI体积。 */
    if (Array.isArray(value))
      return value
        .slice(0, business ? 50 : 30)
        .map((item) => this.value(item, depth + 1, business));
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
              : this.value(item, depth + 1, business),
          ]),
      );
    /** 不执行toString等潜在副作用。 */
    return '[非JSON数据]';
    /** 结束结构清理。 */
  }
  /** 公开信封保留可解析JSON；业务解析通道使用更大但仍有界的容量，不先截断再解析。 */
  result(value: unknown, kind: 'mcp' | 'internal' = 'mcp', maxBytes = 7000) {
    const business = maxBytes > 7000;
    let data = this.value(value, 0, business);
    let truncated = this.losesData(value, 0, business);
    /** 只对公开大结果缩短文本和候选列表，禁止生成半截JSON字符串冒充有效数据。 */
    for (const limit of [1000, 400, 120, 40]) {
      if (Buffer.byteLength(JSON.stringify(data)) <= maxBytes) break;
      truncated = true;
      data = this.compact(data, limit);
    }
    if (Buffer.byteLength(JSON.stringify(data)) > maxBytes) {
      truncated = true;
      data = {
        omitted: true,
        note: '结果超过展示上限，请缩小查询范围；没有完整展示的字段不能视为不存在。',
      };
    }
    const checkedAt = new Date();
    return {
      kind,
      data,
      truncated,
      untrusted: kind === 'mcp',
      checkedAt: checkedAt.toISOString(),
      checkedAtLocal:
        new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).format(checkedAt) + ' Asia/Shanghai',
    };
  }
  /** 脱敏与数据裁剪分开计数，移除认证信息不会误判成票价不完整。 */
  private losesData(value: unknown, depth = 0, business = false): boolean {
    if (depth > (business ? 10 : 6)) return true;
    if (typeof value === 'string') return Buffer.byteLength(value) > (business ? 40000 : 4000);
    if (Array.isArray(value))
      return (
        value.length > (business ? 50 : 30) ||
        value.some((item) => this.losesData(item, depth + 1, business))
      );
    if (value && typeof value === 'object')
      return (
        Object.keys(value).length > 50 ||
        Object.values(value).some((item) => this.losesData(item, depth + 1, business))
      );
    return false;
  }
  /** 结构性缩减始终返回完整JSON值，金额、布尔和数字字段保持原值。 */
  private compact(value: unknown, textLimit: number): unknown {
    if (typeof value === 'string') return this.text(value, textLimit);
    if (Array.isArray(value))
      return value
        .slice(0, Math.max(1, Math.floor(textLimit / 200)))
        .map((item) => this.compact(item, textLimit));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this.compact(item, textLimit)]),
      );
    return value;
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
