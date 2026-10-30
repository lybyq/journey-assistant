/** 执行器只使用持久化对话的持久化事件出口。 */
import type { ServerEvent } from '@journey/contracts';
/** 生产者等待落库，禁止无限缓存事件。 */
export type PublishEvent = (type: ServerEvent['type'], payload: unknown) => Promise<void>;
/** 上下文只能由服务端归属查询生成。 */
export interface AgentInput {
  /** 这三个标识构成checkpoint隔离命名空间。 */
  runId: string;
  /** 已经通过格式校验并落库的最终正文，重启只补发缺少的后缀，不再调用模型。 */
  delivery?: { answer: string; published: string };
  /** 服务重启后仅整理持久化事实，禁止自动重放未确认的业务写入。 */
  recovery?: {
    toolResults: unknown[];
    modelCalls: number;
    toolCalls: number;
    totalTokens: number;
    estimated: boolean;
    subagents: number;
  };
  /** 归属用户来自鉴权上下文与数据库，不能信任浏览器自报。 */
  userId: string;
  /** 当前会话已经由持久化对话校验归属。 */
  conversationId: string;
  /** 已裁剪的普通角色历史，不能注入system角色。 */
  messages: {
    /** 只允许普通消息角色，历史内容不能成为系统指令。 */
    role: 'user' | 'assistant';
    /** 正文已按完整消息边界裁剪，失败回复不进入记忆。 */
    content: string;
  }[];
  /** 偏好是数据，不能提升为指令权限。 */
  /** 当前会话项目的结构化事实，避免只依赖截断的聊天历史。 */
  travelContext?: unknown;
  profile: {
    /** 用户保存的常住城市，仍可能与本次出发地不同。 */
    homeCity: string;
    /** 自由行、自驾、跟团偏好供本轮回答参考。 */
    preferredMode: string;
    /** 旅行节奏只作为用户资料，不覆盖当前明确要求。 */
    pace: string;
  };
}
/** 稳定错误码交给持久化对话发布唯一失败终态。 */
export class ExecutionError extends Error {
  /** 只传受控说明，不传SDK异常原文。 */
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}
/** LangChain中间件会包裹异常；只解出我们自己的受控错误，不公开任意cause。 */
export function findExecutionError(error: unknown): ExecutionError | undefined {
  let current = error;
  for (let depth = 0; depth < 16; depth += 1) {
    if (current instanceof ExecutionError) return current;
    if (!current || typeof current !== 'object' || !('cause' in current)) return undefined;
    current = current.cause;
  }
  return undefined;
}
