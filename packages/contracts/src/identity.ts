/** 身份与持久化接口使用同一运行时校验规则，禁止仅靠 TypeScript 信任网络输入。 */
import { z } from 'zod';
/** 统一邮箱大小写并限制长度，数据库对规范化结果建立唯一索引。 */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
/** 不裁剪密码空格；支持长口令，不使用易误判的字符组合规则。 */
export const passwordSchema = z
  .string()
  .min(15, '密码至少需要15个字符')
  .max(128, '密码不能超过128个字符');
/** 注册只接受指定字段，用户无法通过额外字段给自己设置身份或权限。 */
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(50),
  })
  .strict();
/** 登录沿用相同长度上限，避免超大输入消耗密码派生资源。 */
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
/** 用户公开结构永远不包含密码、刷新令牌及其摘要。 */
export const userSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  displayName: z.string(),
  createdAt: z.string().datetime(),
});
/** 从共享校验器推导公开用户类型。 */
export type PublicUser = z.infer<typeof userSchema>;
/** 登录和刷新只把短期访问令牌交给网页内存；刷新令牌仅放 HttpOnly Cookie。 */
export const authResponseSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
/** 从认证结构推导浏览器收到的认证类型。 */
export type AuthResponse = z.infer<typeof authResponseSchema>;
/** 旅行者基础资料不包含证件号码等当前模块不需要的敏感信息。 */
export const profileSchema = z.object({
  homeCity: z.string().trim().max(80),
  preferredMode: z.enum(['independent', 'driving', 'group']),
  pace: z.enum(['relaxed', 'balanced', 'intensive']),
});
/** 资料类型可以在旅行需求扩展旅行约束，不与身份凭据混用。 */
export type TravelerProfile = z.infer<typeof profileSchema>;
/** 资料更新必须至少包含一个已知字段。 */
export const profileUpdateSchema = profileSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项资料');
/** 用户显示名可独立修改，不接受客户端传入 userId。 */
export const userUpdateSchema = z
  .object({ displayName: z.string().trim().min(1).max(50) })
  .strict();
/** 会话公开结构只包含元数据；消息和运行事件属于持久化对话。 */
export const conversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  archived: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
/** 从校验器推导持久化会话类型。 */
export type Conversation = z.infer<typeof conversationSchema>;
/** 新建会话不允许外部指定所有者。 */
export const conversationCreateSchema = z
  .object({ title: z.string().trim().min(1).max(80).default('新的旅行') })
  .strict();
/** 更新支持改名与可恢复归档，不提供不可恢复删除。 */
export const conversationUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, '至少修改一项会话信息');
/** 列表使用明确布尔字符串和UUID游标，避免字符串false被当作true。 */
export const conversationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().uuid().optional(),
    archived: z.enum(['true', 'false']).default('false'),
  })
  .strict();
/** 分页返回显式游标，客户端不猜测下一页。 */
export const conversationListSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().uuid().nullable(),
});
/** 数据服务就绪状态与基础进程存活状态分开，避免把没连接的数据库标成健康。 */
export const storageStatusSchema = z.object({
  enabled: z.boolean(),
  postgres: z.enum(['ready', 'unavailable', 'disabled']),
  redis: z.enum(['ready', 'unavailable', 'disabled']),
});
