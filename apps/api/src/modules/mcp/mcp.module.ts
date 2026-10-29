/** 独立依赖注入边界，不能反向依赖智能体或聊天模块。 */
import { Module } from '@nestjs/common';
/** 连接、白名单、schema校验、超时、熔断与脱敏统一由该服务负责。 */
import { McpService } from './mcp.service.js';
/** 可信固定注册表通过Nest工厂注入，浏览器没有修改入口。 */
import { MCP_DEFINITIONS, mcpDefinitions } from './mcp.catalog.js';
/** 秘密配置不导出到前端。 */
import { AppConfig } from '../../config/config.module.js';
/** 导出受控工具服务，原始adapter不暴露给其他模块。 */
@Module({
  providers: [
    {
      provide: MCP_DEFINITIONS,
      useFactory: (config: AppConfig) => mcpDefinitions(config.env),
      inject: [AppConfig],
    },
    McpService,
  ],
  exports: [McpService],
})
/** MCP工具中心：只负责外部工具，不负责决定何时调用模型。 */
export class McpModule {}
