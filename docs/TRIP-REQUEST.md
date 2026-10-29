# 旅行需求：旅行画像与需求澄清

已实现。先读 `packages/contracts/src/trip-request.ts`，再读 `apps/api/src/modules/trip-request/request.service.ts`，最后看 `TripRequestEditor.vue` 和 `travel.service.ts`。

## 调用链

网页自然语言 → `POST /api/v1/trips/parse` → 中文数字和上海日历解析 → 表单预览 → 用户保存 → `PATCH /trips/:id` → normalize → PostgreSQL。Agent 的 `journey_trip_update` 也走同一服务，并绑定服务端账户与会话。

## 学习重点

- `null` 表示未确认，儿童人数为 `0` 才表示确认没有儿童；不能把未填人数当成两人。
- “三天两晚”、日期范围、成人儿童与老人子集分别验证；预算保留总额/人均和币种，金额采用最小单位。
- “明天”按 Asia/Shanghai 的日历解析，目的地时区另存。解析是有限的确定性规则；复杂口语由智能体澄清后提交结构化字段。
- Zod 4 的默认字段在 `.partial()` 中仍可能生效。补丁逐字段 `removeDefault().optional()`，防止只改目的地时把原有日期、人数覆盖。
- 每次修改带 `revision`，仓储行锁加 CAS，旧页面收到409后刷新。

## 自己动手验收

创建项目，输入“明天从杭州去苏州，两大一小，三天两晚，人均预算3000元”。检查成人2、儿童1、年龄未知、人均预算与跨月日期。随后只改标题，确认其他字段不变。两个页面同时保存，后提交的旧修订号必须失败。

自动化见 `tests/travel-domain.test.ts` 与 `tests/travel-api.e2e.test.ts`。本模块只确认需求，不提供出票、预约或支付。
