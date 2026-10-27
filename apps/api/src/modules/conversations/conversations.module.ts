/** 会话控制器只提供元数据，不提前实现第三模块的消息与模型执行。 */
import {
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
/** 文档注明所有会话操作均要求当前有效身份。 */
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
/** 使用类型安全条件组合实现归属及游标分页。 */
import { and, desc, eq, lt, or } from "drizzle-orm";
/** 共享元数据、输入及分页校验器。 */
import {
  conversationSchema,
  conversationCreateSchema,
  conversationUpdateSchema,
  conversationQuerySchema,
} from "@journey/contracts";
/** 请求边界统一使用schema管道。 */
import { SchemaPipe } from "../../common/schema.pipe.js";
/** 数据库由应用基础设施提供。 */
import { StorageService } from "../../storage/storage.module.js";
/** 会话与审计在事务中一同更新。 */
import { conversations, auditEvents } from "../../storage/schema.js";
/** 复用身份模块的可信访问守卫。 */
import { IdentityModule } from "../identity/identity.module.js";
/** 只读取守卫写入的actor，不允许客户端声明所有者。 */
import { AccessGuard, type AuthRequest } from "../identity/auth.guards.js";
/** 公开序列化不返回userId，时间统一ISO字符串。 */
function publicConversation(item: typeof conversations.$inferSelect) {
  return conversationSchema.parse({
    id: item.id,
    title: item.title,
    archived: item.archived,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  });
}
/** 会话路由在文档中独立成组。 */
@ApiTags("持久化会话")
/** 所有会话接口使用短期Bearer访问身份。 */
@ApiBearerAuth()
/** 类级守卫防止新增路由时遗漏认证。 */
@UseGuards(AccessGuard)
/** 路径只包含资源ID，不包含可伪造的userId。 */
@Controller("conversations")
/** 数据归属在每个ORM查询条件中明确表达。 */
export class ConversationsController {
  /** 注入真实存储服务。 */
  constructor(private readonly storage: StorageService) {}
  /** 按创建时间和ID进行稳定游标分页。 */
  @Get()
  /** 查询游标也必须属于当前用户和当前归档状态。 */
  async list(
    @Req() request: AuthRequest,
    @Query(new SchemaPipe(conversationQuerySchema))
    query: ReturnType<typeof conversationQuerySchema.parse>,
  ) {
    /** 固定的归属条件不能被可选查询字段覆盖。 */
    const owner = and(
      eq(conversations.userId, request.actor.userId),
      eq(conversations.archived, query.archived === "true"),
    );
    /** 缺省不限制游标；如提供则查找当前用户自己的起点。 */
    let position;
    /** 外部用户的游标与不存在的游标返回相同404。 */
    if (query.cursor) {
      const [cursor] = await this.storage.db
        .select()
        .from(conversations)
        .where(and(owner, eq(conversations.id, query.cursor)))
        .limit(1);
      if (!cursor) throw new NotFoundException("会话不存在");
      position = or(
        lt(conversations.createdAt, cursor.createdAt),
        and(
          eq(conversations.createdAt, cursor.createdAt),
          lt(conversations.id, cursor.id),
        ),
      );
    }
    /** 多取一条判断是否有下一页，不暴露其他用户的会话总数。 */
    const rows = await this.storage.db
      .select()
      .from(conversations)
      .where(and(owner, position))
      .orderBy(desc(conversations.createdAt), desc(conversations.id))
      .limit(query.limit + 1);
    /** 返回显式游标，改名不会改变当前排序键。 */
    const items = rows.slice(0, query.limit);
    return {
      items: items.map(publicConversation),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
    /** 结束会话列表。 */
  }
  /** 新建会话的所有者只能来自登录上下文。 */
  @Post()
  /** 创建与审计保持事务一致。 */
  async create(
    @Req() request: AuthRequest,
    @Body(new SchemaPipe(conversationCreateSchema))
    input: ReturnType<typeof conversationCreateSchema.parse>,
  ) {
    return this.storage.db.transaction(async (tx) => {
      const [item] = await tx
        .insert(conversations)
        .values({ userId: request.actor.userId, title: input.title })
        .returning();
      if (!item) throw new Error("会话创建失败");
      await tx
        .insert(auditEvents)
        .values({
          userId: request.actor.userId,
          action: "conversation.created",
          targetId: item.id,
        });
      return publicConversation(item);
    });
  }
  /** 查询单会话不会因为知道UUID而绕过归属。 */
  @Get(":id")
  /** 参数UUID必须在进入SQL之前通过验证。 */
  async get(
    @Req() request: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    const [item] = await this.storage.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, id),
          eq(conversations.userId, request.actor.userId),
        ),
      )
      .limit(1);
    if (!item) throw new NotFoundException("会话不存在");
    return publicConversation(item);
  }
  /** 更新只支持标题与可恢复归档。 */
  @Patch(":id")
  /** 原子更新条件同时包含资源和用户，拒绝先查询后无归属更新的漏洞。 */
  async update(
    @Req() request: AuthRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(conversationUpdateSchema))
    input: ReturnType<typeof conversationUpdateSchema.parse>,
  ) {
    return this.storage.db.transaction(async (tx) => {
      const [item] = await tx
        .update(conversations)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(conversations.id, id),
            eq(conversations.userId, request.actor.userId),
          ),
        )
        .returning();
      if (!item) throw new NotFoundException("会话不存在");
      await tx
        .insert(auditEvents)
        .values({
          userId: request.actor.userId,
          action:
            input.archived === true
              ? "conversation.archived"
              : "conversation.updated",
          targetId: id,
        });
      return publicConversation(item);
    });
  }
  /** 结束会话控制器。 */
}
/** 会话模块明确导入身份模块复用认证依赖。 */
@Module({ imports: [IdentityModule], controllers: [ConversationsController] })
/** 后续消息模块可以在此基础上扩展，而不是改写身份实现。 */
export class ConversationsModule {}
