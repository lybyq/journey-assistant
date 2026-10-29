# 交通查询：城际交通与落地接驳

入口：`travel-transport/transport.service.ts`；界面：`TransportPanel.vue`；授权HTTP边界：`travel-suppliers/supplier.service.ts`。

## 铁路链路

中文城市/站名 → 12306 MCP站码解析 → 直达或中转查询 → 每席别标准化 → 保存 TransportOption 与对应费用。查询限制今天起15个日历日，具体起售时点仍以12306为准；中转总价未取得时保持未知。

铁路票面结果为成人参考价，标为 MCP 估算；余票可用不等于已出票。儿童票种与接驳费用必须另行确认。站前接驳、候车缓冲、离站接驳分别计入门到门时间。

## 航班链路

明确IATA机场代码 → 已确认日期/成人儿童 → Amadeus OAuth → Flight Offers Search → 供应商实际币种/全体旅客总价。往返各程保留独立时间，但共享一个费用ID，避免把往返总价累计两遍。

`AMADEUS_ENV=test` 始终显示 TEST 非生产报价。生产环境报价也只有短有效期；行李、座位、退改和出票前核价需重新确认。儿童年龄不齐或存在婴儿时明确拒绝按普通儿童查询。

接口：`POST /trips/:id/transport/rail`、`/flights`，正文为 `{ revision, input }`。没有授权配置返回503；不会使用伪造航班。当前为查询与方案选择，不包含预订和支付。

本地协议测试验证站码、余票、OAuth、币种、全体旅客价格与取消。真实供应商权限和覆盖范围需使用自己的授权账户验收。
