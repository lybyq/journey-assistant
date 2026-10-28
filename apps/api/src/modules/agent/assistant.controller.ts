/** 【模块04/05】学习能力摘要要求登录，不能公开连接内部配置。 */
import { Controller, Get, UseGuards } from '@nestjs/common';
/** 文档明确标注两个模块的接口归属。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 所有能力访问均使用真实账户会话检查。 */
import { AccessGuard } from '../identity/auth.guards.js';
/** 第四模块负责模型和执行器说明。 */
import { AgentService } from './agent.service.js';
/** 第五模块独立返回已脱敏的连接与白名单状态。 */
import { McpService } from '../mcp/mcp.service.js';
/** 只返回公开额度，不返回密钥或私有地址。 */
import { AppConfig } from '../../config/config.module.js';
/** 能力摘要不发起昂贵模型调用或MCP发现。 */
@ApiTags('模块04 智能体 / 模块05 MCP')
/** 使用标准Bearer访问身份。 */
@ApiBearerAuth()
/** 防止未登录访问业务运行配置。 */
@UseGuards(AccessGuard)
/** 不接受用户指定服务URL或工具代码。 */
@Controller('assistant')
/** 学习界面能明确看出当前实际执行模式。 */
export class AssistantController {
    /** 两个模块分别提供自己的公开摘要。 */
    constructor(private readonly agent: AgentService, private readonly mcp: McpService, private readonly config: AppConfig) {
    }
    /** 读取不产生外部服务副作用的能力摘要。 */
    @Get('capabilities')
    /** 预算字段均为公开数字，供应商连接仍严格脱敏。 */
    capabilities() {
        return { agent: this.agent.status(), mcp: this.mcp.statuses(), limits: {
                timeoutMs: this.config.env.AGENT_TIMEOUT_MS, maxModelCalls: this.config.env.AGENT_MAX_MODEL_CALLS, maxToolCalls: this.config.env.AGENT_MAX_TOOL_CALLS, maxTokens: this.config.env.AGENT_MAX_TOKENS
            } };
    }
}
