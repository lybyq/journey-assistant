/** 引入 Nest 服务和模块声明。 */
import {
  Injectable,
  Module,
  ServiceUnavailableException,
} from "@nestjs/common";
/** 引入真实 Deep Agents 工厂，确保框架依赖可编译且可创建。 */
import { createDeepAgent } from "deepagents";
/** 引入 LangChain 工具类型，后续内置工具与 MCP 工具统一从这里注入。 */
import type { StructuredToolInterface } from "@langchain/core/tools";
/** 引入 OpenAI 兼容模型适配器，避免在网页持有模型密钥。 */
import { ChatOpenAI } from "@langchain/openai";
/** 使用后端统一配置。 */
import { AppConfig } from "../../config/config.module.js";
/** 提供延迟初始化入口；服务启动和系统诊断都不会调用模型。 */
@Injectable()
/** 仅负责装配 SDK，真实会话、记忆和运行调度由第四模块实现。 */
export class AgentRuntimeFactory {
  /** 从依赖注入容器读取模型配置。 */
  constructor(private readonly config: AppConfig) {}
  /** 使用调用方批准的工具集合创建 Agent；此方法本身不执行用户请求。 */
  create(tools: StructuredToolInterface[] = []) {
    /** 把配置保存为局部引用，减少重复访问。 */
    const env = this.config.env;
    /** 显式拒绝缺失配置，不回退到任何虚构模型响应。 */
    if (!env.LLM_API_KEY || !env.LLM_MODEL)
      throw new ServiceUnavailableException("请先配置后端模型密钥和模型名称");
    /** 用真实 LangChain 模型实例连接兼容服务，设置超时并限制重试。 */
    const model = new ChatOpenAI({
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      timeout: 30000,
      maxRetries: 1,
      ...(env.LLM_BASE_URL
        ? { configuration: { baseURL: env.LLM_BASE_URL } }
        : {}),
    });
    /** 返回真实 SDK 实例，后续模块负责接入持久化 checkpointer 和事件适配。 */
    return createDeepAgent({
      model,
      tools,
      systemPrompt:
        "你是行也旅行助手。依据工具证据回答，明确区分实时报价、页面价格与估算；不编造行程和价格。",
    });
    /** 结束运行时工厂方法。 */
  }
  /** 结束工厂服务。 */
}
/** 注册真正的 SDK 装配入口，不在底座阶段暴露模型执行 API。 */
@Module({ providers: [AgentRuntimeFactory], exports: [AgentRuntimeFactory] })
/** 智能体模块将在第四阶段扩展业务编排。 */
export class AgentModule {}
