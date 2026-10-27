# 技术架构与边界

## 总体结构

```text
Vue Web（当前） / 微信小程序（后续独立入口）
    │ HTTP：用户、会话、方案、报价、导出
    │ 认证HTTP/SSE：运行、步骤、工具、增量、补发；HTTP取消
    ▼
NestJS API
    ├── 身份与数据归属（02）
    ├── 对话与运行生命周期（03）
    ├── Deep Agents / LangChain / LangGraph（04）
    │       ├── MCP 工具中心（05）：12306 / 高德 / Tavily
    │       └── 领域工具：交通 / 车辆 / 酒店 / 团游 / 费用
    ├── 旅行需求与证据（06、07）
    ├── 方案比较与行程验证（08～13）
    └── 分享、导出与运营（14）
            │
            ├── PostgreSQL：长期业务数据、会话、方案版本、报价证据
            └── Redis：短期状态、限流、缓存、事件转发
```

当前01～03已实现：Vue → 认证HTTP/SSE → NestJS；身份与元数据使用Drizzle，消息/运行仓储复用同一pg池和参数化SQL，显式行锁控制序号与终态。Redis负责认证和实时连接限流。Agent与MCP仍只提供装配工厂，尚未调用模型。详见[第三模块](CONVERSATION.md)。

## 为什么先做模块化单体

当前使用一个 Nest 进程和清晰模块边界，优先保证类型、事务、访问控制与排错可控。每个领域以 service、repository、tool adapter 和 controller 分层；供应商 API 不直接写在聊天控制器中。后续仅在吞吐、隔离或部署确有需要时拆分 worker，而不在底座阶段引入不必要的微服务。

## 当前 API 模块

| 模块 | 职责 | 当前真实行为 |
| --- | --- | --- |
| ConfigModule | 环境加载、校验与来源限制 | 启动前验证参数，不公开密钥 |
| StorageModule | PostgreSQL、Redis、迁移和生命周期 | 真实连接、事务迁移、校验和与就绪探针 |
| IdentityModule | 凭据、登录会话、刷新和自身资料 | 密码摘要、轮换重放检测、退出撤销与资料保存 |
| ConversationsModule | 用户所属会话元数据 | 归属过滤、稳定游标、改名、可恢复归档 |
| HealthModule | 当前进程健康与产品模块清单 | 返回真实时间、运行秒数、Node 版本及脱敏配置状态 |
| RealtimeModule | 传输、诊断运行和事件映射 | 身份绑定的持久化运行、分页、心跳、重放、背压与取消 |
| AgentModule | 真正 SDK 的延迟装配 | 创建工厂，无公网调用入口，不自动执行模型 |
| McpModule | MCP 适配器装配与退出清理 | 定义连接但不发现工具，不启动 npx |

## 前端组件边界

| 文件/层 | 唯一职责 | 数据契约 |
| --- | --- | --- |
| WorkspacePage | 组合导航、工作区与执行面板 | 不直接创建网络连接 |
| AppSidebar | 导航与本地新建操作 | props：active/busy；emit：select/reset |
| WelcomePanel | 影像与输入示例 | emit：choose；只填草稿，不自动请求 |
| ChatComposer | 输入法、草稿、偏好、提交 | v-model：draft；props：busy/connected；emit：submit/cancel |
| ChatThread | 当前对话与滚动跟随 | props：ChatState |
| MarkdownAnswer | 净化、排版、链接与复制 | props：content/streaming |
| ExecutionPanel | 公开步骤、工具参数与 JSON | props：state/health/mobileOpen；emit：close |
| RoadmapPanel | 完整模块路线 | 读取共享清单；emit：back |
| useChatSession | 连接、重连、提交、取消、卸载清理 | 通过认证fetch流与有界帧解析器访问网络 |
| chat-state | 不依赖 Vue 的纯事件归约器 | 输入状态+事件，返回新状态 |
| Pinia chat store | 当前标签页状态与操作 | 当前轮归约，历史由服务端快照提供 |

## TypeScript 与依赖

服务端采用 ESM + NodeNext + tsc，保留 Nest 构造参数装饰器元数据。开发时先编译再监听产物；不使用会丢弃该元数据的默认 esbuild/tsx 编译替代后端 tsc。

共享协议先编译，再由 API 与 Web 引用；其中只包含 Zod、字面量和纯类型，不导出 Node fs、密钥配置或模型 SDK。浏览器构建不能导入后端模块。

Deep Agents 的 langsmith peer 范围为 `>=0.7.1 <0.10.0`；项目显式使用 `0.9.0`，避免自动安装不兼容的更新版本。TypeScript 当前选择 Nest Swagger 支持的 6.0.3，而不是盲目升级到不在其 peer 范围内的最新大版本。

## 实时展示与隐私边界

可以公开：计划摘要、执行步骤、工具名称、已脱敏的参数、已脱敏的结果、耗时、来源、最终正文。不能直接转发：隐藏推理 token、系统提示词、私密 Key、认证头、数据库连接串或其他用户的数据。

当前 system.health 的输出采用严格白名单，天然不包含秘密值。第五模块接入任意外部工具时，还需要通用嵌套脱敏、输出限长、URL 查询参数清理与工具 schema 审核，不能把当前工具的白名单等同于所有 MCP 都已安全处理。

## 金额与证据

模型用来选择、解释和提出调整；确定性计算工具负责加总、分摊和换汇。每个费用项保留币种、单位、数量、日期、人数条件、包含项、来源、查询时间、有效期和价格类型。缺失费用是 unknown，不是 0；无法证实的最低价不作为事实输出。

## 当前运行边界

开发默认 `127.0.0.1`；匿名 `/ws/chat` 仅是受开发开关控制的底座诊断。网页已使用带身份和归属校验的持久化生产对话通道；断线继续后台运行并按会话水位补发。模型、MCP与公网运营保障按04、05、14继续实施。
