/** 已鉴权旅行API还需要用户级读写配额，不能只限制昂贵查询。 */
import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
/** 真实共享Redis支持多个API实例。 */
import { StorageService } from '../../storage/storage.module.js';
/** 命名空间由服务端配置。 */
import { AppConfig } from '../../config/config.module.js';
/** 必须先执行AccessGuard，userId不从请求体读取。 */
import type { AuthRequest } from '../identity/auth.guards.js';
/** 每分钟最多180次读、60次写，失败关闭。 */
@Injectable()
export class TravelRateGuard implements CanActivate {
  /** 不在实例内维护多用户Map，所有窗口由Redis过期释放。 */
  constructor(
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}
  /** 访问身份由前一个守卫提供，未经身份不能得到配额。 */
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!req.actor) throw new HttpException('请先登录', 401);
    const read = req.method === 'GET';
    const key = `${this.config.env.REDIS_PREFIX}:travel:http:${req.actor.userId}:${read ? 'read' : 'write'}`;
    const count = Number(
      await this.storage.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",
        { keys: [key], arguments: [] },
      ),
    );
    if (count > (read ? 180 : 60)) throw new HttpException('旅行资料操作过于频繁，请稍后重试', 429);
    return true;
  }
}
