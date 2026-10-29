/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 铁路与航班明确使用不同供应商与查询条件。 */
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
/** 每个接口在Swagger里按业务职责查找。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** HTTP关闭会取消供应商实际请求。 */
import type { Response } from 'express';
/** 固定查询契约不接受任意工具名或服务地址。 */
import { revisionSchema, railQuerySchema, flightQuerySchema } from '@journey/contracts';
/** 校验、身份、取消和限流共用现有基础设施。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 真实账户上下文。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 信号贯穿领域操作。 */
import { withHttpSignal } from '../travel/http-operation.js';
/** 并发和耗时记录。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** 独立交通服务。 */
import { TransportService } from './transport.service.js';
/** 铁路查询和当前修订号绑定。 */
const railSchema = revisionSchema.extend({ input: railQuerySchema }).strict();
/** 航班IATA代码不能由中文地名自动猜测。 */
const flightSchema = revisionSchema.extend({ input: flightQuerySchema }).strict();
/** 城际交通与接驳。 */
@ApiTags('交通查询 城际交通与接驳')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/transport')
export class TransportController {
  /** 分离HTTP、调度和领域逻辑。 */
  constructor(
    private readonly service: TransportService,
    private readonly operations: TravelOperations,
  ) {}
  /** 查站点编码后查询真实车次，不执行购票。 */
  @Post('rail')
  rail(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(railSchema)) body: ReturnType<typeof railSchema.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 8, 'rail', signal, (combined) =>
        this.service.rail(req.actor.userId, id, body.revision, body.input, combined),
      ),
    );
  }
  /** 授权接口未配置时明确503。 */
  @Post('flights')
  flights(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(flightSchema))
    body: ReturnType<typeof flightSchema.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 8, 'flights', signal, (combined) =>
        this.service.flights(req.actor.userId, id, body.revision, body.input, combined),
      ),
    );
  }
}
