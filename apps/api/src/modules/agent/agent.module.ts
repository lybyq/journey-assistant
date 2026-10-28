/** 【模块04】独立模型编排模块，依赖第五模块提供受控工具。 */
import { Module } from '@nestjs/common';
/** 第五模块不依赖本模块，保持单向依赖。 */
import { McpModule } from '../mcp/mcp.module.js';
/** 检查点与实际SDK运行分开，便于按学习顺序阅读。 */
import { AgentCheckpointService } from './checkpoint.service.js';
/** 模型、计划、中间件、子任务与流事件适配集中在第四模块。 */
import { AgentService } from './agent.service.js';
/** 登录守卫通过身份模块复用。 */
import { IdentityModule } from '../identity/identity.module.js';
/** 学习界面读取真实执行器和供应商状态。 */
import { AssistantController } from './assistant.controller.js';
/** 只导出受控执行入口，不公开原始SDK图或秘密配置。 */
@Module({
    imports: [McpModule, IdentityModule], controllers: [AssistantController], providers: [AgentCheckpointService, AgentService], exports: [AgentService]
})
/** 第四模块：决定执行流程并映射公开事件。 */
export class AgentModule {
}
