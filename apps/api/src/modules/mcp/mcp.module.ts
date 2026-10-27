/** 引入 Nest 服务、模块和生命周期接口。 */
import { Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
/** 使用已核对的 MCP 适配器 2.x API。 */
import { MCPAdapter } from "@langchain/mcp-adapters";
/** 读取后端私密配置，禁止把这些定义发送给浏览器。 */
import { AppConfig } from "../../config/config.module.js";
/** MCP 工厂只负责定义与资源释放，暂不主动发现或调用外部工具。 */
@Injectable()
/** 后续第五模块将补充工具白名单、超时、隔离、重连和可观测调用。 */
export class McpAdapterFactory implements OnModuleDestroy {
  /** 记录内部创建的连接适配器，确保服务退出时可释放资源。 */
  private readonly adapters = new Set<MCPAdapter>();
  /** 注入只在服务端可访问的配置。 */
  constructor(private readonly config: AppConfig) {}
  /** 创建适配器不等于发起连接；只有显式 listTools 才会发现工具。 */
  create(): MCPAdapter {
    /** 读取经过验证的集成配置。 */
    const env = this.config.env;
    /** 使用官方 stdio 命令，Windows 显式通过 cmd 运行 npx。 */
    const train =
      process.platform === "win32"
        ? { command: "cmd.exe", args: ["/c", "npx", "-y", "12306-mcp"] }
        : { command: "npx", args: ["-y", "12306-mcp"] };
    /** 只在有对应密钥时加入高德与 Tavily，缺失时不会尝试匿名调用。 */
    const adapter = new MCPAdapter({
      servers: {
        /** 火车票服务将在第五模块经过连接验证后开放给智能体。 */
        train,
        /** 高德使用官方 HTTP 入口；URL 只留在后端。 */
        ...(env.AMAP_MAPS_API_KEY
          ? {
              amap: {
                url: `https://mcp.amap.com/mcp?key=${encodeURIComponent(env.AMAP_MAPS_API_KEY)}`,
              },
            }
          : {}),
        /** Tavily 使用请求头鉴权，避免把 Key 拼进可复制的查询 URL。 */
        ...(env.TAVILY_API_KEY
          ? {
              tavily: {
                url: "https://mcp.tavily.com/mcp/",
                headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}` },
              },
            }
          : {}),
        /** 完成 MCP 服务定义。 */
      },
    });
    /** 将适配器纳入当前应用的资源生命周期。 */
    this.adapters.add(adapter);
    /** 返回内部适配器，当前阶段没有外部路由调用此入口。 */
    return adapter;
    /** 结束适配器创建方法。 */
  }
  /** 停止服务时释放所有已经创建的适配器，即使其中一个关闭失败也继续清理。 */
  async onModuleDestroy(): Promise<void> {
    /** 并行等待独立连接的关闭结果，不让单个服务阻塞其他资源清理。 */
    await Promise.allSettled(
      [...this.adapters].map((adapter) => adapter.close()),
    );
    /** 删除所有内部引用。 */
    this.adapters.clear();
    /** 结束生命周期清理方法。 */
  }
  /** 结束 MCP 工厂。 */
}
/** 注册后端 MCP 资源装配能力。 */
@Module({ providers: [McpAdapterFactory], exports: [McpAdapterFactory] })
/** 后续只在本模块扩展外部工具管理，不侵入业务控制器。 */
export class McpModule {}
