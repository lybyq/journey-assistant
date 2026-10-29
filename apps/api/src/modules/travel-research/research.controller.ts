/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 证据查询与人工来源录入拥有独立API分组。 */
import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
/** 文档显示实际业务职责。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** Response用于监听浏览器中止，不由控制器手写JSON流。 */
import type { Response } from 'express';
/** 原始来源和检索条件都受严格schema约束。 */
import { revisionSchema, researchQuerySchema, manualEvidenceSchema } from '@journey/contracts';
/** 请求体在外部调用之前完成校验。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 账户归属不能由请求体提供。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 业务检索与通用限流/取消分别实现。 */
import { ResearchService } from './research.service.js';
/** 领域操作会持久化安全指标。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** 取消信号传到实际MCP调用。 */
import { withHttpSignal } from '../travel/http-operation.js';
/** 必须携带当前项目版本。 */
const searchSchema = revisionSchema.extend({ input: researchQuerySchema }).strict();
/** 人工资料没有官方身份字段。 */
const manualSchema = revisionSchema.extend({ input: manualEvidenceSchema }).strict();
/** 搜索与证据。 */
@ApiTags('资料检索 旅游资料与证据')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/research')
export class ResearchController {
  /** 控制器只组合HTTP信号与业务执行。 */
  constructor(
    private readonly service: ResearchService,
    private readonly operations: TravelOperations,
  ) {}
  /** Search→Extract在同一个有界操作内完成。 */
  @Post()
  search(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(searchSchema))
    body: ReturnType<typeof searchSchema.parse>,
  ) {
    return withHttpSignal(req, res, (signal) =>
      this.operations.run(req.actor.userId, id, 7, 'research', signal, (combined) =>
        this.service.search(req.actor.userId, id, body.revision, body.input, combined),
      ),
    );
  }
  /** 手工证据仍执行当前项目来源归属和完整校验。 */
  @Post('manual')
  manual(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(manualSchema))
    body: ReturnType<typeof manualSchema.parse>,
  ) {
    return this.service.addManual(req.actor.userId, id, body.revision, body.input);
  }
}
