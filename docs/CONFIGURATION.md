# 配置和逐行注释约定

## 注释规则

手写 TypeScript 使用中文 `/** ... */` 注释解释每个非空逻辑行，包括导入、类型字段、分支、资源清理和装配。函数与边界注释说明用途、数据来源与约束，不用无意义的“这里是一行代码”占位。

Vue 脚本沿用 JSDoc；模板使用合法 `<!-- ... -->`；CSS 使用 `/** ... */`。一个模板行可能由一组紧密相关的标签组成，其前一条中文注释解释该组的交互职责。样式每条规则有中文块注释，规则内同一行的属性共同实现该说明。

标准 JSON 不接受注释，不能插入 JSDoc 导致包管理或编译失败。下表和本文件为这些配置提供逐项说明。pnpm-lock.yaml 为自动生成的完整性锁文件，不手工逐行改写；第三方照片和编译产物也不属于注释对象。

## 根配置

| 文件/字段 | 说明 |
| --- | --- |
| package.json/name | 私有仓库的项目名称 |
| version | 当前底座交付版本，不代表完整业务已经上线 |
| private | 防止误发布到 npm |
| type=module | 使用 ESM，统一测试和配置代码的模块语义 |
| packageManager | 固定 pnpm 10.34.6，提高跨环境可重复性 |
| engines.node | 当前项目支持的 Node 下限 |
| scripts.dev | 先编译共享协议，再同时监听协议、API 和网页 |
| scripts.dev:api | 单独编译协议并启动后端开发监听 |
| scripts.dev:web | 启动 Vite 网页；要求共享包已有产物 |
| scripts.build | 按协议→API→网页顺序构建 |
| scripts.typecheck | 校验协议、服务端、Vue 和模板 |
| scripts.test | 构建真实 API，再执行 Vitest 边界与端到端验证 |
| scripts.check | 统一交付检查入口 |
| devDependencies | 测试、编译、并行开发与类型依赖，不当作业务 SDK |
| pnpm-workspace.yaml/packages | 定义 apps 与 packages 两类工作区 |
| onlyBuiltDependencies | 仅允许明确需要的框架和构建工具安装脚本 |
| pnpm-lock.yaml | 锁定实际版本、peer 解析与包完整性 |

`@scarf/scarf` 的安装脚本不在允许列表中，pnpm 会提示已忽略；它不影响构建和运行，项目不需要开启其安装统计脚本。

## 编译选项

| 字段 | 说明 |
| --- | --- |
| target=ES2022 | 以当前 Node 和现代浏览器支持的语言级别输出 |
| strict | 禁止隐式宽松类型 |
| noUncheckedIndexedAccess | 数组/字典索引必须考虑不存在的情况 |
| noImplicitOverride | 覆盖成员时要求显式标记 |
| noFallthroughCasesInSwitch | 阻止无意的 switch 分支贯穿 |
| forceConsistentCasingInFileNames | 避免 Windows 开发、Linux 部署时路径大小写失配 |
| skipLibCheck | 不重复检查第三方声明内部实现，应用代码仍受严格检查 |
| esModuleInterop | 兼容仍使用不同模块导出方式的库 |
| resolveJsonModule | 允许类型安全地读取配置 JSON |
| ignoreDeprecations=6.0 | 显式识别 TypeScript 6 的兼容弃用级别 |
| API module/moduleResolution=NodeNext | 与 Node 原生 ESM 解析一致 |
| API experimentalDecorators | 启用 Nest 当前采用的装饰器语义 |
| API emitDecoratorMetadata | 为构造参数依赖注入保留运行时类型信息 |
| declaration/sourceMap | 为共享包生成声明，并为后端本地排错提供映射 |
| Web moduleResolution=Bundler | 使用 Vite 对浏览器依赖的解析方式 |
| Web lib=DOM | 允许类型安全使用浏览器剪贴板、动画帧与 WebSocket |
| Web noEmit | 先校验，由 Vite 统一生成网页产物 |
| Web paths | 仅在网页内部提供 @/src 便捷引用 |

## 后端环境变量

| 名称 | 默认/用途 |
| --- | --- |
| HOST | 127.0.0.1，仅本机监听 |
| PORT | 3000；必须是有效 TCP 端口 |
| NODE_ENV | development/test/production |
| CORS_ORIGINS | 精确网页 Origin 列表，英文逗号分隔 |
| ENABLE_DIAGNOSTICS | 开发默认启用；字符串 false 正确关闭；生产禁止 true |
| LLM_API_KEY | 模型秘密 Key，仅后端保存 |
| LLM_MODEL | 实际支持工具调用的模型名称；不自动猜测供应商 |
| LLM_BASE_URL | OpenAI 兼容服务地址；为空时使用 SDK 官方默认 |
| AMAP_MAPS_API_KEY | 高德 Key；存在不代表已经验证连接 |
| TAVILY_API_KEY | Tavily Key；存在不代表已经验证连接 |
| DATABASE_URL | 当前真实 PostgreSQL 地址 |
| REDIS_URL | 当前真实 Redis 地址 |

第二模块已读取并验证 `DATABASE_URL`、`REDIS_URL`、`STORAGE_ENABLED`、`AUTH_SECRET`、`REDIS_PREFIX`、`ACCESS_TOKEN_SECONDS` 和 `REFRESH_TOKEN_DAYS`。`pnpm storage:setup`生成不覆盖原文件的`.env.storage.local`，其优先级在原`.env`之前、进程环境之后。真实就绪状态见`/api/v1/system/storage`；未启用存储时返回disabled，身份接口明确不可用。

## 网页环境变量

| 名称 | 用途 |
| --- | --- |
| VITE_API_BASE_URL | 公开 API 来源；为空走同源 /api |
| VITE_WS_URL | 仅供旧开发诊断适配器使用；当前网页生产实时流使用 VITE_API_BASE_URL |

所有 VITE_ 变量都可被最终用户看到，不能保存秘密值。网页只接收后端的脱敏结果。

## 应用包

API dependencies 包含 Nest 运行包、Deep Agents、LangChain、LangGraph、OpenAI 兼容适配器、MCP adapters、dotenv、helmet、ws、rxjs 与协议校验。API dev 脚本使用 tsc+node --watch，确保装饰器元数据在开发与生产一致。

Web dependencies 包含 Vue、Router、Pinia、marked、DOMPurify、按语言导入的 highlight.js、图标库与共享协议。Vite 配置限定端口避免来源白名单偏移；开发和预览均代理 API 与 WebSocket。

共享包 exports 将运行时代码与类型声明指向 dist；必须先编译共享包。共享包中不出现服务器文件系统、模型秘密值或浏览器专用 API。

## 模块04/05环境与学习约定

`CHAT_EXECUTOR=agent`默认真实问答；缺模型配置明确失败。仅本机测试可用diagnostic，生产拒绝。AGENT_TIMEOUT_MS默认120000，AGENT_MAX_MODEL_CALLS默认12，AGENT_MAX_TOOL_CALLS默认20，AGENT_MAX_TOKENS默认50000；主子代理共同计数，缺usage时明确标注估算。

MCP_SERVERS默认train,amap,tavily，空值关闭全部；MCP_CONNECT_TIMEOUT_MS默认15000，MCP_TOOL_TIMEOUT_MS默认20000，MCP_CIRCUIT_MS默认30000。12306使用锁定npm依赖0.3.10，直接Node启动，不临时npx安装。所有Key只放后端，示例模板保持空值。

新增源码以【模块04】与【模块05】标注职责，分别阅读MODULE-04-AGENT.md和MODULE-05-MCP.md。
