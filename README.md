# 行也 · 智能旅行助手

完整产品目标：为自由行、自驾游、跟团游生成有来源、可调整、费用可比较的旅行方案。

当前已完成 **01～05**：工程底座、身份数据、持久化对话、**04 Deep Agents 智能体编排**、**05 MCP工具中心**。第06～14模块继续按用户指定顺序实施。

## 快速启动

环境：Node.js 22.20+；pnpm 10.34.6。仓库使用统一锁文件，建议通过 `corepack enable` 启用 pnpm。

```powershell
pnpm install
pnpm storage:setup
pnpm dev
```

启动后访问：

- 网页：<http://127.0.0.1:5173>
- API 健康状态：<http://127.0.0.1:3000/api/v1/system/health>
- Swagger：<http://127.0.0.1:3000/api/docs>
- OpenAPI JSON：<http://127.0.0.1:3000/api/docs-json>
- WebSocket：`ws://127.0.0.1:3000/ws/chat`

**无模型密钥也能启动服务和使用账户，但真实智能体问答需要模型配置。** `storage:setup` 创建本项目独立的 PostgreSQL/Redis 容器与本地配置，自动生成签名密钥，不覆盖已有模型配置。注册或登录后可以保存偏好、创建/改名/归档/恢复会话。发送消息会保存多轮历史与公开轨迹，断线自动补发；默认进入真实Deep Agents模型与MCP工具循环。需配置后端模型Key、模型名与兼容地址；缺失时明确报错，不返回预制答案。

## 已完成

- pnpm workspace：NestJS API、Vue 网页、共享 Zod/TypeScript 协议。
- NestJS **12.3.2**、Vue **3.5.44**、Vite **8.3.5**、TypeScript **6.0.3**。
- Deep Agents **1.16.0**、LangChain、MCP adapters **2.0.1** 的真实 SDK 装配入口。
- 统一配置、错误响应、请求追踪、精确来源白名单、基础响应头和开发 OpenAPI 文档。
- 标准 WebSocket 诊断事件：运行、步骤、工具输入/输出、文本增量、取消与错误。
- Vue Composition API、Pinia、Router、传输层隔离、流式 Markdown、代码高亮、HTML 净化。
- 出行偏好切换、输入示例、工具折叠、复制回答、连接恢复入口、响应式布局与减少动态偏好。
- 完整模块路线页面与本文档中的后续模块设计。
- 真实 HTTP/WebSocket 集成测试、协议与环境配置边界测试。
- PostgreSQL + Drizzle ORM、Redis、受事务与校验和保护的幂等迁移。
- 邮箱密码注册/登录、scrypt摘要、内存短期JWT、HttpOnly刷新Cookie、轮换重放检测与当前/全部设备退出。
- 当前用户资料、基础旅行偏好、持久化会话元数据、稳定游标分页、改名及可恢复归档。
- 数据归属、Cookie/CSRF/限流、服务重启持久化及浏览器身份竞态的真实边界测试。

- 持久化多轮消息、认证SSE流、心跳、按游标补发、取消与幂等、配额/超时/背压及崩溃租约恢复。

- 【04】真实Deep Agents工具循环、只读内存工作区、研究子代理、Postgres checkpointer、共享预算与实际阶段事件。
- 【05】12306/高德/Tavily连接、白名单、schema校验、取消/超时、熔断重连和有界脱敏结果。
- 中文源码注释用【模块04】/【模块05】明确分层；网页执行面板也按04/05分区。

## 未开放的能力

已经执行真实模型、计划工具、受控研究子代理和MCP查询。住宿/机票/旅行团授权报价、确定性预算计算、行程验证与导出尚未完成，不能宣称已覆盖完整旅游业务。进程崩溃后旧任务明确失败，正文和事件可恢复；不自动重跑工具。外部工具的 `configured` 只表示配置存在；`connected` 根据真实发现与调用更新。网页账户提供邮箱密码身份，尚不提供邮箱验证、密码找回或第三方登录。当前交付为本机开发部署，生产运营保障按后续模块完成。

## 工程目录

```text
apps/
  api/src/
    config/                  # 环境加载与校验
    common/                  # 统一 HTTP 错误边界
    modules/
      health/                # 真实健康接口与模块清单
      realtime/              # 鉴权流、持久化仓储、执行器与开发诊断
      agent/                 # 【04】模型、提示词、检查点、中间件、子代理、公开事件
      mcp/                   # 【05】注册表、连接、白名单、校验、熔断、脱敏
    bootstrap.ts             # 可测试的应用装配
    main.ts                  # 实际监听入口
  web/src/
    components/chat/         # 输入、对话、Markdown、公开轨迹
    components/layout/       # 品牌和导航
    components/roadmap/      # 完整模块路线
    features/chat/           # 纯状态归约、会话 composable、Markdown
    services/                # HTTP / SSE 生产流与开发 WebSocket 适配层
    stores/                  # 本标签页聊天状态
    pages/                   # 只负责组合页面
    styles/                  # 设计令牌与全局规则
packages/contracts/src/      # 浏览器/服务端/未来小程序共享协议
tests/                       # 配置、状态、真实链路测试
docs/                        # 架构、完整路线、协议与配置说明
infra/                       # 本项目独立PostgreSQL与Redis基础设施
```

## 环境配置

配置真实模型与 MCP 时，复制模板：

```powershell
# 仅在文件不存在时创建配置，保留已经填写的密钥。
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
# 网页配置同样避免覆盖现有设置。
if (-not (Test-Path apps/web/.env.local)) { Copy-Item apps/web/.env.example apps/web/.env.local }
```

API 密钥只放后端。前端以 `VITE_` 开头的变量会出现在浏览器构建产物中，**不得放秘密值**。没有任何运行逻辑需要在前端配置 OpenAI、高德或 Tavily Key。

网页生产对话使用带Bearer头的fetch流（SSE帧）；Vite转发 `/api`，`/ws`仅用于旧开发诊断。反向代理须关闭SSE缓冲和缓存，允许至少35秒读取超时；网页未匹配路径回退到 `index.html`。生产必须使用HTTPS。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 编译共享协议后同时启动协议监听、后端和网页 |
| `pnpm dev:api` | 单独启动后端，使用 tsc 保留 Nest 注入元数据 |
| `pnpm dev:web` | 单独启动网页；首次运行须先编译共享协议 |
| `pnpm typecheck` | 严格校验共享包、后端和 Vue 模板类型 |
| `pnpm test` | 编译后端并在随机端口测试真实链路 |
| `pnpm build` | 按依赖顺序构建全部应用 |
| `pnpm check` | 依次执行类型、测试与构建 |
| `pnpm storage:setup` | 生成不覆盖已有文件的独立存储配置并启动容器 |
| `pnpm storage:up` | 启动本项目数据容器，等待真实健康检查 |
| `pnpm storage:down` | 停止本项目容器，保留全部数据卷 |
| `pnpm db:migrate` | 对配置数据库校验并执行幂等迁移 |
| `pnpm --filter @journey/api start` | 运行已经编译的后端 |
| `pnpm --filter @journey/web preview` | 预览已经构建的网页 |

## 阅读顺序

1. [总体方案与模块顺序](docs/ROADMAP.md)
2. [技术架构与模块边界](docs/ARCHITECTURE.md)
3. [实时事件协议](docs/PROTOCOL.md)
4. [配置和注释约定](docs/CONFIGURATION.md)
5. [第一模块验收记录](docs/FOUNDATION.md)
6. [第二模块实现与验收](docs/IDENTITY.md)
7. [第三模块对话、实时协议与验收](docs/CONVERSATION.md)
8. [**模块04：Deep Agents编排学习指南**](docs/MODULE-04-AGENT.md)
9. [**模块05：MCP连接与工具学习指南**](docs/MODULE-05-MCP.md)

第二至五模块测试需要 PostgreSQL 和 Redis，先执行 `pnpm storage:up`。模型与MCP集成测试使用本机协议fixture，不消耗真实供应商额度。测试会创建随机命名的独立数据库，执行完后清理该测试数据库；Redis只删除本轮随机前缀的键，绝不执行FLUSHDB。开发数据与测试数据相互隔离。

所有手写 TypeScript 逻辑行均配中文 JSDoc 风格解释；Vue 模板使用合法 HTML 注释，CSS 使用中文块注释。标准 JSON 不允许注释，逐项说明见配置文档。依赖锁文件、编译产物和第三方资产不改写为注释代码。

目的地灵感图片来源：[Unsplash 图片](https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1)，本地保存于 `apps/web/public/images/alpine-lake.jpg`；仅为灵感配图，不代表真实报价或已生成行程。
