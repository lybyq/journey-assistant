/** 引入 Nest 依赖注入和模块工具。 */
import { Global, Injectable, Module } from '@nestjs/common';
/** 加载统一环境规范，避免各模块自行读取 process.env。 */
import { loadEnvironment } from './environment.js';
/** 配置服务只在后端注入，包含私密值，不能作为 HTTP 响应返回。 */
@Injectable()
/** 为整个应用提供单一配置源。 */
export class AppConfig {
  /** 启动时一次性读取配置，保持单进程内的一致性。 */
  readonly env = loadEnvironment();
  /** 将逗号分隔的来源列表转换成用于 HTTP 和 WebSocket 的精确白名单。 */
  readonly origins = this.env.CORS_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  /** 开发环境默认支持自检；生产环境始终关闭。 */
  readonly diagnosticsEnabled =
    this.env.NODE_ENV !== 'production' && this.env.ENABLE_DIAGNOSTICS !== 'false';
  /** 结束配置服务。 */
}
/** 全局模块使配置只初始化一次，各业务模块无需重复注册。 */
@Global()
/** 注册配置服务并显式导出给应用内部使用。 */
@Module({ providers: [AppConfig], exports: [AppConfig] })
/** 配置模块不暴露任何控制器。 */
export class ConfigModule {}
