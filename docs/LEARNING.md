# 真实业务链路学习指南

旅行规划完整链路已有实现；外部库存是否可用仍取决于实际供应商授权。当前客户端是Vue 3 Web，微信小程序适配是单独后续工作。

| 主题                 | 学习入口                           |
| -------------------- | ---------------------------------- |
| 工程底座             | [FOUNDATION.md](FOUNDATION.md)     |
| 身份与存储           | [IDENTITY.md](IDENTITY.md)         |
| 持久化对话与实时流   | [CONVERSATION.md](CONVERSATION.md) |
| Deep Agents编排      | [AGENT.md](AGENT.md)               |
| MCP工具中心          | [MCP.md](MCP.md)                   |
| 画像与需求澄清       | [TRIP-REQUEST.md](TRIP-REQUEST.md) |
| 资料与证据           | [RESEARCH.md](RESEARCH.md)         |
| 交通与接驳           | [TRANSPORT.md](TRANSPORT.md)       |
| 自驾与车辆费用       | [DRIVING.md](DRIVING.md)           |
| 住宿、门票与餐饮     | [EXPERIENCES.md](EXPERIENCES.md)   |
| 旅行团条款           | [TOURS.md](TOURS.md)               |
| 确定性预算           | [PRICING.md](PRICING.md)           |
| 生成、验证与版本     | [PLANS.md](PLANS.md)               |
| 分享、导出与运行保障 | [DELIVERY.md](DELIVERY.md)         |

## 建议学习方法

按职责依次看共享Zod契约、Controller、Service、仓储或外部适配、Vue面板，最后看真实测试。源码注释解释真实调用链和状态边界，关键语句使用中文JSDoc；Vue模板使用HTML注释，CSS使用块注释。

聊天业务工具绑定服务端用户与当前会话。研究子代理只有读取和预算权限。网页工作台与聊天共用相同领域服务；不能用更换入口绕过价格性质、归属或版本校验。

先执行 `pnpm storage:up`、`pnpm check`，再启动 `pnpm dev`。无模型Key可操作人工需求、资料、费用、版本和导出；真实问答、MCP与授权库存需要后端配置。不要把协议fixture或测试环境报价当作生产库存。
