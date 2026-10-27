/** 用户自身资源只允许经过访问守卫的请求。 */
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
/** 用户接口文档明确使用短期Bearer访问身份。 */
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
/** ORM条件始终使用可信actor，不读取请求体userId。 */
import { eq } from "drizzle-orm";
/** 共享资料和显示名校验规则。 */
import {
  profileSchema,
  profileUpdateSchema,
  userUpdateSchema,
} from "@journey/contracts";
/** 使用统一请求校验管道。 */
import { SchemaPipe } from "../../common/schema.pipe.js";
/** 使用真实存储服务。 */
import { StorageService } from "../../storage/storage.module.js";
/** 用户和资料表与审计保持独立。 */
import { users, travelerProfiles, auditEvents } from "../../storage/schema.js";
/** 访问守卫写入服务端认证上下文。 */
import { AccessGuard, type AuthRequest } from "./auth.guards.js";
/** 使用公开用户白名单序列化函数。 */
import { publicUser } from "./auth.service.js";
/** 自身资源不暴露任意/user/:id查询入口。 */
@ApiTags("账户与旅行者资料")
/** 文档声明所需访问凭据。 */
@ApiBearerAuth()
/** 所有路由从可信会话确定用户。 */
@UseGuards(AccessGuard)
/** 路由统一放在/me下，简化数据归属语义。 */
@Controller("me")
/** 公开资料操作不会读出凭据表。 */
export class MeController {
  /** 注入全局存储单例。 */
  constructor(private readonly storage: StorageService) {}
  /** 返回经过JWT和数据库共同验证的当前用户。 */
  @Get()
  /** 请求方无法替换actor中的userId。 */
  getMe(@Req() request: AuthRequest) {
    return request.actor.user;
  }
  /** 修改显示名不影响密码或登录邮箱。 */
  @Patch()
  /** 更新和审计在同一事务中提交。 */
  async updateMe(
    @Req() request: AuthRequest,
    @Body(new SchemaPipe(userUpdateSchema))
    input: ReturnType<typeof userUpdateSchema.parse>,
  ) {
    return this.storage.db.transaction(async (tx) => {
      const [user] = await tx
        .update(users)
        .set(input)
        .where(eq(users.id, request.actor.userId))
        .returning();
      if (!user) throw new NotFoundException("用户不存在");
      await tx
        .insert(auditEvents)
        .values({
          userId: request.actor.userId,
          action: "user.updated",
          targetId: request.actor.userId,
        });
      return publicUser(user);
    });
  }
  /** 获取当前用户的基础旅行资料。 */
  @Get("profile")
  /** 资料在注册时创建，响应只包含白名单偏好字段。 */
  async getProfile(@Req() request: AuthRequest) {
    const [profile] = await this.storage.db
      .select()
      .from(travelerProfiles)
      .where(eq(travelerProfiles.userId, request.actor.userId))
      .limit(1);
    if (!profile) throw new NotFoundException("资料不存在");
    return profileSchema.parse({
      homeCity: profile.homeCity,
      preferredMode: profile.preferredMode,
      pace: profile.pace,
    });
  }
  /** 客户端只能修改当前用户自己的旅行偏好。 */
  @Patch("profile")
  /** schema.strict拒绝通过userId修改别人的资料。 */
  async updateProfile(
    @Req() request: AuthRequest,
    @Body(new SchemaPipe(profileUpdateSchema))
    input: ReturnType<typeof profileUpdateSchema.parse>,
  ) {
    return this.storage.db.transaction(async (tx) => {
      const [profile] = await tx
        .update(travelerProfiles)
        .set(input)
        .where(eq(travelerProfiles.userId, request.actor.userId))
        .returning();
      if (!profile) throw new NotFoundException("资料不存在");
      await tx
        .insert(auditEvents)
        .values({
          userId: request.actor.userId,
          action: "profile.updated",
          targetId: request.actor.userId,
        });
      return profileSchema.parse({
        homeCity: profile.homeCity,
        preferredMode: profile.preferredMode,
        pace: profile.pace,
      });
    });
  }
  /** 结束账户控制器。 */
}
