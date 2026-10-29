/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 地点搜索、酒店报价与人工条款录入明确分开。 */
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
/** 学习用API分组。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 取消信号绑定浏览器连接。 */
import type { Response } from 'express';
/** 只接受固定领域数据，不接收第三方endpoint。 */
import {
  revisionSchema,
  placeQuerySchema,
  hotelQuerySchema,
  experienceSchema,
} from '@journey/contracts';
/** 共用校验和身份边界。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 当前账户来自守卫。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 领域服务处理地点与房晚口径。 */
import { ExperienceService } from './experience.service.js';
/** 外部操作限流。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** 真实取消。 */
import { withHttpSignal } from '../travel/http-operation.js';
/** 三个入参独立校验。 */
const places = revisionSchema.extend({ input: placeQuerySchema }).strict();
/** 酒店城市代码由用户明确提供。 */
const hotels = revisionSchema.extend({ input: hotelQuerySchema }).strict();
/** 手工候选不能更改供应商身份。 */
const manual = revisionSchema.extend({ input: experienceSchema }).strict();
/** 住宿、景点和餐饮。 */
@ApiTags('住宿游玩 住宿门票与餐饮')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/experiences')
export class ExperienceController {
  /** HTTP不混入业务计算。 */
  constructor(
    private readonly service: ExperienceService,
    private readonly operations: TravelOperations,
  ) {}
  /** 地图结果不代表库存。 */
  @Post('search')
  places(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(places)) body: ReturnType<typeof places.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 10, 'places', signal, (combined) =>
        this.service.places(req.actor.userId, id, body.revision, body.input, combined),
      ),
    );
  }
  /** 酒店价格必须包含指定入住条件。 */
  @Post('hotels')
  hotels(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(hotels)) body: ReturnType<typeof hotels.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 10, 'hotels', signal, (combined) =>
        this.service.hotels(req.actor.userId, id, body.revision, body.input, combined),
      ),
    );
  }
  /** 营业预约和退改可由用户结合来源明确填写。 */
  @Post('manual')
  manual(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(manual)) body: ReturnType<typeof manual.parse>,
  ) {
    return this.service.manual(req.actor.userId, id, body.revision, body.input);
  }
}
