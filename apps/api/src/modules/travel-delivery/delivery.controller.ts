/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 导出、分享、撤销和当前用户指标。 */
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
/** API文档显示访问要求。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 秘密令牌不进入公开URL参数。 */
import { createHash } from 'node:crypto';
/** 下载通过原生响应写二进制，不做base64膨胀。 */
import type { Request, Response } from 'express';
/** 分享契约与公开版本约束。 */
import { shareCreateSchema } from '@journey/contracts';
/** 匿名分享输入也必须严格校验。 */
import { z } from 'zod';
/** Schema与身份守卫复用。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 私人导出与监控必须鉴权。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 分享业务与供应商状态分别提供。 */
import { DeliveryService } from './delivery.service.js';
/** 运维只看自己的运行摘要。 */
import { TravelOperations } from './operations.service.js';
/** 供应商只公开配置状态。 */
import { SupplierService } from '../travel-suppliers/supplier.service.js';
/** Redis限流不保存IP原文。 */
import { StorageService } from '../../storage/storage.module.js';
/** 项目命名空间独立。 */
import { AppConfig } from '../../config/config.module.js';
/** 匿名访问只允许固定长度的随机令牌。 */
const resolveSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
/** 匿名分享防枚举限流，Redis失败时不绕过。 */
@Injectable()
export class PublicShareRateGuard implements CanActivate {
  /** 限流只依赖原有存储与配置。 */
  constructor(
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}
  /** 令牌不放进Redis键，IP仅保存SHA-256指纹。 */
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = createHash('sha256')
      .update(req.ip ?? 'unknown')
      .digest('hex');
    const n = Number(
      await this.storage.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
        {
          keys: [`${this.config.env.REDIS_PREFIX}:share:${ip}`],
          arguments: [],
        },
      ),
    );
    if (n > 120) throw new HttpException('分享访问过于频繁', 429);
    return true;
  }
}
/** 私人交付操作。 */
@ApiTags('分享与运维 分享导出与运维')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/delivery')
export class DeliveryController {
  /** 导出服务不接受模型或HTTP传入任意字体路径。 */
  constructor(private readonly service: DeliveryService) {}
  /** 创建固定版本的限时分享，秘密仅返回一次。 */
  @Post('shares')
  share(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(shareCreateSchema))
    body: ReturnType<typeof shareCreateSchema.parse>,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.service.share(req.actor.userId, id, body.versionId, body.expiresInHours);
  }
  /** 分享列表不返回秘密原文。 */
  @Get('shares')
  list(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.shares(req.actor.userId, id);
  }
  /** 撤销操作幂等且检查所属项目。 */
  @Post('shares/:shareId/revoke')
  revoke(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('shareId', new ParseUUIDPipe()) shareId: string,
  ) {
    return this.service.revoke(req.actor.userId, id, shareId);
  }
  /** Markdown导出与网页使用同一版本。 */
  @Get(':versionId/markdown')
  async markdown(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ) {
    const text = await this.service.markdown(req.actor.userId, id, versionId);
    res
      .set({
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="journey-plan.md"',
        'Cache-Control': 'no-store',
      })
      .send(text);
  }
  /** PDF嵌入中文字体，失败时明确报错，不下载乱码或HTML假PDF。 */
  @Get(':versionId/pdf')
  async pdf(
    @Req() req: AuthRequest,
    @Res() res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ) {
    const bytes = await this.service.pdf(req.actor.userId, id, versionId);
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="journey-plan.pdf"',
        'Cache-Control': 'no-store',
      })
      .send(bytes);
  }
}
/** 匿名接口只返回固定分享版本，不返回项目账户或原始checkpoint。 */
@ApiTags('分享与运维 限时分享访问')
@UseGuards(PublicShareRateGuard)
@Controller('shared')
export class PublicShareController {
  /** 匿名读取仍检查有效期、撤销、项目归档和用户禁用。 */
  constructor(private readonly service: DeliveryService) {}
  /** URL令牌由网页fragment读取后通过POST正文发送。 */
  @Post('resolve')
  resolve(
    @Res({ passthrough: true }) res: Response,
    @Body(new SchemaPipe(resolveSchema))
    body: ReturnType<typeof resolveSchema.parse>,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return this.service.resolve(body.token);
  }
}
/** 运维摘要只包含当前用户运行数据，供应商配置不含秘密。 */
@ApiTags('分享与运维 运行与能力')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('travel')
export class TravelStatusController {
  /** 状态读取不会发起供应商调用。 */
  constructor(
    private readonly operations: TravelOperations,
    private readonly suppliers: SupplierService,
  ) {}
  /** 模块依赖未配置时前端可以禁用对应查询并说明原因。 */
  @Get('capabilities')
  capabilities() {
    return {
      modules: [6, 7, 8, 9, 10, 11, 12, 13, 14],
      suppliers: this.suppliers.status(),
    };
  }
  /** 模型tokens与真实账单分开说明。 */
  @Get('metrics')
  metrics(@Req() req: AuthRequest) {
    return this.operations.metrics(req.actor.userId);
  }
}
