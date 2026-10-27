/** 引入 Nest 控制器、路由和依赖注入工具。 */
import { Controller, Get, Injectable, Module } from "@nestjs/common";
/** 引入 OpenAPI 元数据装饰器，公开接口用途。 */
import { ApiOperation, ApiTags } from "@nestjs/swagger";
/** 共享协议确保健康响应与网页工具结果结构一致。 */
import {
  healthSchema,
  moduleCatalog,
  type HealthSnapshot,
} from "@journey/contracts";
/** 注入经过校验的后端配置。 */
import { AppConfig } from "../../config/config.module.js";
/** 真实数据就绪检查与基础进程健康分开报告。 */
import { StorageService } from '../../storage/storage.module.js';
/** 健康服务同时供 HTTP 路由和真实诊断工具调用。 */
@Injectable()
/** 只报告当前已经验证的服务状态。 */
export class HealthService {
  /** 记录服务启动时刻，避免把操作系统运行时间当成 API 运行时间。 */
  private readonly startedAt = Date.now();
  /** 通过 Nest 注入单一配置源。 */
  constructor(private readonly config: AppConfig, private readonly storage: StorageService) {}
  /** 返回脱敏框架快照；配置存在不等于已经连接 MCP。 */
  snapshot(): HealthSnapshot {
    /** 运行时校验返回结构，及早发现协议变更。 */
    return healthSchema.parse({
      /** 明确就绪范围仅为底座，不能用于宣称业务服务可用。 */
      status: "ok",
      service: "journey-api",
      scope: "foundation",
      /** 这些字段均来自实际进程，便于验证工具返回值是真实数据。 */
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      runtime: process.version,
      /** 存储状态只包含枚举，不包含连接地址与凭据。 */
      storage: this.storage.status(),
      /** 仅返回准备状态，绝不返回服务 URL 或秘密值。 */
      integrations: [
        /** 模型需要 Key 和模型名；底座没有调用模型。 */
        {
          id: "llm",
          label: "语言模型",
          configured: Boolean(
            this.config.env.LLM_API_KEY && this.config.env.LLM_MODEL,
          ),
          connected: false,
        },
        /** 12306 将在 MCP 模块实现并验证连接。 */
        { id: "train", label: "12306", configured: false, connected: false },
        /** 高德 Key 已填写时也不宣称外部服务已经连通。 */
        {
          id: "amap",
          label: "高德地图",
          configured: Boolean(this.config.env.AMAP_MAPS_API_KEY),
          connected: false,
        },
        /** Tavily 的真实连接状态留给 MCP 生命周期模块维护。 */
        {
          id: "tavily",
          label: "Tavily",
          configured: Boolean(this.config.env.TAVILY_API_KEY),
          connected: false,
        },
        /** 结束公开集成列表。 */
      ],
      /** 结束并校验健康响应。 */
    });
    /** 结束快照方法。 */
  }
  /** 执行真实数据库和缓存探针，故障时返回503。 */
  readiness() { return this.storage.readiness(); }
  /** 结束健康服务。 */
}
/** 为健康与模块清单设置统一接口分组。 */
@ApiTags("系统底座")
/** 所有系统路由挂在全局 /api/v1 前缀下。 */
@Controller("system")
/** 系统控制器只暴露公开元数据。 */
export class HealthController {
  /** 注入可复用的健康查询服务。 */
  constructor(private readonly health: HealthService) {}
  /** 健康路由用于前端初次加载和运维探针。 */
  @Get("health")
  /** 将框架范围写进 Swagger，避免误解为完整业务就绪。 */
  @ApiOperation({ summary: "读取框架健康状态，不验证外部模型或 MCP" })
  /** 返回当前服务的真实脱敏快照。 */
  getHealth(): HealthSnapshot {
    return this.health.snapshot();
  }
  /** 第二模块的公开数据服务探针不暴露任何用户资料。 */
  @Get('storage')
  /** 与仅证明进程存活的health接口区分。 */
  @ApiOperation({ summary: '验证PostgreSQL和Redis真实可用性' })
  /** 数据库或缓存不可用时明确失败，不使用假健康状态。 */
  getStorage() { return this.health.readiness(); }
  /** 路线清单接口让前端明确呈现完成与待实现的功能。 */
  @Get("modules")
  /** 公开完整模块路线，而不是伪造已经实现的业务入口。 */
  @ApiOperation({ summary: "读取分阶段模块路线与当前交付状态" })
  /** 从共享常量返回路线，防止网页和服务端显示不一致。 */
  getModules() {
    return moduleCatalog;
  }
  /** 结束系统控制器。 */
}
/** 注册健康能力并导出给实时诊断通道。 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
/** 系统健康模块不主动连接任何外部付费服务。 */
export class HealthModule {}
