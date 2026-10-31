# 国内安排链路学习指南

先读[工程链路 Spec](specs/domestic-one-click-travel.md)和[商品聚合核心 Spec](specs/domestic-offer-aggregation.md)，再按请求实际流向阅读源码。范围是国内个人出行、免费规划与预订导流；合作平台有能力不等于本部署已获得商品接口。国内酒店、餐饮、门票的多平台商品聚合尚未完成，地点推荐和渠道目录不能替代实体/SKU匹配、报价与验价。

| 入口/职责      | 对应源码                                                                                             | 需要理解的边界                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 一键安排与聊天 | `apps/web/src/components/chat/ChatComposer.vue`、`apps/api/src/modules/travel/travel-agent-tools.ts` | 普通发送与一键安排分开；Agent身份由服务端闭包绑定；恢复阶段只读，不重放选择或写入                      |
| 工作流         | `apps/api/src/modules/domestic-planning/domestic-planning.service.ts`                                | 复用真实领域服务，采集限65秒，接驳限30秒，一轮最多32次内部MCP调用；失效渠道保留缺项，不造库存          |
| 组合与排序     | `choice-candidates.ts`                                                                               | 已知CNY单价、门到门耗时、席别舒适度是不同参考策略；排除无票，匹配去返程，保留必去点，再按组合签名去重  |
| 排程与校验     | `travel-plans/auto-plan.ts`、`plan-validator.ts`                                                     | 返程固定为结束边界；必去点优先；活动分散到剩余日期；真实路线继续接受营业、预算和时空校验               |
| 给模型的事实   | `decision-summary.ts`                                                                                | 只返回本方案选中的车次/席别；金额引用版本冻结快照；编号与画布一致，避免模型在全部候选里误配            |
| 冻结与失效     | `0007_domestic_options.sql`、`travel.repository.ts`                                                  | JSONB可能重排键，指纹先稳定序列化；保存候选不自动改变选中指针；CAS拒绝并发覆盖；报价过期不等于没有资源 |
| 后续对话       | `realtime/runtime.repository.ts`、`agent/agent.prompt.ts`                                            | 查询同用户同会话的需求、当前版本、方案顺序，作为普通数据传模型；用户说第几套时调用受控选择工具         |
| 界面编排       | `features/domestic/use-domestic-decision.ts`、`components/domestic/`                                 | 网络与呈现分离；切换账户/会话时取消旧请求并清空私有数据；本地预览与正式选择分开                        |
| 渠道和跳转     | `provider-catalog.ts`、`domestic-planning.controller.ts`                                             | `implemented`与渠道能力/开通状态分开；只接受固定渠道标识，拒绝原型键和任意URL；入口请求不代表成交      |

## 价格与时间的关键细节

金额用整数分。未知金额是null，不是0；已知小计、预备金、完整预算与可比较资格分开。地图餐厅人均不能替代本次订单金额，地图酒店不能替代日期/房型库存。当前页面仅提供固定消费者查询入口，商品直达和返佣取链要等真实合作适配器。

12306-mcp 0.3.10把列车始发日写入start_date。沿途上车应使用本次查询日与上车时刻，按实际历时推算到达日；不能因此把11月2日的返程误存成11月1日。`railTimes`覆盖跨午夜场景。进站/离站30分钟是规划预留，不能称作已验证的接驳路线。

模型选工具的次数与工作流内部MCP查询次数不是同一统计。执行面板逐个展示真实MCP名称、脱敏参数和返回值，不展示隐藏推理。搜索抽取失败时，已保存摘要仍可用，但不能宣称全文或营业预约条件已经核实。

## 验证

`pnpm check`执行格式、类型、独立数据库/Redis及协议测试和构建。新增回归重点在`tests/domestic-planning.test.ts`与`tests/travel-api.e2e.test.ts`；供应商解析、未知自驾费用和错误原因在`tests/travel-suppliers.e2e.test.ts`、`tests/agent-mcp.e2e.test.ts`。

真实模型联调和外部平台权限的实际范围见[验证记录](VERIFICATION.md)。本地fixture不能证明已经有商业生产库存。
