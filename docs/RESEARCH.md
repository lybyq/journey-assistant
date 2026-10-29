# 资料检索：旅游资料与证据检索

入口：`apps/api/src/modules/travel-research/`；契约：`travel-evidence.ts`；界面：`ResearchPanel.vue`。

## 调用链

`POST /trips/:id/research` → 归属与修订检查 → 6小时缓存 → Tavily Search → 同运行许可集合内的 Extract → 有界摘录 → 保存 Evidence。最多5个结果、抽取其中3个；供应商结果不等于全网覆盖。

## 学习重点

- `publishedAt` 是文章发布时间，`checkedAt` 是本次查询时间，`expiresAt` 控制资料新鲜度，三者不可替代。
- 抽取失败保留搜索摘要，但标注 `failed` 或 `snippet_only`；不能把摘要称为已读取全文。
- 刷新同一规范URL保留原证据ID；旧行程版本另有冻结来源快照，不会跟着刷新变化。
- 官网身份由有限域名规则确定；人工录入始终 `manual`。页面声称“我是官网”不能提升身份。
- 网页中出现起价只形成营销价格证据；不会自动生成可订报价。
- MCP的URL许可、公共地址限制、注入防护和秘密清理延续MCP工具中心；页面内容不能变成系统指令。

接口还有 `POST /trips/:id/research/manual`。在页面录入公开链接和核对摘录，内网地址应被拒绝。重复检索同问题命中缓存；点刷新才重新访问供应商。

阅读 `tests/travel-suppliers.e2e.test.ts` 中 Search→Extract 的真实JSON-RPC fixture：它测试协议、保存和缓存，并非访问真实Tavily额度。
