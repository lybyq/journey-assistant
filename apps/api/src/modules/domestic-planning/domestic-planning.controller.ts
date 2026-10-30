/** 国内方案接口共享归属、严格校验、限流与请求取消边界。 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { revisionSchema, domesticHandoffInputSchema } from '@journey/contracts';
import { SchemaPipe } from '../../common/schema.pipe.js';
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
import { withHttpSignal } from '../travel/http-operation.js';
import { TravelOperations } from '../travel-delivery/operations.service.js';
import { DomesticPlanningService } from './domestic-planning.service.js';

/** 渠道状态和会话方案恢复不接受客户端提供的用户身份。 */
@ApiTags('国内旅行决策')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('travel/domestic')
export class DomesticCatalogController {
  constructor(private readonly service: DomesticPlanningService) {}
  /** 只展示能力和开通状态，不泄露密钥。 */
  @Get('providers')
  providers() {
    return this.service.providers();
  }
  /** 会话切换后恢复同一账户保存的旅行项目和方案。 */
  @Get('conversations/:id')
  conversation(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.forConversation(req.actor.userId, id);
  }
}

/** 生成、选择和平台交接分别表达不同用户意图。 */
@ApiTags('国内旅行决策')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/domestic')
export class DomesticPlanningController {
  constructor(
    private readonly service: DomesticPlanningService,
    private readonly operations: TravelOperations,
  ) {}
  /** 读取不会重做查询或增加版本。 */
  @Get('options')
  get(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.decision(req.actor.userId, id);
  }
  /** 仅组合已有资料，取消信号传递到实际地图请求。 */
  @Post('options')
  generate(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(revisionSchema.strict())) body: ReturnType<typeof revisionSchema.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 8, 'domestic-options', signal, (combined) =>
        this.service.generate(req.actor.userId, id, body.revision, combined),
      ),
    );
  }
  /** 比较后由用户选择；旧需求、过期集合和跨项目ID均拒绝。 */
  @Post('options/:versionId/select')
  select(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body(new SchemaPipe(revisionSchema.strict())) body: ReturnType<typeof revisionSchema.parse>,
  ) {
    return this.service.select(req.actor.userId, id, body.revision, versionId);
  }
  /** 仅返回登记的平台入口，用户在平台核价并付款。 */
  @Post('handoff')
  handoff(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(domesticHandoffInputSchema))
    body: ReturnType<typeof domesticHandoffInputSchema.parse>,
  ) {
    return this.service.handoff(req.actor.userId, id, body.providerId);
  }
}
