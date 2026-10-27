/** 生产对话请求和持久化快照与客户端共用运行时校验。 */
import { z } from 'zod';
/** 事件沿用第一模块的公开执行协议，序号改为会话级持久化序号。 */
import { serverEventSchema } from './index.js';
/** 请求标识用于重试去重；不能由客户端指定用户或系统提示词。 */
export const startRunSchema = z.object({ requestId: z.string().uuid(), message: z.string().trim().min(1).max(2000) }).strict();
/** 运行状态仅允许一个不可逆的终态。 */
export const runStatusSchema = z.enum(['running', 'completed', 'cancelled', 'failed']);
/** 对外只提供公开运行信息，不返回工作进程、会话令牌和租约。 */
export const persistedRunSchema = z.object({ id: z.string().uuid(), requestId: z.string().uuid(), conversationId: z.string().uuid(), status: runStatusSchema, createdAt: z.string().datetime() });
/** 消息顺序由数据库分配，不按浏览器时间排序。 */
export const persistedMessageSchema = z.object({ id: z.string().uuid(), runId: z.string().uuid(), role: z.enum(['user', 'assistant']), content: z.string().max(32768), position: z.number().int().positive(), createdAt: z.string().datetime(), status: runStatusSchema });
/** 单页最多返回五十条消息，before只接受当前会话真实消息ID。 */
export const messageQuerySchema = z.object({ before: z.string().uuid().optional(), limit: z.coerce.number().int().min(2).max(50).default(30) }).strict();
/** 游标表示已经完整归约的最后事件，允许零表示从头补发。 */
export const eventQuerySchema = z.object({ after: z.coerce.number().int().min(0).max(2147483647).default(0) }).strict();
/** 同一数据库锁内读取消息、最新运行、轨迹和水位，避免恢复时丢失增量。 */
export const conversationSnapshotSchema = z.object({ items: z.array(persistedMessageSchema).max(50), nextCursor: z.string().uuid().nullable(), run: persistedRunSchema.nullable(), events: z.array(z.lazy(() => serverEventSchema)).max(512), sequence: z.number().int().nonnegative() });
/** 提交返回已保存的运行身份，重复请求会返回同一个运行。 */
export const startRunResponseSchema = z.object({ run: persistedRunSchema });
/** 导出纯类型供网页和后续执行器复用。 */
export type PersistedMessage = z.infer<typeof persistedMessageSchema>;
/** 运行记录不包含内部所有权字段。 */
export type PersistedRun = z.infer<typeof persistedRunSchema>;
/** 快照类型与实际JSON校验一致。 */
export type ConversationSnapshot = z.infer<typeof conversationSnapshotSchema>;
