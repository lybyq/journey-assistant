/** 使用纯归约器测试真实运行边界，避免依赖 Vue 组件内部实现。 */
import { describe, expect, it } from 'vitest';
/** 共享事件必须先通过相同协议校验。 */
import { serverEventSchema, type ServerEvent } from '@journey/contracts';
/** 加载无浏览器依赖的会话状态函数。 */
import { initialChatState, reduceChatEvent } from '../apps/web/src/features/chat/chat-state';
/** 为测试构造有效且可关联的事件。 */
function event(type: ServerEvent['type'], payload: unknown, runId = 'ac782c43-e687-457f-a41a-b1e322fe1f74'): ServerEvent { return serverEventSchema.parse({ protocolVersion: 1, id: crypto.randomUUID(), runId, sequence: 1, timestamp: new Date().toISOString(), type, payload }); }
/** 只验证容易造成错答或加载不结束的状态边界。 */
describe('对话事件隔离', () => {
  /** 其他运行的迟到数据不能出现在当前回答里。 */
  it('拒绝其他运行的文本', () => { const state = { ...initialChatState(), status: 'running' as const, runId: crypto.randomUUID() }; expect(reduceChatEvent(state, event('message.delta', { content: '旧文本' }))).toBe(state); });
  /** 取消后即使网络继续投递文本也不能改变已停止的回答。 */
  it('取消后忽略后续增量', () => { const cancelled = { ...initialChatState(), status: 'cancelled' as const, runId: 'ac782c43-e687-457f-a41a-b1e322fe1f74' }; expect(reduceChatEvent(cancelled, event('message.delta', { content: '迟到文本' })).answer).toBe(''); });
  /** 协议版本不一致应失败，而不是带着不匹配字段进入 UI。 */
  it('拒绝未支持的协议版本', () => { const message = event('message.delta', { content: '正文' }); expect(serverEventSchema.safeParse({ ...message, protocolVersion: 2 }).success).toBe(false); });
/** 结束纯状态测试。 */
});
