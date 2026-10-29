# 智能体编排：Deep Agents 智能体编排学习指南

该服务回答的是：**模型怎样理解当前会话、决定下一步、调用工具、组织结果，并把真实执行过程转换成公开事件？** MCP工具中心负责工具如何连接、校验和执行。先理解这个边界，再看SDK参数。

源码注释说明实际数据流与权限边界。它依赖持久化对话的归属查询、运行状态机和事件持久化，依赖MCP工具中心提供经过批准的工具；不会直接拼高德URL或启动12306子进程。

## 1. 建议阅读顺序

| 顺序 | 文件                                                                    | 学习重点                                                                  |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | `apps/api/src/modules/agent/execution.types.ts`                         | `AgentInput`、`PublishEvent`、`ExecutionError` 是跨模块接口               |
| 2    | `apps/api/src/modules/agent/agent.prompt.ts`                            | 系统规则与版本号；证据、价格、工具返回值的权限边界                        |
| 3    | `apps/api/src/modules/realtime/runtime.repository.ts` 的 `agentInput()` | 历史如何按真实用户和会话归属过滤，为什么不接收客户端messages/systemPrompt |
| 4    | `apps/api/src/modules/agent/checkpoint.service.ts`                      | 官方PostgresSaver、独立schema与迁移锁                                     |
| 5    | `apps/api/src/modules/agent/agent.middleware.ts`                        | 模型/工具调用前后怎样计数、审计、脱敏和处理中断                           |
| 6    | `apps/api/src/modules/agent/agent.service.ts`                           | 模型、工具、子代理和Deep Agents图怎样装配；事件如何过滤                   |
| 7    | `apps/api/src/modules/realtime/runtime.service.ts`                      | 持久化对话怎样调用智能体编排，为什么长模型等待也要独立续租                |
| 8    | `tests/agent-mcp.e2e.test.ts`                                           | 看真实协议测试如何证明工具循环实际执行，而不是手工拼假轨迹                |

## 2. 一次提问的完整调用链

```text
Vue输入 → POST /conversations/:id/runs
  → 持久化对话：校验用户、会话、幂等ID、并发额度，保存用户消息
  → RuntimeRepository.agentInput：读取当前用户的历史和偏好
  → 智能体编排 AgentService.execute
      → MCP工具中心：发现已配置MCP，返回白名单LangChain工具
      → ChatOpenAI：OpenAI兼容模型，真实streaming，超时30秒，自动重试0次
      → createDeepAgent：计划工具 + 受控子代理 + 内存只读文件能力
      → 模型返回tool_calls → SDK执行工具 → 结果再送入模型
      → graph.invoke最终状态 → 格式与工具调用校验 → message.delta
  → 持久化对话：事件与正文原子落库，发布唯一终态
  → SSE补发 → Pinia归约 → Markdown安全渲染与执行面板
```

`tool_calls` 是模型输出的结构化调用意图，**不是结果**。真正的结果来自SDK执行LangChain Tool；如果该Tool来自MCP，则由MCP工具中心把调用转成MCP协议请求。不能只展示模型说“我查了高德”就算调用成功。

## 3. createDeepAgent在项目中具体做了什么

`model` 指向真实 `ChatOpenAI` 实例；`tools` 是内置时钟加MCP工具中心返回的工具；`systemPrompt` 是版本化规则；`checkpointer` 是PostgreSQL保存器；`middleware` 拦截所有实际模型和工具调用。

Deep Agents默认还带文件与子代理能力，不能直接把默认集合全部开放。当前安装的1.16.0要求文件中间件保留 `read_file`，所以本项目只保留它并绑定 `StateBackend`：读取的是本轮图状态中的虚拟文件，不是操作系统磁盘。没有本机shell、写文件、任意代码执行或网络脚本工具。中间件还会拒绝未批准的工具名。

默认通用子代理被替换成唯一的 `travel_researcher`。研究子代理用LangChain `createAgent` 构建，只完成一个明确子问题，拥有相同只读工具，没有 `task`，所以不能递归委派。主代理最多委派两次；主、子代理共用预算和AbortSignal。

文本模型边界会把兼容服务的完成结果明确投影为SDK要求的 `AIMessage`，保留正文、tool_calls、usage和响应元数据。本产品目前是文本助手，MCP媒体不进入模型上下文。这样也避免不同消息实现之间的隐式对象形状差异。

## 4. 计划不是隐藏推理

`write_todos` 是Deep Agents真正的内置计划工具。模型决定调用它后，SDK实际执行，项目再把合法todos转成 `run.plan`。网页显示待办、进行中、完成，而不是预制的“正在分析第1步”。简单问候没有必要生成计划，所以没有调用时显示“等待实际计划工具执行”。

`agent.step` 只包含主代理/研究代理的调用开始、完成、次数和token统计；`tool.started/completed/failed` 对应真实执行。它们都是公开执行摘要。`reasoning_content`、reasoning块、systemPrompt和原始SDK事件从不直接转发；完整text中的think/analysis/reasoning标签也会过滤。

原始模型结束事件早于中间件校验完成，不能直接发布正文。当前等待graph.invoke返回最终状态，只读取最后一条主代理AIMessage；工具进度与公开计划仍由中间件实时发布。最终正文经过隐藏内容过滤、格式校验与脱敏后再分块保存和发送，不把子代理报告、中间草稿或DSML内部工具文本拼进回答。

## 5. 会话记忆与检查点是两层东西

**业务历史** 是持久化对话的Message表，是用户看到的正文。智能体编排每轮最多读取最近13条合法普通消息、合计24000字符；当前用户输入一定包含在内。失败/取消的半段助手正文不会当完整答案带入下一轮。模型循环内还按完整消息边界限制近期内容，移除开头没有前置tool_call的ToolMessage。

**LangGraph检查点** 保存图执行状态、工具调用状态、计划和虚拟工作文件。官方PostgresSaver复用应用pg池，在 `agent_checkpoints` schema内维护自己的迁移账本；初始化由数据库锁保护。

`thread_id = userId:conversationId:runId` 全部由服务端生成，客户端不能提交。每个运行单独存checkpoint，跨轮对话记忆由已授权业务历史装配。这避免失败运行残留的工具指令污染下一轮，也避免刷新页面意外重放已执行工具。

网页刷新恢复的是持久化对话的正文与公开事件。API进程中断后，租约恢复器把旧运行标为失败，用户可在同会话重新提问；**当前不自动从半次模型请求继续，也不自动重试外部工具**。这是明确的失败恢复策略。检查点已真实保存，但不暴露包含内部状态的原始checkpoint给网页。

## 6. 取消、预算与故障

每轮默认180秒；每次模型请求30秒；最多12次模型调用、20次工具调用、2个研究子任务，主子代理共同累计。单次输出由AGENT_MAX_OUTPUT_TOKENS控制，默认4096 tokens；公开正文仍受实时消息的32KiB上限保护。SDK网络自动重试关闭。内部工具标记、异常HTML、损坏Unicode、坏原生工具参数或length截断会触发最多一次显式格式修复，每次真实请求均重新计入同一预算；修复失败返回MODEL_INVALID_OUTPUT，不保存伪成功正文。

有usage时累计供应商报告；缺usage时按消息字节估算并在界面显示“约”。token预算在调用前预留无工具收束轮次，并在响应后记录实际消耗，不能当作供应商账单的精确硬封顶；硬调用次数、单次输出长度、上下文长度与总时间仍会约束执行。

持久化对话每秒独立续租并检查取消/登出，即使模型十几秒不返回token也能停止；同一个AbortSignal继续传给Deep Agents、LangChain模型和MCP工具请求。中间件包装的ExecutionError会沿cause链找回稳定错误码，其他SDK异常只转成受控说明。

缺LLM_API_KEY或LLM_MODEL返回 `MODEL_NOT_CONFIGURED`，模型故障返回 `MODEL_EXECUTION_FAILED`，超预算返回 `AGENT_BUDGET_EXCEEDED`；不回退成固定自检回答。仅在本机显式设置 `CHAT_EXECUTOR=diagnostic` 才执行旧自检，生产禁止该模式。

## 7. 配置与学习练习

后端 `.env` 配置模型与供应商密钥；真实文件不能提交。建议使用支持标准工具调用的OpenAI兼容模型。`GET /api/v1/assistant/capabilities` 登录后返回模型、检查点、MCP服务器状态和公开预算，不发起外部调用。

1. 先发送问候，再发送需要资料的旅行问题，对比是否实际调用write_todos。
2. 提问“明天是哪天”，观察journey_current_time和上海时区日期。
3. 打开执行面板，区分编排工具write_todos/task和MCP工具 `tavily__...`。
4. 把本地AGENT_MAX_MODEL_CALLS调小，观察最后一次调用收束回答与后续调用被阻止。
5. 在模型运行中停止、刷新页面，核对终态和工具次数不会增加。
6. 阅读fixture测试中的模型协议：它只决定tool_calls，实际循环仍由真实SDK执行。

## 8. 本次验收与建议学习路径

真实网页已使用配置模型完成普通问答与“上海日期→杭州天气”工具问答；当前实际用量、测试数量及验收边界见 [验证记录](VERIFICATION.md)。子代理、计划、共享预算、取消和用户/运行检查点隔离由本机协议fixture测试覆盖。

先读本文件第2节的调用链，再按源码表阅读；随后转到`MCP.md`理解Tool如何真正访问供应商。持久化对话继续负责归属与事件恢复，智能体编排负责执行决策。

参考：[Deep Agents定制](https://docs.langchain.com/oss/javascript/deepagents/customization)、[LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)。实际代码以锁定的Deep Agents 1.16.0及本地类型声明为准。

## 工具按需加载与token预算

Agent每轮创建独立ToolSelection。首轮只公开时钟、旅行项目读取、预算读取、计划和能力选择目录；需要搜索、交通、住宿或行程生成时，通过journey_tools_select加载对应Schema。完整工具仍登记在图内，模型请求只携带当前选中的能力，避免每轮重复发送庞大的MCP和表单结构。研究代理始终只有只读领域工具。

RunBudget统计供应商真实累计输入与输出，不把token消耗伪装为生成字数。接近token上限或最后一次模型额度时，下一次请求移除工具并要求整理现有资料。已经生成的正常最终正文保留，实际用量即使超过预测仍如实统计；到达限制后不再继续调用。工具循环、超时和并发配额仍受原边界限制。

回归覆盖目录首次隐藏/按需加载、接近上限收束、最终正文不被事后丢弃、模型无限请求工具时硬停止。

## 同轮保存与历史异常隔离

同一轮的旅行业务写入进入独立串行队列，在实际执行前读取最新revision，避免模型同时查询多个地点时发生自相冲突。网页跨标签写入仍由原CAS检测冲突，不覆盖其他页面数据。

旧版本已经保存的DSML或HTML异常回答保留原始审计数据；模型历史装配会过滤异常assistant正文，用户原文仍保留。网页、标题目录和复制统一显示受控提示，代码围栏内的合法HTML示例仍按文本呈现。

## 供应商模式适配

model-options.ts仅对官方api.deepseek.com关闭默认思考模式。DeepSeek带工具的思考模式要求完整回传reasoning_content，当前OpenAI兼容转换器不提供完整的请求回传路径；使用官方非思考模式执行工具循环，避免依赖未满足的协议。该专属参数不会发送给OpenAI或其他兼容主机；测试覆盖主机后缀伪装。

业务领域目录仅公开包装工具；独立查询才加载maps或rail_tools原始工具。收束回答时把已执行结果转成标为不可信资料的普通消息，不再传递待延续的原生tool_call协议。输出额度通过模型工厂设置真实maxTokens，而不是SDK未采用的调用参数。

查询阶段比整轮硬超时提前结束：默认180秒整轮为最后一次模型回答和落库预留40秒，届时取消真实查询连接并停止排队查询。QUERY_TIME_LIMIT说明时间预算已到，不把供应商标成连接故障；模型用已保存结果生成最终正文，明确未完成项。Token、模型次数和工具次数上限仍独立生效，查询阶段结束不扩大这些配额。
