/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 行程草案、生成、验证、局部替换与版本回退。 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
/** 接口按生成、保存、替换、比较和回退职责分组。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 所有写入仍通过共享严格schema。 */
import {
  revisionSchema,
  generatePlanSchema,
  planDraftSchema,
  replaceScheduleSchema,
  comparePlansSchema,
} from '@journey/contracts';
/** 运行时校验。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 数据归属。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 版本写入只能由服务端计算验证状态。 */
import { PlanService } from './plan.service.js';
/** 不可变版本读取由归属仓储负责。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 客户端不能提交budget或status字段。 */
const save = revisionSchema.extend({ draft: planDraftSchema }).strict();
/** 自动初排使用已保存候选。 */
const generate = revisionSchema.extend({ input: generatePlanSchema }).strict();
/** 只替换明确活动，不覆盖其他日期。 */
const replace = revisionSchema.extend({ input: replaceScheduleSchema }).strict();
/** 可验证行程版本。 */
@ApiTags('行程版本 行程生成与调整')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/plans')
export class PlanController {
  /** 仓储与业务各司其职。 */
  constructor(
    private readonly service: PlanService,
    private readonly repository: TravelRepository,
  ) {}
  /** 生成也要走同一验证器，不给自动结果开后门。 */
  @Post('generate')
  generate(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(generate)) body: ReturnType<typeof generate.parse>,
  ) {
    return this.service.generate(req.actor.userId, id, body.revision, body.input);
  }
  /** 保存一份新的不可变版本。 */
  @Post()
  save(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(save)) body: ReturnType<typeof save.parse>,
  ) {
    return this.service.save(req.actor.userId, id, body.revision, body.draft);
  }
  /** 指定版本读取不会泄露其他项目。 */
  @Get(':versionId')
  get(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
  ) {
    return this.repository.version(req.actor.userId, id, versionId);
  }
  /** 局部修改仍重新计算费用与全部约束。 */
  @Post('replace')
  replace(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(replace)) body: ReturnType<typeof replace.parse>,
  ) {
    return this.service.replace(req.actor.userId, id, body.revision, body.input);
  }
  /** 不能拿不同日期与人数方案做最低价排名。 */
  @Post('compare')
  compare(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(comparePlansSchema))
    body: ReturnType<typeof comparePlansSchema.parse>,
  ) {
    return this.service.compare(req.actor.userId, id, body.versionIds);
  }
  /** 旧版本保留；回退只改变当前指针。 */
  @Post(':versionId/activate')
  activate(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body(new SchemaPipe(revisionSchema.strict()))
    body: ReturnType<typeof revisionSchema.parse>,
  ) {
    return this.repository.activate(req.actor.userId, id, body.revision, versionId);
  }
}
