/** 令牌由密码学安全随机源生成，数据库只保存SHA256摘要。 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
/** 使用固定响应的认证异常，不透传数据库错误。 */
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  /** 基础设施故障不能伪装成身份失效。 */
  ServiceUnavailableException,
} from '@nestjs/common';
/** Drizzle负责参数化查询、归属过滤与事务。 */
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
/** JOSE负责签名与校验，明确限制算法、受众和签发方。 */
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
/** 公开用户与认证结果共享校验器，防止把密码字段返回客户端。 */
import { userSchema, type AuthResponse, type PublicUser } from '@journey/contracts';
/** 读取服务端签名和过期时间设置。 */
import { AppConfig } from '../../config/config.module.js';
/** 真实数据库和缓存由基础存储服务管理。 */
import { StorageService } from '../../storage/storage.module.js';
/** 引入身份、凭据、令牌族和审计实体。 */
import {
  users,
  credentials,
  refreshSessions,
  refreshTokens,
  travelerProfiles,
  auditEvents,
} from '../../storage/schema.js';
/** 密码验证不在控制器中实现。 */
import { PasswordService } from './password.service.js';
/** 鉴权上下文由服务端签名及数据库状态推导，客户端不能自行声明。 */
export interface Actor {
  userId: string;
  sessionId: string;
  user: PublicUser;
}
/** 仅挑选公开用户字段并规范化时间。 */
export function publicUser(user: typeof users.$inferSelect): PublicUser {
  return userSchema.parse({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  });
}
/** 使用高熵令牌的不可逆摘要匹配数据库记录。 */
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
/** 认证与令牌族撤销集中在一个事务边界。 */
@Injectable()
/** 所有访问令牌都绑定真实数据库会话，登出立即生效。 */
export class AuthService {
  /** 注入数据库、配置和密码服务。 */
  constructor(
    private readonly storage: StorageService,
    private readonly config: AppConfig,
    private readonly passwords: PasswordService,
  ) {}
  /** 注册用户、凭据、资料、会话和审计记录必须同时成功。 */
  async register(input: { email: string; password: string; displayName: string }) {
    /** 先确认真实数据库可用，再执行较昂贵的密码派生。 */
    const db = this.storage.db;
    const passwordHash = await this.passwords.hash(input.password);
    /** 首个登录会话与账户注册在同一事务内落库，防止半注册状态。 */
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.env.REFRESH_TOKEN_DAYS * 86400000);
    const refreshToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
    /** 事务外捕获唯一约束错误，但不暴露数据库内部字段。 */
    try {
      /** 创建用户时只使用schema允许的三个注册字段。 */
      const user = await db.transaction(async (tx) => {
        /** 数据库唯一索引处理并发注册的竞争条件。 */
        const [created] = await tx
          .insert(users)
          .values({ email: input.email, displayName: input.displayName })
          .returning();
        /** 未生成用户时终止整个事务。 */
        if (!created) throw new Error('用户创建失败');
        /** 凭据和基础资料只关联数据库刚生成的用户ID。 */
        await tx.insert(credentials).values({ userId: created.id, passwordHash });
        await tx.insert(travelerProfiles).values({ userId: created.id });
        /** 审计不保存注册密码或原始请求。 */
        await tx.insert(auditEvents).values({
          userId: created.id,
          action: 'user.registered',
          targetId: created.id,
        });
        /** 创建首个令牌族及摘要，任一步失败都回滚账户与凭据。 */
        await tx.insert(refreshSessions).values({ id: sessionId, userId: created.id, expiresAt });
        await tx.insert(refreshTokens).values({ sessionId, tokenHash: tokenHash(refreshToken) });
        /** 注册会话与普通登录一样留下无敏感值的审计。 */
        await tx.insert(auditEvents).values({
          userId: created.id,
          action: 'session.created',
          targetId: sessionId,
        });
        return created;
        /** 结束用户注册事务。 */
      });
      /** 新账户建立单独登录会话。 */
      return {
        response: await this.issueAccess(user, sessionId),
        refreshToken,
        expiresAt,
      };
      /** 唯一约束错误可能被ORM包在cause中。 */
    } catch (error) {
      const cause = error as { cause?: { code?: string }; code?: string };
      if ((cause.cause?.code ?? cause.code) === '23505')
        throw new ConflictException('该邮箱已注册，请直接登录');
      throw error;
    }
    /** 结束注册。 */
  }
  /** 登录失败统一提示，未知邮箱也执行真实密码派生。 */
  async login(input: { email: string; password: string }) {
    /** 通过规范化邮箱查询用户及独立凭据表。 */
    const [entry] = await this.storage.db
      .select({ user: users, credential: credentials })
      .from(users)
      .innerJoin(credentials, eq(users.id, credentials.userId))
      .where(eq(users.email, input.email))
      .limit(1);
    /** 禁用账户、未知邮箱与错误密码使用相同响应。 */
    const valid = await this.passwords.verify(input.password, entry?.credential.passwordHash);
    if (!valid || !entry || entry.user.disabledAt)
      throw new UnauthorizedException('邮箱或密码不正确');
    /** 每次登录产生独立可撤销的会话族。 */
    return this.createSession(entry.user);
    /** 结束登录。 */
  }
  /** 创建登录会话；原始刷新令牌只返回给控制器写入HttpOnly Cookie。 */
  private async createSession(user: typeof users.$inferSelect) {
    /** 固定有效期在创建时确定，后续刷新不会延长此上限。 */
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.env.REFRESH_TOKEN_DAYS * 86400000);
    const refreshToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
    /** 会话和首个令牌摘要保持原子性。 */
    await this.storage.db.transaction(async (tx) => {
      await tx.insert(refreshSessions).values({ id: sessionId, userId: user.id, expiresAt });
      await tx.insert(refreshTokens).values({ sessionId, tokenHash: tokenHash(refreshToken) });
      await tx.insert(auditEvents).values({
        userId: user.id,
        action: 'session.created',
        targetId: sessionId,
      });
    });
    /** 服务端内部结果包含Cookie值，但HTTP JSON只使用response字段。 */
    return {
      response: await this.issueAccess(user, sessionId),
      refreshToken,
      expiresAt,
    };
    /** 结束会话创建。 */
  }
  /** 在共享会话行锁下消费旧刷新令牌并产生新令牌。 */
  async refresh(token: string | undefined) {
    /** 先严格验证格式，限制数据库和摘要处理成本。 */
    if (
      !token ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/.test(
        token,
      )
    )
      throw new UnauthorizedException('登录已失效，请重新登录');
    /** 会话ID只是查找线索，只有正确随机秘密的摘要匹配才有效。 */
    const sessionId = token.slice(0, 36);
    const nextToken = `${sessionId}.${randomBytes(32).toString('base64url')}`;
    /** 重要：重放撤销在事务提交后才向外抛401，避免异常导致撤销回滚。 */
    const result = await this.storage.db.transaction(async (tx) => {
      /** 同一会话的刷新、登出和撤销都争用同一行锁，防止并发覆盖。 */
      await tx.execute(sql`SELECT id FROM refresh_sessions WHERE id=${sessionId} FOR UPDATE`);
      /** 只接受未撤销、未过期且账户有效的会话。 */
      const [entry] = await tx
        .select({ session: refreshSessions, user: users })
        .from(refreshSessions)
        .innerJoin(users, eq(users.id, refreshSessions.userId))
        .where(
          and(
            eq(refreshSessions.id, sessionId),
            isNull(refreshSessions.revokedAt),
            gt(refreshSessions.expiresAt, new Date()),
            isNull(users.disabledAt),
          ),
        )
        .limit(1);
      /** 不存在的会话统一判为无效。 */
      if (!entry) return null;
      /** 在令牌族内查找该秘密的摘要。 */
      const [stored] = await tx
        .select()
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.sessionId, sessionId),
            eq(refreshTokens.tokenHash, tokenHash(token)),
          ),
        )
        .limit(1);
      /** 猜错秘密不会撤销别人的会话，防止仅凭sessionId造成拒绝服务。 */
      if (!stored) return null;
      /** 旧令牌重复提交代表重放，撤销整个会话族并记录审计。 */
      if (stored.consumedAt) {
        await tx
          .update(refreshSessions)
          .set({ revokedAt: new Date() })
          .where(eq(refreshSessions.id, sessionId));
        await tx.insert(auditEvents).values({
          userId: entry.user.id,
          action: 'session.replay_rejected',
          targetId: sessionId,
        });
        return null;
      }
      /** 标记旧令牌已消费并保存新摘要；明文不会落库。 */
      await tx
        .update(refreshTokens)
        .set({ consumedAt: new Date() })
        .where(eq(refreshTokens.id, stored.id));
      await tx.insert(refreshTokens).values({ sessionId, tokenHash: tokenHash(nextToken) });
      /** 返回签发新访问令牌需要的公开用户与固定过期时间。 */
      return entry;
      /** 结束受行锁保护的轮换事务。 */
    });
    /** 事务已提交，重放撤销不会被此异常回滚。 */
    if (!result) throw new UnauthorizedException('登录已失效，请重新登录');
    /** 控制器只把刷新秘密写入HttpOnly Cookie。 */
    return {
      response: await this.issueAccess(result.user, sessionId),
      refreshToken: nextToken,
      expiresAt: result.session.expiresAt,
    };
    /** 结束刷新。 */
  }
  /** 签发短期JWT并限制用途，不把刷新秘密加入JWT或正文。 */
  private async issueAccess(
    user: typeof users.$inferSelect,
    sessionId: string,
  ): Promise<AuthResponse> {
    /** 使用服务端秘密对HS256签名，固定issuer与audience。 */
    const accessToken = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer('journey-api')
      .setAudience('journey-web')
      .setIssuedAt()
      .setExpirationTime(`${this.config.env.ACCESS_TOKEN_SECONDS}s`)
      .setJti(randomUUID())
      .sign(new TextEncoder().encode(this.config.env.AUTH_SECRET));
    /** 仅返回经过白名单序列化的用户。 */
    return {
      accessToken,
      expiresIn: this.config.env.ACCESS_TOKEN_SECONDS,
      user: publicUser(user),
    };
    /** 结束访问令牌签发。 */
  }
  /** 每次受保护请求检查JWT及真实登录会话，撤销后旧JWT立即失效。 */
  async authenticate(token: string): Promise<Actor> {
    /** 数据层不可用时保持503，不将基础设施故障伪装为密码错误。 */
    const db = this.storage.db;
    /** 签名错误、用途错误和会话撤销统一返回401。 */
    try {
      /** 只允许一个明确算法，并校验过期、签发方和受众。 */
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(this.config.env.AUTH_SECRET),
        {
          algorithms: ['HS256'],
          issuer: 'journey-api',
          audience: 'journey-web',
          typ: 'JWT',
        },
      );
      /** 必须同时包含合法用户和会话标识。 */
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.sub) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(payload.sid)
      )
        throw new UnauthorizedException('登录声明无效');
      /** 查询条件同时绑定用户与会话，客户端不能切换资源归属。 */
      const [entry] = await db
        .select({ user: users })
        .from(refreshSessions)
        .innerJoin(users, eq(users.id, refreshSessions.userId))
        .where(
          and(
            eq(refreshSessions.id, payload.sid),
            eq(refreshSessions.userId, payload.sub),
            isNull(refreshSessions.revokedAt),
            gt(refreshSessions.expiresAt, new Date()),
            isNull(users.disabledAt),
          ),
        )
        .limit(1);
      /** 已注销或禁用的会话不能仅凭未过期JWT继续访问。 */
      if (!entry) throw new UnauthorizedException('登录会话无效');
      return {
        userId: payload.sub,
        sessionId: payload.sid,
        user: publicUser(entry.user),
      };
      /** 不把JWT库异常原文、令牌或连接信息暴露给请求方。 */
    } catch (error) {
      /** 只有签名和身份错误返回401，避免数据库短暂故障清空用户登录。 */
      if (error instanceof joseErrors.JOSEError || error instanceof UnauthorizedException)
        throw new UnauthorizedException('登录已失效，请重新登录');
      /** 其余数据库或连接错误返回受控503，不暴露SDK原文。 */
      throw new ServiceUnavailableException('账户服务暂时不可用，请稍后重试');
    }
    /** 结束访问认证。 */
  }
  /** 登出仅接受该会话族的真实秘密，不能仅凭UUID撤销其他登录。 */
  async logout(token: string | undefined): Promise<void> {
    /** 缺少Cookie时保持幂等。 */
    if (
      !token ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/.test(
        token,
      )
    )
      return;
    /** 旧的合法令牌也可撤销自身族，避免刷新并发后无法注销。 */
    const [stored] = await this.storage.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash(token)))
      .limit(1);
    /** 不接受伪造秘密作为撤销凭据。 */
    if (!stored) return;
    /** 会话行锁让注销与刷新顺序确定。 */
    await this.storage.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM refresh_sessions WHERE id=${stored.sessionId} FOR UPDATE`,
      );
      const [session] = await tx
        .update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(eq(refreshSessions.id, stored.sessionId))
        .returning();
      if (session)
        await tx.insert(auditEvents).values({
          userId: session.userId,
          action: 'session.revoked',
          targetId: session.id,
        });
    });
    /** 结束幂等登出。 */
  }
  /** 用户可撤销自己全部会话，不能提供其他userId。 */
  async logoutAll(actor: Actor): Promise<void> {
    await this.storage.db.transaction(async (tx) => {
      await tx
        .update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshSessions.userId, actor.userId), isNull(refreshSessions.revokedAt)));
      await tx.insert(auditEvents).values({
        userId: actor.userId,
        action: 'session.revoked_all',
        targetId: actor.userId,
      });
    });
  }
  /** 结束认证服务。 */
}
