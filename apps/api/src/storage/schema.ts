/** 引入 PostgreSQL 的强类型表定义，查询和事务由 Drizzle ORM 检查。 */
import { pgTable, uuid, varchar, text, timestamp, boolean, index } from 'drizzle-orm/pg-core';
/** 用户表只保存公开身份和禁用标志，密码单独存放。 */
export const users = pgTable('users', {
  /** 用户ID由数据库生成，邮箱先规范化再做唯一约束。 */
  id: uuid('id').defaultRandom().primaryKey(), email: varchar('email', { length: 254 }).notNull().unique(), displayName: varchar('display_name', { length: 50 }).notNull(),
  /** 所有时间以带时区时间戳保存，禁用状态由服务端检查。 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), disabledAt: timestamp('disabled_at', { withTimezone: true }),
/** 结束用户表定义。 */
});
/** 密码凭据与公开用户分表，避免常规查询误返回密码摘要。 */
export const credentials = pgTable('credentials', {
  /** 每个用户当前只允许一个密码凭据，删除用户时级联清理。 */
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }), passwordHash: text('password_hash').notNull(),
/** 结束凭据表。 */
});
/** 刷新会话是一组轮换令牌的共同撤销边界。 */
export const refreshSessions = pgTable('refresh_sessions', {
  /** 会话ID也写入短期JWT，登出后可立即拒绝旧访问令牌。 */
  id: uuid('id').defaultRandom().primaryKey(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 固定到期时间不随刷新无限后移；revokedAt用于撤销整个令牌族。 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), revokedAt: timestamp('revoked_at', { withTimezone: true }),
/** 结束刷新会话表。 */
});
/** 保留已消耗令牌摘要以检测重放，绝不保存刷新令牌明文。 */
export const refreshTokens = pgTable('refresh_tokens', {
  /** 每次刷新生成新ID与摘要，关联同一个会话族。 */
  id: uuid('id').defaultRandom().primaryKey(), sessionId: uuid('session_id').notNull().references(() => refreshSessions.id, { onDelete: 'cascade' }), tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  /** consumedAt非空代表该令牌已经轮换，重复提交将撤销会话族。 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), consumedAt: timestamp('consumed_at', { withTimezone: true }),
/** 结束令牌摘要表。 */
});
/** 旅行者偏好按用户唯一保存，后续需求模块可扩展。 */
export const travelerProfiles = pgTable('traveler_profiles', {
  /** 用户身份只能来自鉴权上下文，不能由请求体自报。 */
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }), homeCity: varchar('home_city', { length: 80 }).default('').notNull(),
  /** 只保存基础模式与节奏，数据库迁移还会添加枚举检查约束。 */
  preferredMode: text('preferred_mode').default('independent').notNull(), pace: text('pace').default('balanced').notNull(),
/** 结束旅行资料表。 */
});
/** 会话仅保存元数据，消息、模型运行与重放在第三模块实现。 */
export const conversations = pgTable('conversations', {
  /** 所有权是每条会话的必填字段。 */
  id: uuid('id').defaultRandom().primaryKey(), userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }), title: varchar('title', { length: 80 }).notNull(), archived: boolean('archived').default(false).notNull(),
  /** 分页按不可变创建时间和ID排序，改名不造成重复或遗漏。 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
/** 用户与创建时间索引支持归属查询和游标分页。 */
}, (table) => [index('conversations_owner_created_idx').on(table.userId, table.createdAt, table.id)]);
/** 审计只记录动作和资源ID，不记录密码、聊天原文或凭据。 */
export const auditEvents = pgTable('audit_events', {
  /** 用户注销后保留匿名审计记录，不能反向恢复用户凭据。 */
  id: uuid('id').defaultRandom().primaryKey(), userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }), action: varchar('action', { length: 64 }).notNull(), targetId: text('target_id'), createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
/** 结束审计表。 */
});
