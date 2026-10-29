/** 旅行项目应用服务，负责连接自然语言需求与领域聚合。 */
import { Injectable } from '@nestjs/common';
/** 创建、更新与完整文档都在同一契约中校验。 */
import {
  createTripSchema,
  updateTripSchema,
  tripDocumentSchema,
  type TripWorkspace,
} from '@journey/contracts';
/** 需求提取不写数据库，项目服务才负责保存。 */
import { TripRequestService } from '../trip-request/request.service.js';
/** 归属、乐观锁和事务由仓储集中实现。 */
import { TravelRepository } from './travel.repository.js';
/** 新的旅行项目和现有聊天会话可以显式关联。 */
@Injectable()
export class TravelService {
  /** 以单向依赖组合服务，避免控制器里散落业务逻辑。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly requests: TripRequestService,
  ) {}
  /** 表单明确填写的字段优先于文字候选，避免模型覆盖用户选择。 */
  async create(
    userId: string,
    input: ReturnType<typeof createTripSchema.parse>,
  ): Promise<TripWorkspace> {
    const request = this.requests.normalize({
      ...this.requests.extract(input.text),
      ...input.request,
    });
    const document = tripDocumentSchema.parse({
      request,
      evidence: [],
      transport: [],
      driving: [],
      experiences: [],
      tours: [],
      costs: [],
      rates: [],
      reserveBps: 1000,
    });
    return this.repository.create(userId, input.title, input.conversationId, document);
  }
  /** 修改需求会增加revision；已有方案保持原样并可重新比较或另存版本。 */
  async update(userId: string, id: string, input: ReturnType<typeof updateTripSchema.parse>) {
    return this.repository.mutate(
      userId,
      id,
      input.revision,
      (document) => {
        if (input.request)
          document.request = this.requests.normalize(input.request, document.request);
        return document;
      },
      { title: input.title, archived: input.archived },
    );
  }
}
