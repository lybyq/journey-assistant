/** 使用标准守卫把认证与控制器领域逻辑分离。 */
import {
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
/** IP仅用于哈希限流键，不记录原文到审计日志。 */
import { createHash } from "node:crypto";
/** 扩展请求类型保存服务端验证过的认证上下文。 */
import type { Request } from "express";
/** 使用精确来源白名单和本项目Redis命名空间。 */
import { AppConfig } from "../../config/config.module.js";
/** 通过真实Redis执行原子限流。 */
import { StorageService } from "../../storage/storage.module.js";
/** 认证服务执行签名和数据库会话检查。 */
import { AuthService, type Actor } from "./auth.service.js";
/** 定义通过认证后的请求形状，业务层不读取客户端自报用户字段。 */
export type AuthRequest = Request & { actor: Actor };
/** JWT访问守卫不从Cookie或query读取访问令牌，避免CSRF及URL泄漏。 */
@Injectable()
/** 控制器只有显式通过此守卫才能得到可信actor。 */
export class AccessGuard implements CanActivate {
  /** 注入独立认证服务。 */
  constructor(private readonly auth: AuthService) {}
  /** 对每个受保护请求重新验证会话撤销状态。 */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const match = /^Bearer ([A-Za-z0-9._-]{1,4096})$/.exec(
      request.headers.authorization ?? "",
    );
    if (!match?.[1]) throw new UnauthorizedException("请先登录");
    request.actor = await this.auth.authenticate(match[1]);
    return true;
  }
  /** 结束访问守卫。 */
}
/** 自定义头和精确Origin校验保护所有会修改Cookie的认证接口。 */
@Injectable()
/** 跨站表单不能发送自定义头，跨站脚本会受到CORS预检约束。 */
export class AuthBoundaryGuard implements CanActivate {
  /** 同一配置用于HTTP跨域与Cookie请求来源判断。 */
  constructor(
    private readonly config: AppConfig,
    private readonly storage: StorageService,
  ) {}
  /** 在密码派生之前进行原子限流，减少资源滥用。 */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    /** 浏览器与非浏览器客户端都必须显式声明API调用意图。 */
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers["x-journey-client"] !== "web")
      throw new ForbiddenException("缺少受信任的客户端请求头");
    /** Cookie请求不信任任意浏览器来源。 */
    if (
      request.headers.origin &&
      !this.config.origins.includes(request.headers.origin)
    )
      throw new ForbiddenException("请求来源不允许");
    /** 同时使用IP与端点隔离计数，不把IP写入Redis键原文。 */
    const fingerprint = createHash("sha256")
      .update(request.ip ?? request.socket.remoteAddress ?? "unknown")
      .digest("hex");
    const route = request.path.split("/").at(-1) ?? "auth";
    const max = route === "register" ? 10 : route === "login" ? 30 : 90;
    /** Lua脚本把自增和首次过期设置原子化，避免计数器永不过期。 */
    const script =
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n";
    /** Redis不可用时身份请求失败关闭，不绕过限流继续昂贵派生。 */
    const count = await this.storage.redis.eval(script, {
      keys: [`${this.config.env.REDIS_PREFIX}:auth:${route}:${fingerprint}`],
      arguments: ["600"],
    });
    /** 达到配额后返回明确429，不区分邮箱是否存在。 */
    if (Number(count) > max)
      throw new HttpException("操作过于频繁，请稍后重试", 429);
    return true;
    /** 结束认证边界检查。 */
  }
  /** 结束认证边界守卫。 */
}
