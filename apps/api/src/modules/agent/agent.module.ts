/** 独立模型编排模块，依赖MCP工具中心提供受控工具。 */
import { Module } from '@nestjs/common';
/** MCP工具中心不依赖本模块，保持单向依赖。 */
import { McpModule } from '../mcp/mcp.module.js';
/** 检查点与实际SDK运行分开，便于按学习顺序阅读。 */
import { AgentCheckpointService } from './checkpoint.service.js';
/** 模型、计划、中间件、子任务与流事件适配集中在智能体编排。 */
import { AgentService } from './agent.service.js';
/** 登录守卫通过身份模块复用。 */
import { IdentityModule } from '../identity/identity.module.js';
/** 学习界面读取真实执行器和供应商状态。 */
import { AssistantController } from './assistant.controller.js';
/** 领域模块提供账户绑定的业务工具；依赖方向保持单向。 */
import { TravelModule } from '../travel/travel.module.js';
/** 只导出受控执行入口，不公开原始SDK图或秘密配置。 */
@Module({
  imports: [McpModule, IdentityModule, TravelModule],
  controllers: [AssistantController],
  providers: [AgentCheckpointService, AgentService],
  exports: [AgentService],
})
/** 智能体编排：决定执行流程并映射公开事件。 */
export class AgentModule {}
