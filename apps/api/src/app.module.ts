/** 引入 Nest 根模块装饰器。 */
import { Module } from '@nestjs/common';
/** 加载全局配置，启动前完成环境校验。 */
import { ConfigModule } from './config/config.module.js';
/** 引入公开健康接口。 */
import { HealthModule } from './modules/health/health.module.js';
/** 引入实际可运行的框架诊断链路。 */
import { RealtimeModule } from './modules/realtime/realtime.module.js';
/** 注册延迟初始化的真实智能体 SDK 工厂。 */
import { AgentModule } from './modules/agent/agent.module.js';
/** 注册延迟初始化的 MCP 工厂及应用退出清理。 */
import { McpModule } from './modules/mcp/mcp.module.js';
/** 真实数据服务负责连接、迁移与退出清理。 */
import { StorageModule } from './storage/storage.module.js';
/** 身份与存储提供用户、凭据、刷新会话和基础资料。 */
import { IdentityModule } from './modules/identity/identity.module.js';
/** 持久化会话按已认证用户归属隔离。 */
import { ConversationsModule } from './modules/conversations/conversations.module.js';
/** 根模块只组合模块，不承载旅行业务逻辑。 */
@Module({
  imports: [
    ConfigModule,
    StorageModule,
    IdentityModule,
    ConversationsModule,
    HealthModule,
    RealtimeModule,
    AgentModule,
    McpModule,
  ],
})
/** 后续业务以独立模块加入，避免形成一个巨型控制器。 */
export class AppModule {}
