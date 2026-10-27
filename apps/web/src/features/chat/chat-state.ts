/** 使用共享协议，让状态归约器可被 Web 和未来小程序共同使用。 */
import type { ServerEvent } from "@journey/contracts";
/** 定义一次工具执行的公开记录。 */
export interface ToolTrace {
  /** callId 对齐开始与完成事件；name 保留真实工具名称。 */
  callId: string;
  name: string;
  /** 只保存后端已脱敏的数据，UI 不执行其中任何代码。 */
  input: Record<string, unknown>;
  output?: unknown;
  /** 标记工具执行状态及实际耗时。 */
  status: "running" | "completed" | "interrupted";
  durationMs?: number;
  /** 结束工具记录结构。 */
}
/** 定义单次框架运行的界面状态，不与服务器历史持久化混为一谈。 */
export interface ChatState {
  /** status 只描述本地可见运行状态。 */
  status: "idle" | "running" | "completed" | "cancelled" | "failed";
  /** 当前运行标识阻止旧连接数据污染新的回答。 */
  runId: string | null;
  /** 保存本次用户输入和已经收到的 Markdown 文本。 */
  question: string;
  answer: string;
  /** 步骤说明只来自公开 progress 事件。 */
  progress: { title: string; detail: string }[];
  /** 当前运行的真实工具记录。 */
  tools: ToolTrace[];
  /** 可读失败信息供 aria-live 区域通知用户。 */
  error: string;
  /** 结束聊天状态结构。 */
}
/** 每次新建状态都返回全新数组，防止不同运行共享可变集合。 */
export function initialChatState(): ChatState {
  return {
    status: "idle",
    runId: null,
    question: "",
    answer: "",
    progress: [],
    tools: [],
    error: "",
  };
}
/** 将单个已验证服务事件归约成状态；纯函数便于测试取消和乱序隔离。 */
export function reduceChatEvent(
  state: ChatState,
  event: ServerEvent,
): ChatState {
  /** 会话握手由连接层管理，不改变聊天回答。 */
  if (event.type === "session.ready") return state;
  /** 不接收其他运行的数据；null runId 的协议错误仍允许显示。 */
  if (event.runId && event.runId !== state.runId) return state;
  /** 当前运行进入终态后，忽略迟到的文本和工具事件。 */
  if (["completed", "cancelled", "failed"].includes(state.status)) return state;
  /** 每类事件明确更新对应字段，不使用动态键修改导致隐式耦合。 */
  switch (event.type) {
    /** 开始运行时确认加载状态。 */
    case "run.started":
      return { ...state, status: "running" };
    /** 公开步骤使用只读数组追加方式更新。 */
    case "run.progress":
      return { ...state, progress: [...state.progress, event.payload] };
    /** 工具开始时保留真实名称和参数。 */
    case "tool.started":
      return {
        ...state,
        tools: [...state.tools, { ...event.payload, status: "running" }],
      };
    /** 根据 callId 精确完成同一次工具执行。 */
    case "tool.completed":
      return {
        ...state,
        tools: state.tools.map((tool) =>
          tool.callId === event.payload.callId
            ? {
                ...tool,
                output: event.payload.output,
                durationMs: event.payload.durationMs,
                status: "completed",
              }
            : tool,
        ),
      };
    /** 仅追加当前运行的 Markdown 增量。 */
    case "message.delta":
      return { ...state, answer: state.answer + event.payload.content };
    /** 完成后进入不可继续追加的成功终态。 */
    case "run.completed":
      return { ...state, status: "completed" };
    /** 取消时保留已收到的内容，工具未完成则标记中断。 */
    case "run.cancelled":
      return {
        ...state,
        status: "cancelled",
        tools: state.tools.map((tool) =>
          tool.status === "running" ? { ...tool, status: "interrupted" } : tool,
        ),
      };
    /** 错误信息来自受控协议，不显示内部堆栈。 */
    case "run.failed":
      return {
        ...state,
        status: "failed",
        error: event.payload.message,
        tools: state.tools.map((tool) =>
          tool.status === "running" ? { ...tool, status: "interrupted" } : tool,
        ),
      };
    /** 结束穷尽事件分支。 */
  }
  /** 结束纯事件归约器。 */
}
