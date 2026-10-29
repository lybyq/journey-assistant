/** 引入 Nest 模块声明。 */
import { Module } from '@nestjs/common';
/** 复用健康能力作为当前唯一可运行的系统工具。 */
import { HealthModule } from '../health/health.module.js';
/** 引入使用共享协议的诊断网关。 */
import { DiagnosticGateway } from './diagnostic.gateway.js';
/** 身份模块负责生产通道认证与持续会话检查。 */
import { IdentityModule } from '../identity/identity.module.js';
/** 生产对话仓储与执行生命周期分离。 */
import { RuntimeRepository } from './runtime.repository.js';
/** 运行服务持有取消信号，连接断开不丢失任务。 */
import { RuntimeService } from './runtime.service.js';
/** 流控制器处理历史、心跳、补发和背压。 */
import { RuntimeController, StreamConnections } from './runtime.controller.js';
/** 持久化对话只调度运行，实际智能体执行委托智能体编排。 */
import { AgentModule } from '../agent/agent.module.js';
/** 注册网关，后续持久化对话会在此扩展真正的聊天流和事件重放。 */
@Module({
  imports: [HealthModule, IdentityModule, AgentModule],
  controllers: [RuntimeController],
  providers: [DiagnosticGateway, RuntimeRepository, RuntimeService, StreamConnections],
})
/** 实时模块与业务模型分离，便于后续替换传输或增加小程序入口。 */
export class RealtimeModule {}
