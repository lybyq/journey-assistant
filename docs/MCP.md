# MCP工具中心：MCP连接与工具执行学习指南

该服务回答的是：**怎样连接供应商，发现工具，执行经过校验的参数，并把结果安全交给智能体编排？** 它不决定旅行计划、不创建模型，也不读用户聊天历史。源码注释说明实际数据流与权限边界。

## 1. 模型编排与工具连接的职责

| 问题                                 | 归属          | 项目入口                                   |
| ------------------------------------ | ------------- | ------------------------------------------ |
| 用户问题需要查询什么、先后顺序怎样   | 智能体编排    | AgentService + 版本化提示词                |
| 模型返回的tool_calls怎样进入工具循环 | LangChain SDK | executionMiddleware                        |
| MCP地址、stdio命令、Key放哪里        | MCP工具中心   | mcp.catalog.ts，后端环境变量               |
| 能发现哪些工具、哪些允许开放         | MCP工具中心   | MCP_ALLOWLIST + McpService.ensure          |
| 工具参数正确吗、调用多久停止         | MCP工具中心   | JSON Schema、AJV、SDK参数校验和AbortSignal |
| 主子代理总共能调用几次               | 智能体编排    | 共享RunBudget                              |
| 单个供应商故障如何隔离               | MCP工具中心   | 每供应商一个adapter和熔断槽位              |
| 公开事件怎样保存与补发               | 实时运行      | RuntimeRepository + SSE                    |
| 如何展示计划和工具结果               | Web           | 纯归约器 + ExecutionPanel                  |

`Function Calling` 是模型输出工具意图的格式；`LangChain Tool` 是本机可调用的工具抽象；`MCP` 是连接外部工具服务的协议。它们在同一条调用链中配合，不能混成一个名词。

## 2. 建议阅读顺序

1. `apps/api/src/modules/mcp/mcp.catalog.ts`：固定连接定义、官方地址与白名单。
2. `apps/api/src/modules/mcp/tool-safety.ts`：嵌套清理、URL规则与结果信封。
3. `apps/api/src/modules/mcp/mcp.service.ts`：连接槽位→发现→白名单→运行级Tool包装→实际调用。
4. `apps/api/src/modules/mcp/mcp.module.ts`：Nest注入令牌把可信配置与实现分开；测试替换注册表，不向浏览器开放任意URL。
5. `apps/api/src/modules/agent/agent.middleware.ts`：编排中间件怎样记录MCP工具的真实开始、完成和失败。
6. `tests/agent-mcp.e2e.test.ts`：真实HTTP MCP协商、schema拒绝、搜索/抽取隔离、超时、熔断与重连。

## 3. 三个实际连接

| 供应商            | 传输            | 认证与运行方式                                                                       | 当前白名单                                            |
| ----------------- | --------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Joooook/12306-mcp | stdio           | 已锁定0.3.10，Node直接启动安装好的build/index.js；不经过shell，不在聊天时临时npx安装 | 当前日期、车站编码、余票、中转、经停车站等8个只读工具 |
| 高德地图          | Streamable HTTP | `https://mcp.amap.com/mcp?key=...`，仅留在后端；其官方协议使用查询参数Key            | 地理编码、搜索、天气、距离、四类路线等11个工具        |
| Tavily            | Streamable HTTP | `https://mcp.tavily.com/mcp/`，Bearer认证头仅留在后端                                | tavily_search、tavily_extract                         |

ModelScope的介绍页面是服务说明页，不是能直接连接的MCP endpoint。12306当前采用原作者npm包的本地stdio入口；若以后改成托管连接，必须把它作为新的可信部署配置审核，而不是把用户贴来的介绍页直接交给SDK。

12306子进程只接收PATH、SystemRoot、TEMP和时区等最小环境，不继承LLM、高德或Tavily密钥。标准输出保留给JSON-RPC协议，stderr不转成用户答案。应用退出会关闭子进程和HTTP连接。

## 4. 工具发现不等于工具执行

```text
MCPAdapter构造（不联网）
  → listTools（连接并发现schema）
  → 固定白名单筛选
  → train__/amap__/tavily__命名空间
  → DynamicStructuredTool包装
  → 智能体编排把Tool交给createDeepAgent
  → 模型实际请求tool_calls
  → schema校验 → 供应商callTool → 脱敏有界结果
```

每家供应商一个adapter，发现请求共享同一个pending Promise，避免多用户同时启动多个12306子进程。发现缓存一分钟；缓存更新复用健康连接，不主动关闭其他用户正在使用的连接。失败后关闭失效连接，下一次发现按退避重连。

工具名示例：原始 `get-tickets` 转成 `train__get_tickets`，原始 `maps_geo` 转成 `amap__maps_geo`。只有白名单中的名称能开放；远端再返回一个“删除文件”工具也不会进入模型工具表。描述使用本机固定说明，不能把远端描述当系统指令。

## 5. 输入、超时与取消

每个Tool沿用发现的JSON Schema，包装层AJV再校验一次，SDK内部还会校验。真实服务会混合使用Draft-07和2020-12：发现时按`$schema`选择独立AJV实例并预编译；不能删除草案声明来绕过校验。不支持或无效的schema让该供应商降级，其他供应商继续工作。回归fixture同时包含这两个草案。参数总量限8KiB。校验错误不会发出真实工具请求，浏览器也不能选择任意命令、endpoint或认证头。

连接发现默认15秒，工具调用默认20秒。执行把运行取消、SDK调用取消和工具超时合并成同一个信号传入真实invoke/callTool；不是仅用Promise.race停止页面等待。有成本的工具执行不自动重试。

Tavily抽取额外要求：URL必须是本轮搜索返回并经过脱敏后实际展示的公共HTTP来源，不能用file、localhost、内网或带认证的地址。许可集合按本次运行新建，不跨用户或会话共享。远程供应商内部的DNS解析由供应商承担，本项目不把这项规则宣称为其完整SSRF防护。

## 6. 结果信封和不可信资料

```ts
// 模型和网页接收同一份工具信封。
{
  kind: 'mcp',
  data: { /* 已脱敏和裁剪的实际返回值 */ },
  truncated: false,
  untrusted: true,
  checkedAt: '实际查询时间'
}
```

清理真实配置秘密、Bearer/JWT/常见供应商令牌、认证字段、URL用户信息/查询/片段，移除原型字段和媒体内容，限制深度、数组项、字段数和总体约7KiB。超限明确标记truncated，不用未裁剪的另一份结果悄悄喂模型。价格证据的完整归档与结构化计算属于资料证据服务和预算服务，当前不能把截断工具信封当完整报价档案。

`untrusted=true` 意味着网页和搜索内容只提供事实材料，不具备指令权限。系统规则明确要求忽略其中“泄露Key”“改变身份”等内容；工具白名单和参数边界还会限制实际可执行范围。提示词规则不是万能的提示注入保证，必须与这些执行边界一起使用。

## 7. 故障、熔断与可观测性

状态分为disabled、unconfigured、idle、connecting、ready、degraded、circuit_open。填了Key只说明configured；只有实际发现成功才是connected。每个槽位最多持有一套连接，不随用户消息无限增长。

连接/网络失败至少退避1秒，连续3次打开默认30秒熔断；冷却后允许下一轮重新发现。单个供应商失败不会阻断其余服务，智能体会看到真实缺失并解释。业务工具失败用 `tool.failed`，不会标成绿色成功；工具超时有 `MCP_TIMEOUT`，错误原文和带Key的URL不公开。

健康接口读取实际状态但不主动联网；“模型已验证”代表本进程最近有成功调用，不是持续心跳保证。运行中保存的 `mcp.status` 用于刷新后恢复当时的轨迹；当前健康状态与历史轨迹不是同一时间点。

## 8. 配置与练习

默认 `MCP_SERVERS=train,amap,tavily`；缺少某家Key只让该家unconfigured。设为空可关闭外部工具。`MCP_CONNECT_TIMEOUT_MS`、`MCP_TOOL_TIMEOUT_MS`、`MCP_CIRCUIT_MS` 分别控制连接、执行、冷却。

1. 只启用train，问当前日期或站点编码，观察train命名空间。
2. 启用高德，问一个公共景点的天气或位置，核对调用参数、返回值和耗时。
3. 启用Tavily，先搜索再抽取，观察两次调用的URL证据关系。
4. 暂时移除一家Key，核对该家未配置，其他家仍可使用。
5. 阅读fixture中未批准工具、非法参数、超时和三次失败测试；不需要故意消耗真实供应商额度来制造错误。

## 9. 本次真实服务验收

2026-10-28实际发现并装配：12306为8个、高德为11个、Tavily为2个白名单工具，共21个。分别实际调用了12306当前日期、Tavily搜索和高德杭州天气；高德调用来自完整网页智能体问答，参数、返回值与耗时在执行面板可见。

自动回归使用独立本机HTTP MCP与模型协议fixture，覆盖混合schema草案、非法参数、越权抽取、搜索链接脱敏后的许可一致性、供应商独立熔断和真实超时断开。完整检查与真实验收见 [验证记录](VERIFICATION.md)。连接协议测试与交通、报价、预算的领域测试分别覆盖各自边界。

参考：[LangChain MCP](https://docs.langchain.com/oss/javascript/langchain/mcp)、[高德快速接入](https://lbs.amap.com/api/mcp-server/gettingstarted)、[Tavily MCP](https://docs.tavily.com/documentation/mcp)、[12306源项目](https://github.com/Joooook/12306-mcp)。SDK以锁定的MCP adapters 2.0.1及其本地类型为准。

## 分享与运维回归后的取消边界

发现/Schema/状态连接可以缓存；实际工具调用各自创建短生命周期MCP适配器，重新发现并核对原批准Schema。取消或超时关闭本次调用的实际HTTP/stdio连接，完成后也回收；单供应商最多4个、全局最多12个调用连接。不能只让Promise提前失败而把底层请求留在后台，也不能关闭共享连接影响其他用户。Search→Extract共享的是运行级来源许可，不依赖共享网络连接。
