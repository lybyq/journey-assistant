/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 旅行团和产品条款接口。 */
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
/** 公开接口按旅行团查询和条款录入分组。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** HTTP关闭触发取消。 */
import type { Response } from 'express';
/** 团产品不能遗漏单房差、自费与购物字段。 */
import { revisionSchema, tourProductSchema } from '@journey/contracts';
/** 统一输入校验。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 账户归属。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 单独领域服务。 */
import { TourService } from './tour.service.js';
/** 真正请求限流与取消。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** 信号桥接。 */
import { withHttpSignal } from '../travel/http-operation.js';
/** 人工产品来源受服务端限制。 */
const manual = revisionSchema.extend({ input: tourProductSchema }).strict();
/** 旅行团产品。 */
@ApiTags('旅行团 旅行团与产品条款')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/tours')
export class TourController {
  /** 对外不暴露供应商认证对象。 */
  constructor(
    private readonly service: TourService,
    private readonly operations: TravelOperations,
  ) {}
  /** 网关地址只从部署配置读取。 */
  @Post('search')
  query(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(revisionSchema.strict()))
    body: ReturnType<typeof revisionSchema.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 11, 'tours', signal, (combined) =>
        this.service.query(req.actor.userId, id, body.revision, combined),
      ),
    );
  }
  /** 人工资料必须标明价格性质。 */
  @Post('manual')
  manual(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(manual)) body: ReturnType<typeof manual.parse>,
  ) {
    return this.service.manual(req.actor.userId, id, body.revision, body.input);
  }
}
