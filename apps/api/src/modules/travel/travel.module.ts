/** 用户级读写限流守卫。 */
import { TravelRateGuard } from './travel-rate.guard.js';
/** 组合根只注册明确领域组件，不把业务写进AgentService。 */
import { Module } from '@nestjs/common';
/** 原有身份和MCP模块继续复用。 */
import { IdentityModule } from '../identity/identity.module.js';
/** 外部连接由MCP工具中心统一维护。 */
import { McpModule } from '../mcp/mcp.module.js';
/** 项目聚合基础设施。 */
import { TravelRepository } from './travel.repository.js';
/** 项目应用服务。 */
import { TravelService } from './travel.service.js';
/** 受限MCP业务会话。 */
import { TravelMcpService } from './travel-mcp.service.js';
/** 模型工具绑定真实领域服务。 */
import { TravelAgentTools } from './travel-agent-tools.js';
/** 旅行需求。 */
import { TripRequestService } from '../trip-request/request.service.js';
/** 旅行需求接口。 */
import { TripRequestController } from '../trip-request/request.controller.js';
/** 资料检索。 */
import { ResearchService } from '../travel-research/research.service.js';
/** 资料检索接口。 */
import { ResearchController } from '../travel-research/research.controller.js';
/** 交通查询。 */
import { TransportService } from '../travel-transport/transport.service.js';
/** 交通查询接口。 */
import { TransportController } from '../travel-transport/transport.controller.js';
/** 自驾规划。 */
import { DrivingService } from '../travel-driving/driving.service.js';
/** 自驾规划接口。 */
import { DrivingController } from '../travel-driving/driving.controller.js';
/** 住宿游玩。 */
import { ExperienceService } from '../travel-experiences/experience.service.js';
/** 住宿游玩接口。 */
import { ExperienceController } from '../travel-experiences/experience.controller.js';
/** 旅行团。 */
import { TourService } from '../travel-tours/tour.service.js';
/** 旅行团接口。 */
import { TourController } from '../travel-tours/tour.controller.js';
/** 预算计算。 */
import { PricingService } from '../travel-pricing/pricing.service.js';
/** 预算计算安全编辑。 */
import { QuoteService } from '../travel-pricing/quote.service.js';
/** 预算计算接口。 */
import { PricingController } from '../travel-pricing/pricing.controller.js';
/** 行程版本。 */
import { PlanService } from '../travel-plans/plan.service.js';
/** 行程版本接口。 */
import { PlanController } from '../travel-plans/plan.controller.js';
/** 授权供应商客户端使用原生fetch，可在协议测试替换。 */
import { SupplierService, SUPPLIER_FETCH } from '../travel-suppliers/supplier.service.js';
/** 分享与运维查询操作控制。 */
import { TravelOperations } from '../travel-delivery/operations.service.js';
/** 分享与运维导出。 */
import { DeliveryService } from '../travel-delivery/delivery.service.js';
/** 分享与运维接口。 */
import {
  DeliveryController,
  PublicShareController,
  PublicShareRateGuard,
  TravelStatusController,
} from '../travel-delivery/delivery.controller.js';
/** 模块内部没有对AgentModule的运行时反向依赖。 */
@Module({
  imports: [IdentityModule, McpModule],
  providers: [
    TravelRateGuard,
    TravelRepository,
    TravelService,
    TravelMcpService,
    TravelAgentTools,
    TripRequestService,
    ResearchService,
    TransportService,
    DrivingService,
    ExperienceService,
    TourService,
    PricingService,
    QuoteService,
    PlanService,
    SupplierService,
    { provide: SUPPLIER_FETCH, useValue: globalThis.fetch },
    TravelOperations,
    DeliveryService,
    PublicShareRateGuard,
  ],
  controllers: [
    TripRequestController,
    ResearchController,
    TransportController,
    DrivingController,
    ExperienceController,
    TourController,
    PricingController,
    PlanController,
    DeliveryController,
    PublicShareController,
    TravelStatusController,
  ],
  exports: [TravelAgentTools, TravelRepository],
})
export class TravelModule {}
