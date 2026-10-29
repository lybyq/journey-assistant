# 实时事件协议 v1

## 持久化对话生产通道

网页已切换为Bearer认证的HTTP/SSE：`GET /api/v1/conversations/:id/events?after=<已确认序号>`。序号在同一会话内持久化递增，断线后补发且不取消后台运行；每秒心跳，25秒轮换连接。历史快照和运行/取消接口详见[持久化对话协议与恢复说明](CONVERSATION.md)。以下 `/ws/chat` 内容仅描述保留的工程底座匿名开发诊断，不能用于生产私有对话。

## 开发诊断地址与封装

开发 WebSocket 地址：`ws://127.0.0.1:3000/ws/chat`。该匿名诊断通道不用于生产部署。Vite 同源代理 `/ws`。

当前使用 Nest 原生 ws 适配器，客户端发送格式为：

```json
{
  "event": "diagnostic.start",
  "data": {
    "requestId": "ac782c43-e687-457f-a41a-b1e322fe1f74",
    "message": "检查当前框架连接"
  }
}
```

`requestId` 是 UUID；message 去除前后空白后 1～2000 字。当前每个连接最多接收 100 个不同请求，且同一时间只运行一个请求。客户端不能指定任意工具名或服务 URL。

取消当前连接自己的运行：

```json
{
  "event": "run.cancel",
  "data": { "requestId": "ac782c43-e687-457f-a41a-b1e322fe1f74" }
}
```

## 服务事件公共字段

| 字段            | 说明                                           |
| --------------- | ---------------------------------------------- |
| protocolVersion | 当前固定为 1                                   |
| id              | 每条事件独立 UUID                              |
| runId           | 所属请求 UUID；连接事件和无法归属的错误为 null |
| sequence        | 当前连接内严格递增序号；当前不提供跨连接重放   |
| timestamp       | UTC ISO 时间；页面可按用户时区展示             |
| type            | 判别联合的事件名                               |
| payload         | 必须与该事件类型对应的校验结构                 |

完整运行示例：

```text
session.ready
run.started          # mode=diagnostic，明确不是实际旅行规划
run.progress         # 公开步骤摘要
tool.started         # system.health，input={}
tool.completed       # 真实 HealthSnapshot 与实际 durationMs
message.delta        # 可重复多次，拼接成 Markdown
run.completed        # 唯一成功终态
```

失败或取消改为 `run.failed` / `run.cancelled`，不再发送成功终态。客户端必须丢弃其他 runId 和已终态运行的迟到正文。断线终止服务端所属运行，网页保留已收到文本并显示连接错误。

## 事件字段

| type           | payload                          | 用途                               |
| -------------- | -------------------------------- | ---------------------------------- |
| session.ready  | scope、message                   | 协议握手，当前 scope=foundation    |
| run.started    | mode、message                    | 明确当前执行模式                   |
| run.progress   | title、detail                    | 可核验的公开执行摘要               |
| tool.started   | callId、name、input              | 实际工具名称及白名单参数           |
| tool.completed | callId、name、output、durationMs | 诊断为健康快照；业务为安全结果信封 |
| message.delta  | content                          | 已确认的回答文本增量               |
| run.completed  | message                          | 成功终态                           |
| run.cancelled  | message                          | 用户停止或连接断开引发的中止       |
| run.failed     | code、message                    | 受控错误，不发送底层堆栈           |

实时运行、智能体编排和MCP工具共同扩展业务 schema，而不是把任意 unknown 工具结果未经校验直接透传。修改协议时同时更新共享包、服务端发送、前端归约与契约测试。

## 当前安全边界

- 消息体最大 16KB；诊断输入还受 schema 限制。
- HTTP 与浏览器 WebSocket 使用同一精确 Origin 白名单。
- 开发诊断不是身份鉴权，不应用于公网生产业务。
- 连接状态存放在连接专属 WeakMap；不能取消其他连接任务。
- 健康结果只公开 configured/connected，不公开任何 Key 或 URL。
- Markdown 先解析再用允许列表净化；不允许 iframe、script、图片、表单、事件属性或任意内联样式。
- 点击来源仅允许绝对 HTTP/HTTPS URL，新窗口不保留 opener。

## 真实业务通道

持久化运行：身份绑定、心跳、事件持久化、游标恢复、补发与背压；详见生产通道文档。

智能体编排：把 SDK 实际流映射成公开事件；隐藏推理与系统提示词不进入该协议。

MCP工具：工具错误、截断结果、超时、取消信号、脱敏摘要与受控原始结果详情。

预算与行程：结构化价格表、方案版本、行程段与来源引用，不依赖解析 Markdown 才能提取业务数据。
