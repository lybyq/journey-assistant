/** 引入文件存在检查，让从仓库根目录或应用目录启动都能找到环境文件。 */
import { existsSync } from 'node:fs';
/** 引入平台安全的路径拼接工具，兼容 Windows 中文目录。 */
import { resolve } from 'node:path';
/** 引入 dotenv；环境文件只由服务端加载。 */
import { config } from 'dotenv';
/** 引入 Zod 校验服务启动参数。 */
import { z } from 'zod';
/** 定义环境结构，允许缺少外部服务密钥，但拒绝错误端口和错误来源。 */
const environmentSchema = z.object({
  /** 显式启用数据模块；旧的无存储底座测试仍可独立运行。 */
  STORAGE_ENABLED: z.enum(['true', 'false']).default('false'),
  /** 数据库与缓存地址只在后端读取，不出现在健康响应中。 */
  DATABASE_URL: z.string().default(''),
  REDIS_URL: z.string().default(''),
  /** Redis命名空间隔离本项目与测试，不能使用任意冒号结构覆盖别的项目。 */
  REDIS_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,60}$/)
    .default('journey'),
  /** 认证签名密钥由本地初始化生成，启用存储时必须至少32字节。 */
  AUTH_SECRET: z.string().default(''),
  /** 访问凭据15分钟，刷新会话有固定30天上限，不无限延长。 */
  ACCESS_TOKEN_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** 默认仅在本机监听；生产部署可以显式改为容器所需地址。 */
  HOST: z.string().default('127.0.0.1'),
  /** 转换文本端口并限制有效 TCP 范围。 */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** 环境用于区分开发诊断功能和生产边界。 */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** 缺省来源仅包含开发与预览页面。 */
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
    ),
  /** 不使用 z.coerce.boolean，避免字符串 false 被错误转换成 true。 */
  ENABLE_DIAGNOSTICS: z.enum(['true', 'false']).optional(),
  /** 模型配置在智能体工厂创建时才要求完整。 */
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_BASE_URL: z.union([z.literal(''), z.string().url()]).default(''),
  /** 外部工具密钥不能被公开健康接口序列化。 */
  AMAP_MAPS_API_KEY: z.string().default(''),
  /** 可选独立Web服务Key；留空时沿用MCP的Web服务类型Key。 */
  AMAP_WEB_SERVICE_API_KEY: z.string().default(''),
  TAVILY_API_KEY: z.string().default(''),
  /** Amadeus授权凭据只在后端；test环境结果不能标成生产库存。 */
  AMADEUS_CLIENT_ID: z.string().default(''),
  AMADEUS_CLIENT_SECRET: z.string().default(''),
  AMADEUS_ENV: z.enum(['test', 'production']).default('test'),
  /** 可选的已签约旅行团网关，仅接受管理员部署时配置的HTTPS根地址。 */
  TOUR_GATEWAY_URL: z
    .union([
      z.literal(''),
      z
        .string()
        .url()
        .refine((value) => {
          const u = new URL(value);
          return (
            u.protocol === 'https:' &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash &&
            !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(
              u.hostname,
            )
          );
        }, '旅行团网关必须是无认证查询参数的公共HTTPS地址'),
    ])
    .default(''),
  /** 网关Key通过认证头传输，不接受网页或模型提交。 */
  TOUR_GATEWAY_KEY: z.string().default(''),
  SUPPLIER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  /** 分享地址来自可信部署配置，不能相信HTTP Host头。 */
  PUBLIC_WEB_URL: z.string().url().default('http://127.0.0.1:5173'),
  /** 默认真实智能体；诊断仅供本机验收。 */
  CHAT_EXECUTOR: z.enum(['agent', 'diagnostic']).default('agent'),
  /** 硬时限、调用次数和累计token预算。 */
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(180000),
  AGENT_MAX_MODEL_CALLS: z.coerce.number().int().min(1).max(30).default(12),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(40).default(20),
  AGENT_MAX_TOKENS: z.coerce.number().int().min(1000).max(200000).default(50000),
  /** 完整行程正文需要足够输出空间，截断响应仍须通过格式校验。 */
  AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(8192).default(4096),
  /** 只接受预置服务器，空值关闭外部工具。 */
  MCP_SERVERS: z
    .string()
    .default('train,amap,tavily')
    .refine(
      (value) =>
        value
          .split(',')
          .filter(Boolean)
          .every((id) => ['train', 'amap', 'tavily'].includes(id.trim())),
      '仅允许预置MCP服务',
    ),
  /** 连接、执行与熔断冷却的时间上限。 */
  MCP_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  MCP_CIRCUIT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  /** 结束环境结构定义。 */
});
/** 从校验器推导环境类型，保证配置服务和工厂使用同一规范。 */
export type Environment = z.infer<typeof environmentSchema>;
/** 校验配置并额外验证精确来源地址；错误信息不包含原始输入和密钥。 */
export function parseEnvironment(input: Record<string, unknown>): Environment {
  /** 先执行结构校验，阻止不合法的启动参数。 */
  const parsed = environmentSchema.safeParse(input);
  /** 生产环境不能用诊断正文冒充模型输出。 */
  if (
    parsed.success &&
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.CHAT_EXECUTOR === 'diagnostic'
  )
    throw new Error('生产环境禁止 CHAT_EXECUTOR=diagnostic');
  /** 启用真实身份模块时拒绝不完整的数据库、缓存或签名配置。 */
  if (
    parsed.success &&
    parsed.data.STORAGE_ENABLED === 'true' &&
    (!/^postgres(ql)?:\/\//.test(parsed.data.DATABASE_URL) ||
      !/^rediss?:\/\//.test(parsed.data.REDIS_URL) ||
      Buffer.byteLength(parsed.data.AUTH_SECRET) < 32)
  )
    throw new Error('启用存储必须配置 DATABASE_URL、REDIS_URL 和至少32字节的 AUTH_SECRET');
  /** 只列出错误字段路径，不把可能含凭据的字段内容写入日志。 */
  if (!parsed.success)
    throw new Error(
      `环境配置无效：${parsed.error.issues.map((issue) => issue.path.join('.')).join('、')}`,
    );
  /** 逐个校验浏览器来源；来源不应该带路径、查询串或通配符。 */
  for (const origin of parsed.data.CORS_ORIGINS.split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    /** 使用 URL 标准验证，避免字符串包含检查造成来源白名单绕过。 */
    const url = new URL(origin);
    /** 只接受精确的 HTTP 或 HTTPS origin。 */
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin)
      throw new Error('CORS_ORIGINS 必须是精确的 HTTP/HTTPS 来源');
    /** 完成来源列表校验。 */
  }
  /** 生产环境明确禁止开启未鉴权的开发诊断运行。 */
  if (parsed.data.NODE_ENV === 'production' && parsed.data.ENABLE_DIAGNOSTICS === 'true')
    throw new Error('生产环境禁止开启 ENABLE_DIAGNOSTICS');
  /** 返回类型安全且已验证的配置。 */
  return parsed.data;
  /** 结束配置校验函数。 */
}
/** 加载最近的后端环境文件；调用方进程的已有环境变量优先。 */
export function loadEnvironment(): Environment {
  /** 优先加载本项目独立存储配置，不改写用户已有模型密钥文件。 */
  const storagePath = [
    resolve(process.cwd(), '.env.storage.local'),
    resolve(process.cwd(), 'apps/api/.env.storage.local'),
  ].find((path) => existsSync(path));
  /** 进程环境始终优先，测试可明确覆盖本地文件。 */
  if (storagePath) config({ path: storagePath, quiet: true });
  /** 在应用目录启动优先读取本地文件，在仓库根目录启动读取后端文件。 */
  const envPath = [resolve(process.cwd(), '.env'), resolve(process.cwd(), 'apps/api/.env')].find(
    (path) => existsSync(path),
  );
  /** 安静加载文件，避免输出环境变量和无关提示。 */
  if (envPath) config({ path: envPath, quiet: true });
  /** 在监听端口前完成校验。 */
  return parseEnvironment(process.env);
  /** 结束环境加载函数。 */
}
