/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 真实路线与车辆成本查询接口。 */
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
/** 接口文档明确路线查询与车辆费用输入。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 浏览器断开时取消实际路线调用。 */
import type { Response } from 'express';
/** 油电单价、消耗和费用未知值受严格契约控制。 */
import { drivingInputSchema, revisionSchema } from '@journey/contracts';
/** 复用统一边界。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 身份只取自服务端守卫。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 控制器不参与费用心算。 */
import { DrivingService } from './driving.service.js';
/** 实际操作有共享限流与指标。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** HTTP取消信号。 */
import { withHttpSignal } from '../travel/http-operation.js';
/** 单次计算必须绑定当前修订号。 */
const schema = revisionSchema.extend({ input: drivingInputSchema }).strict();
/** 自驾与车辆费用。 */
@ApiTags('自驾规划 自驾与车辆费用')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/driving')
export class DrivingController {
  /** 持久化由领域服务完成。 */
  constructor(
    private readonly service: DrivingService,
    private readonly operations: TravelOperations,
  ) {}
  /** 单价来源是明确入参，绝不伪装实时油价。 */
  @Post()
  query(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(schema)) body: ReturnType<typeof schema.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 9, 'driving', signal, (combined) =>
        this.service.query(req.actor.userId, id, body.revision, body.input, combined),
      ),
    );
  }
}
