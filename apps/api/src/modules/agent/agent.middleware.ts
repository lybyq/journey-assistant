/** 【模块04-3】真实SDK中间件包住每一次模型与工具调用。 */
import { createMiddleware } from 'langchain';
/** 工具输出重建为安全ToolMessage，避免原始返回值进入下一轮模型。 */
import { ToolMessage } from '@langchain/core/messages';
/** 所有公开调用都有独立可追踪ID。 */
import { randomUUID } from 'node:crypto';
/** 计划与工具结果必须符合共享结构。 */
import { publicTodoSchema, safeToolResultSchema } from '@journey/contracts';
/** 使用固定预算配置和第三模块事件出口。 */
import type { Environment } from '../../config/environment.js';
/** 模块04只依赖模块05公开的安全边界与受控错误。 */
import { ToolSafety } from '../mcp/tool-safety.js';
/** MCP业务失败可以返回给模型解释，不能泄露底层异常。 */
import { McpToolError } from '../mcp/mcp.service.js';
/** 硬预算错误必须终止整个运行。 */
import { ExecutionError, findExecutionError, type PublishEvent } from './execution.types.js';
/** 【模块04】主代理和研究子代理共享同一个预算对象。 */
export interface RunBudget {
    /** 所有主、子模型累计的调用尝试次数。 */
    modelCalls: number;
    /** 包含计划与委派在内的实际工具调用尝试数。 */
    toolCalls: number;
    /** 累计供应商报告量；缺失时按字节估算并设置estimated。 */
    totalTokens: number;
    /** 已消耗的研究委派名额，最多两个且不能递归。 */
    subagents: number;
    /** 任一模型响应缺少usage时，整轮统计都明确标成估算。 */
    estimated: boolean;
}
/** 【模块04】每轮新建中间件闭包，不能把不同用户的计数混在一起。 */
export function executionMiddleware(env: Environment, budget: RunBudget, signal: AbortSignal, publish: PublishEvent, safety: ToolSafety, role: 'main' | 'researcher') {
    /** 模型阶段只发计数和名称，不发送prompt和隐藏推理。 */
    const step = (stage: 'model.started' | 'model.completed' | 'subagent.started' | 'subagent.completed', name: string) => publish('agent.step', {
        module: 4, stage, name, modelCalls: budget.modelCalls, toolCalls: budget.toolCalls, totalTokens: budget.totalTokens, estimated: budget.estimated
    });
    /** 相同名称用于覆盖审计中间件，SDK默认工具仍需通过这里。 */
    return createMiddleware({ name: `JourneyBudget_${role}`,
        /** 模型前检查硬配额，模型后统计真实usage_metadata。 */
        wrapModelCall: async (request, handler) => {
            /** 子代理同样响应用户取消，预算跨子任务累计。 */
            signal.throwIfAborted();
            if (++budget.modelCalls > env.AGENT_MAX_MODEL_CALLS || budget.totalTokens >= env.AGENT_MAX_TOKENS)
                throw new ExecutionError('AGENT_BUDGET_EXCEEDED', '本轮模型预算已用完，请缩小问题范围后继续');
            await step('model.started', role === 'main' ? '主代理' : '旅行研究子代理');
            /** 控制累计模型上下文体积，保留最近消息；系统规则不由历史覆盖。 */
            let size = 0;
            const recent = [...request.messages].reverse().filter((message) => {
                size += JSON.stringify(message.content).length;
                return size <= 40000;
            }).reverse();
            if (!recent.length)
                throw new ExecutionError('AGENT_CONTEXT_LIMIT', '输入或工具结果过大，请缩小查询范围');
            /** 只在完整消息边界裁剪；工具消息不能缺少前置tool_call。 */
            while (recent[0]?.getType() === 'tool')
                recent.shift();
            /** 调用真实模型，重试由模型工厂明确限制。 */
            const response = await handler({ ...request, messages: recent });
            signal.throwIfAborted();
            const reported = response.usage_metadata?.total_tokens;
            budget.totalTokens += reported ?? Math.ceil(Buffer.byteLength(JSON.stringify([request.systemMessage.content, ...recent.map(item => item.content), response.content])) / 3);
            if (reported === undefined)
                budget.estimated = true;
            await step('model.completed', role === 'main' ? '主代理' : '旅行研究子代理');
            if (budget.totalTokens > env.AGENT_MAX_TOKENS)
                throw new ExecutionError('AGENT_BUDGET_EXCEEDED', '本轮累计token预算已用完，已停止继续调用');
            return response;
            /** 结束模型调用包装。 */
        },
        /** 所有工具，包括Deep Agents内置write_todos和task，都有真实轨迹。 */
        wrapToolCall: async (request, handler) => {
            /** 计数在异步调用前递增，平行工具也不能绕过上限。 */
            signal.throwIfAborted();
            if (++budget.toolCalls > env.AGENT_MAX_TOOL_CALLS)
                throw new ExecutionError('AGENT_BUDGET_EXCEEDED', '本轮工具预算已用完，请缩小问题范围');
            /** 子任务最多两次，研究子代理不能递归调用task。 */
            const name = request.toolCall.name;
            if (name === 'task' && (role !== 'main' || ++budget.subagents > 2 || request.toolCall.args.subagent_type !== 'travel_researcher'))
                throw new ExecutionError('SUBAGENT_LIMIT', '仅允许最多两个旅行研究子任务');
            /** 运行时只批准固定内置工具和模块05返回的MCP工具。 */
            if (!['task', 'write_todos', 'journey_current_time', 'read_file'].includes(name) && !/^(train|amap|tavily)__/.test(name))
                throw new ExecutionError('TOOL_NOT_ALLOWED', '该工具未获当前旅行助手批准');
            /** 发布脱敏参数，再开始实际工具；不公开SDK对象。 */
            const callId = randomUUID();
            const started = performance.now();
            await publish('tool.started', { callId, name, input: safety.value(request.toolCall.args) });
            if (name === 'task')
                await step('subagent.started', '旅行研究子代理');
            /** 工具成功、失败都由同一关联ID收尾。 */
            try {
                /** 原样交给真实工具执行，确保写计划的Command生效。 */
                const result = await handler(request);
                signal.throwIfAborted();
                /** 计划只取合法状态和短描述，不能把完整内部状态透传。 */
                if (name === 'write_todos') {
                    const raw: unknown = request.toolCall.args.todos;
                    const todos = Array.isArray(raw) ? raw.slice(0, 12).map((item) => publicTodoSchema.parse(safety.value(item))) : [];
                    await publish('run.plan', { module: 4, todos });
                }
                /** MCP包装已经返回信封；本地工具与子任务另做一次脱敏。 */
                let output: ReturnType<ToolSafety['result']>;
                const content = result instanceof ToolMessage ? result.content : { todos: request.toolCall.args.todos ?? [] };
                let parsed: unknown;
                try {
                    parsed = typeof content === 'string' ? JSON.parse(content) : content;
                }
                catch {
                    parsed = content;
                }
                const envelope = safeToolResultSchema.safeParse(parsed);
                output = envelope.success ? envelope.data : safety.result(parsed, 'internal');
                /** 发布真实结果与工具耗时，子代理完成另发公开阶段。 */
                await publish('tool.completed', {
                    callId, name, output, durationMs: Math.max(0, performance.now() - started)
                });
                if (name === 'task')
                    await step('subagent.completed', '旅行研究子代理');
                /** 工具给模型的结果必须和网页展示一致；Command只用于实际计划状态。 */
                return result instanceof ToolMessage ? new ToolMessage({
                    content: JSON.stringify(output), tool_call_id: result.tool_call_id, name, status: result.status
                }) : result;
                /** 工具失败不能冒充成功，也不能把异常原文交给模型。 */
            }
            catch (error) {
                if (signal.aborted)
                    throw error;
                const controlled = findExecutionError(error);
                if (controlled)
                    throw controlled;
                const code = error instanceof McpToolError ? error.code : 'TOOL_EXECUTION_FAILED';
                const message = error instanceof McpToolError ? error.message : '工具执行失败，暂时没有可用结果';
                await publish('tool.failed', {
                    callId, name, code, message, durationMs: Math.max(0, performance.now() - started)
                });
                return new ToolMessage({
                    content: JSON.stringify({ error: code, message }), tool_call_id: request.toolCall.id ?? callId, name, status: 'error'
                });
            }
            /** 结束工具包装。 */
        },
        /** 结束中间件定义。 */
    });
    /** 结束运行级中间件工厂。 */
}
