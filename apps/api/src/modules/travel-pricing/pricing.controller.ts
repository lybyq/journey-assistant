/** 所有鉴权旅行API统一按用户限流。 */
import { TravelRateGuard } from '../travel/travel-rate.guard.js';
/** 报价编辑与确定性预算接口，不开放任意表达式求值。 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
/** 业务职责对应独立学习文档。 */
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
/** 所有金额都是最小单位整数。 */
import { setCostsSchema, costItemSchema, revisionSchema } from '@journey/contracts';
/** 统一输入与身份。 */
import { SchemaPipe } from '../../common/schema.pipe.js';
/** 不接受客户端自报userId。 */
import { AccessGuard, type AuthRequest } from '../identity/auth.guards.js';
/** 服务检查来源身份和条件。 */
import { QuoteService } from './quote.service.js';
/** 单条新增与批量选择都携带revision。 */
const addSchema = revisionSchema.extend({ input: costItemSchema }).strict();
/** 预算与价格对比的费用入口。 */
@ApiTags('预算计算 确定性预算')
@ApiBearerAuth()
@UseGuards(AccessGuard, TravelRateGuard)
@Controller('trips/:id/pricing')
export class PricingController {
  /** 控制器不做心算，也不让网页提交计算结论。 */
  constructor(private readonly service: QuoteService) {}
  /** 金额和汇率选择保存后才返回新修订号。 */
  @Put()
  set(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(setCostsSchema))
    body: ReturnType<typeof setCostsSchema.parse>,
  ) {
    return this.service.set(req.actor.userId, id, body);
  }
  /** 纯读取计算不会修改旧报价。 */
  @Get()
  calculate(@Req() req: AuthRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.calculate(req.actor.userId, id);
  }
  /** 新人工费用不能宣称实时报价。 */
  @Post('items')
  add(
    @Req() req: AuthRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new SchemaPipe(addSchema)) body: ReturnType<typeof addSchema.parse>,
  ) {
    return this.service.add(req.actor.userId, id, body.revision, body.input);
  }
}
