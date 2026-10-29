/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 项目与需求接口独立标注，身份永远来自AccessGuard。 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
/** 公开文档按业务职责分组，便于学习接口与源码的对应关系。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 输入只接受声明字段，不接受userId或systemPrompt。 */
import { createTripSchema, updateTripSchema, parseTripRequestSchema } from '@journey/contracts';
/** 共享SchemaPipe把校验错误映射为400。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 每个接口逐次验证会话撤销状态。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 需求解析、应用服务和仓储分别承担单一职责。 */
import { TripRequestService } from './request.service.js';
/** 项目创建与修改不在控制器拼业务JSON。 */
import { TravelService } from '../travel/travel.service.js';
/** 列表和读取统一按userId过滤。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 旅行需求与项目管理。 */
@ApiTags('旅行需求 旅行画像与澄清')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips')
export class TripRequestController {
  /** 控制器仅处理HTTP，不计算日期和金额。 */
  constructor(
    private readonly service: TravelService,
    private readonly repository: TravelRepository,
    private readonly requests: TripRequestService,
  ) {}
  /** 返回当前用户最近50个项目，包含可恢复归档状态。 */
  @Get()
  list(@Req() req: AuthRequest) {
    return this.repository.list(req.actor.userId);
  }
  /** 文字提取只是候选预览，不创建项目、不调用外部模型。 */
  @Post('parse')
  parse(
    @Body(new SchemaPipe(parseTripRequestSchema))
    input: ReturnType<typeof parseTripRequestSchema.parse>,
  ) {
    const patch = this.requests.extract(input.text);
    const request = this.requests.normalize(patch);
    return {
      patch,
      request,
      clarifications: this.requests.clarifications(request),
    };
  }
  /** 创建时允许绑定本账户的聊天会话。 */
  @Post()
  create(
    @Req() req: AuthRequest,
    @Body(new SchemaPipe(createTripSchema))
    input: ReturnType<typeof createTripSchema.parse>,
  ) {
    return this.service.create(req.actor.userId, input);
  }
  /** 不存在与越权统一404。 */
  @Get(':id')
  get(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.repository.get(req.actor.userId, id);
  }
  /** 乐观锁防止两个标签页相互覆盖。 */
  @Patch(':id')
  update(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(updateTripSchema))
    input: ReturnType<typeof updateTripSchema.parse>,
  ) {
    return this.service.update(req.actor.userId, id, input);
  }
}
