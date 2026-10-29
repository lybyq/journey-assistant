# 旅行团：旅行团与产品条款

入口：`travel-tours/tour.service.ts`、`travel-suppliers/supplier.service.ts`；页面：`TourPanel.vue`。

## 产品如何进入系统

人工录入有来源的产品条款，始终保留人工身份。或者接入自己的授权旅行团网关：配置后端 `TOUR_GATEWAY_URL` 与 `TOUR_GATEWAY_KEY`，服务只调用固定的 `POST /v1/tours/search`。

网关是本项目定义的适配合约，需要部署方将已签约供应商映射为该结构；配置一个任意旅游网站网址并不能直接取得报价。没有网关时返回503，仍可录入公开条款。

## 网关合约

请求只包含 origin、destination、startDate、endDate、adults、children、childAges、rooms、hotelStandard、currency；不传账户、Cookie、聊天历史或自由备注。

响应为 `{ products: TourProduct[] }`，严格结构见 `packages/contracts/src/travel-options.ts` 和 `travel-pricing.ts`。保留团期、天数、酒店标准、包含/不包含、购物、自费、单房差、导游、接送、退改、公开链接及价格条件。`dailySchedule` 可提供第几天、起止分钟、标题、点位和备注；空数组明确表示尚未取得逐日安排。

服务端重新生成产品/报价ID，固定供应商身份、查询时间及默认不选择。团期与人数不匹配会拒绝；`live_quote` 必须有明确有效期。页面起价保留 `advertised`，永不升级为可订报价。

行程版本选中产品后才引用其费用和日程；缺单房差、退改、酒店标准或日程时继续待确认。产品包含项通过预算计算排除重复酒店/交通费用。

接口：`POST /trips/:id/tours/search` 与 `/manual`。该模块不进行代客签约、下单和支付。
