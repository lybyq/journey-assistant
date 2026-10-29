/** 预置连接是可信部署配置，浏览器不能指定endpoint或命令。 */
import { createRequire } from 'node:module';
/** 解析固定依赖路径，不在用户聊天时临时npx安装代码。 */
import { fileURLToPath, pathToFileURL } from 'node:url';
/** 使用SDK真实连接类型。 */
import type { Connection } from '@langchain/mcp-adapters';
/** 配置只从后端注入。 */
import type { Environment } from '../../config/environment.js';
/** 供应商ID与网页共享。 */
import type { McpStatus } from '@journey/contracts';
/** 白名单使用原始MCP名称，适配后才加命名空间。 */
export const MCP_ALLOWLIST = {
  /** 12306仅开放查询，不包含登录、乘客信息或购票操作。 */
  train: [
    'get-current-date',
    'get-stations-code-in-city',
    'get-station-code-of-citys',
    'get-station-code-by-names',
    'get-station-by-telecode',
    'get-tickets',
    'get-interline-tickets',
    'get-train-route-stations',
  ],
  /** 高德只开放位置、天气和路线查询。 */
  amap: [
    'maps_geo',
    'maps_regeocode',
    'maps_text_search',
    'maps_around_search',
    'maps_search_detail',
    'maps_weather',
    'maps_direction_driving',
    'maps_direction_walking',
    'maps_direction_bicycling',
    'maps_direction_transit_integrated',
    'maps_distance',
  ],
  /** Tavily优先搜索，抽取只允许本轮搜索已出现的公共来源。 */
  tavily: ['tavily_search', 'tavily_extract', 'tavily-search', 'tavily-extract'],
  /** 结束白名单。 */
} as const;
/** 固定连接定义供管理器延迟建立。 */
export interface McpDefinition {
  /** 与公共契约使用相同的固定供应商标识。 */
  id: McpStatus['id'];
  /** 仅供UI与工具名称说明展示的中文名称。 */
  label: string;
  /** 该服务所需后端凭据是否存在，不代表已联网验证。 */
  configured: boolean;
  /** 服务器是否在本次部署的启用列表中。 */
  enabled: boolean;
  /** 含认证信息的内部SDK连接对象，不能序列化到HTTP响应。 */
  connection: Connection;
}
/** 可信注册表注入令牌，测试可用本机协议服务器替换，不向用户开放URL入口。 */
export const MCP_DEFINITIONS = Symbol('MCP_DEFINITIONS');
/** 三种供应商装配过程集中在此，便于学习transport差异。 */
export function mcpDefinitions(env: Environment): McpDefinition[] {
  /** 12306包已锁版本；使用node直接启动，不经过shell字符串拼接。 */
  const require = createRequire(import.meta.url);
  const trainEntry = fileURLToPath(
    new URL('build/index.js', pathToFileURL(require.resolve('12306-mcp/package.json'))),
  );
  /** 服务器启用列表来自后端环境配置。 */
  const enabled = new Set(env.MCP_SERVERS.split(',').map((id) => id.trim()));
  /** HTTP服务器的认证只出现在内部连接对象。 */
  return [
    /** 本地stdio子进程使用最小环境，不能继承模型和地图密钥。 */
    {
      id: 'train',
      label: '12306',
      configured: true,
      enabled: enabled.has('train'),
      connection: {
        transport: 'stdio',
        command: process.execPath,
        args: [trainEntry],
        stderr: 'ignore',
        env: {
          PATH: process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot ?? '',
          TEMP: process.env.TEMP ?? '',
          TZ: 'Asia/Shanghai',
        },
        restart: { enabled: false },
        defaultToolTimeout: env.MCP_TOOL_TIMEOUT_MS,
      },
    },
    /** 高德官方HTTP入口要求Key查询参数，禁止公开整个连接对象。 */
    {
      id: 'amap',
      label: '高德地图',
      configured: Boolean(env.AMAP_MAPS_API_KEY),
      enabled: enabled.has('amap'),
      connection: {
        transport: 'http',
        url: `https://mcp.amap.com/mcp?key=${encodeURIComponent(env.AMAP_MAPS_API_KEY)}`,
        defaultToolTimeout: env.MCP_TOOL_TIMEOUT_MS,
      },
    },
    /** Tavily使用Bearer头，避免把Key写入地址与浏览器历史。 */
    {
      id: 'tavily',
      label: 'Tavily',
      configured: Boolean(env.TAVILY_API_KEY),
      enabled: enabled.has('tavily'),
      connection: {
        transport: 'http',
        url: 'https://mcp.tavily.com/mcp/',
        headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}` },
        defaultToolTimeout: env.MCP_TOOL_TIMEOUT_MS,
      },
    },
    /** 结束连接列表。 */
  ];
  /** 结束固定注册表。 */
}
