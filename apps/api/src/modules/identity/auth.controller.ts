/** 认证控制器只处理HTTP、Cookie与服务调用，不实现密码派生。 */
import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
/** 在开发OpenAPI中说明Cookie和访问令牌的用途。 */
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
/** 只导入Express的网络类型。 */
import type { Request, Response } from 'express';
/** 与前端共用严格登录和注册规则。 */
import { loginSchema, registerSchema } from '@journey/contracts';
/** 读取生产Cookie设置和固定会话期限。 */
import { AppConfig } from '../../config/config.module.js';
/** 请求在进入服务之前先通过共享schema。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 业务认证逻辑由独立服务执行。 */
import { AuthService } from './auth.service.js';
/** 认证变更使用CSRF边界，用户资源使用访问守卫。 */
import { AccessGuard, AuthBoundaryGuard, type AuthRequest } from './auth.guards.js';
/** Cookie名字固定，不允许客户端传任意键名。 */
const refreshCookie = 'journey_refresh';
/** 读取刷新Cookie时忽略损坏编码，不把全部Cookie写到日志。 */
function readRefresh(request: Request): string | undefined {
  const entry = request.headers.cookie
    ?.split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${refreshCookie}=`));
  if (!entry) return undefined;
  try {
    return decodeURIComponent(entry.slice(refreshCookie.length + 1));
  } catch {
    return undefined;
  }
}
/** 认证接口由精确来源、自定义头和Redis限流保护。 */
@ApiTags('用户认证')
/** Swagger调用同样需要显式CSRF客户端头，不设置绕过认证的特殊通道。 */
@ApiHeader({
  name: 'x-journey-client',
  required: true,
  schema: { type: 'string', enum: ['web'] },
})
/** 所有路由继承全局API版本前缀。 */
@Controller('auth')
/** 认证接口修改Cookie，统一套用请求来源和限流守卫。 */
@UseGuards(AuthBoundaryGuard)
/** 控制器不会在JSON中返回refreshToken。 */
export class AuthController {
  /** 认证和配置由Nest注入。 */
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}
  /** 固定Cookie属性；开发HTTP不用Secure，生产必须Secure。 */
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
    };
  }
  /** 注册仅接受邮箱、密码与显示名。 */
  @Post('register')
  /** OpenAPI只描述输入格式，不提供真实密码或令牌示例。 */
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'password', 'displayName'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: {
          type: 'string',
          minLength: 15,
          maxLength: 128,
          writeOnly: true,
        },
        displayName: { type: 'string', minLength: 1, maxLength: 50 },
      },
    },
  })
  /** 文档明确刷新令牌在HttpOnly Cookie中。 */
  @ApiOperation({ summary: '注册并登录；刷新令牌仅通过HttpOnly Cookie发送' })
  /** 派生的输入类型由schema pipe确保，不允许自报userId。 */
  async register(
    @Body(new SchemaPipe(registerSchema))
    input: ReturnType<typeof registerSchema.parse>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.register(input);
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(refreshCookie, result.refreshToken, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });
    return result.response;
  }
  /** 登录为当前客户端创建独立可撤销会话。 */
  @Post('login')
  /** 登录文档与实际严格schema保持同样的字段边界。 */
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string', maxLength: 128, writeOnly: true },
      },
    },
  })
  /** 不通过URL或localStorage传递任何凭据。 */
  @ApiOperation({ summary: '邮箱密码登录，返回短期访问令牌和公开用户' })
  /** Cookie使用原有期限，短期JWT只在响应正文出现。 */
  async login(
    @Body(new SchemaPipe(loginSchema))
    input: ReturnType<typeof loginSchema.parse>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input);
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(refreshCookie, result.refreshToken, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });
    return result.response;
  }
  /** 每次刷新都会消费旧令牌，重放会撤销整个会话族。 */
  @Post('refresh')
  /** 浏览器需发送x-journey-client:web请求头以通过CSRF边界。 */
  @ApiOperation({ summary: '轮换刷新Cookie并获取新访问令牌；检测旧令牌重放' })
  /** 刷新失败清理无效Cookie，事务内的撤销已经提交。 */
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.auth.refresh(readRefresh(request));
      response.cookie(refreshCookie, result.refreshToken, {
        ...this.cookieOptions(),
        expires: result.expiresAt,
      });
      return result.response;
    } catch (error) {
      response.clearCookie(refreshCookie, this.cookieOptions());
      throw error;
    }
  }
  /** 当前客户端幂等登出，并清理刷新Cookie。 */
  @Post('logout')
  /** 访问JWT也会立即因会话撤销而失效。 */
  @ApiOperation({ summary: '撤销当前登录会话并清理Cookie' })
  /** 先完成服务端撤销，再报告成功。 */
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(readRefresh(request));
    response.clearCookie(refreshCookie, this.cookieOptions());
    return { success: true };
  }
  /** 全部设备退出需要当前有效访问身份。 */
  @Post('logout-all')
  /** 受保护接口在OpenAPI中声明Bearer认证。 */
  @ApiBearerAuth()
  /** 不允许请求体指定被退出的用户。 */
  @UseGuards(AccessGuard)
  /** 全量撤销会立即拒绝该用户所有旧访问令牌。 */
  async logoutAll(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logoutAll(request.actor);
    response.clearCookie(refreshCookie, this.cookieOptions());
    return { success: true };
  }
  /** 结束认证控制器。 */
}
