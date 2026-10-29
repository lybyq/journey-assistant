/** 认证模块只组合身份相关服务和控制器。 */
import { Module } from '@nestjs/common';
/** 密码摘要与常量时间验证独立实现。 */
import { PasswordService } from './password.service.js';
/** 会话签发、轮换与撤销统一管理。 */
import { AuthService } from './auth.service.js';
/** HTTP认证与自身资料使用独立控制器。 */
import { AuthController } from './auth.controller.js';
/** 资料接口不接触认证Cookie。 */
import { MeController } from './me.controller.js';
/** 守卫可导出供会话等后续领域模块复用。 */
import { AccessGuard, AuthBoundaryGuard } from './auth.guards.js';
/** 身份模块依赖全局存储，不私自创建新的连接池。 */
@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, PasswordService, AccessGuard, AuthBoundaryGuard],
  exports: [AuthService, AccessGuard],
})
/** 注册身份能力。 */
export class IdentityModule {}
