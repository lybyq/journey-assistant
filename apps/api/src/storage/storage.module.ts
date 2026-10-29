/** 存储是全局基础服务，访问失败时明确返回503。 */
import {
  Global,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
/** PostgreSQL连接池由本应用拥有，不复用其他项目的连接。 */
import { Pool } from 'pg';
/** 使用Drizzle的node-postgres适配器构造强类型数据库。 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
/** 使用Redis官方Node客户端。 */
import { createClient } from 'redis';
/** 所有秘密连接地址通过后端配置服务传入。 */
import { AppConfig } from '../config/config.module.js';
/** 使用受校验和保护的顺序迁移器。 */
import { migrateDatabase } from './migrate.js';
/** 导入完整ORM结构供事务查询推导类型。 */
import * as schema from './schema.js';
/** 数据库与缓存共同构成身份模块的真实基础设施。 */
@Injectable()
/** 失败不创建内存替代品，避免用户误以为会话已经持久化。 */
export class StorageService implements OnModuleInit, OnModuleDestroy {
  /** 内部资源引用在启用存储时初始化。 */
  private pool?: Pool;
  private database?: NodePgDatabase<typeof schema>;
  private cache?: ReturnType<typeof createClient>;
  /** 日志只输出固定信息，不输出含凭据的连接异常原文。 */
  private readonly logger = new Logger(StorageService.name);
  /** 连接真实通过检测后才标记就绪。 */
  private postgresReady = false;
  /** 配置只在本服务内部使用。 */
  constructor(private readonly config: AppConfig) {}
  /** 开启存储时完成连接及迁移后，API才开始监听。 */
  async onModuleInit(): Promise<void> {
    /** 保留工程底座的无存储诊断运行方式，身份接口明确不可用。 */
    if (this.config.env.STORAGE_ENABLED !== 'true') return;
    /** 限制连接池和SQL超时，避免故障时请求永久挂起。 */
    this.pool = new Pool({
      connectionString: this.config.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
    });
    /** 连接错误必须被监听，且不能打印密码和主机认证信息。 */
    this.pool.on('error', () => {
      this.postgresReady = false;
      this.logger.error('PostgreSQL连接异常');
    });
    /** Redis故障时不排队身份请求，避免延迟恢复后重复执行。 */
    this.cache = createClient({
      url: this.config.env.REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (attempt) =>
          attempt >= 3 ? new Error('Redis连接重试已达上限') : Math.min(200 * attempt, 3000),
      },
    });
    /** 消费错误事件，防止未处理异常终止Node进程。 */
    this.cache.on('error', () => this.logger.warn('Redis连接暂时不可用'));
    /** 初始化失败需要及时关闭已创建资源。 */
    try {
      /** 先验证数据库，再以锁保护迁移。 */
      await this.pool.query('SELECT 1');
      await migrateDatabase(this.pool);
      /** 强类型ORM仅在数据库实际可访问后公开。 */
      this.database = drizzle(this.pool, { schema });
      this.postgresReady = true;
      /** 等待Redis真正完成握手，失败不继续开放身份请求。 */
      await this.cache.connect();
      await this.cache.ping();
      /** 底层错误不带到API响应或普通控制台日志中。 */
    } catch {
      await this.onModuleDestroy();
      throw new Error('用户数据服务初始化失败，请检查PostgreSQL和Redis配置');
    }
    /** 结束启动生命周期。 */
  }
  /** 业务通过getter获取ORM，未启用存储时不返回空对象。 */
  get db(): NodePgDatabase<typeof schema> {
    if (!this.database || !this.postgresReady)
      throw new ServiceUnavailableException('用户数据服务尚未就绪');
    return this.database;
  }
  /** 持久化事件需要显式行锁与背压查询，仍复用同一受控连接池。 */
  get sql(): Pool {
    if (!this.pool || !this.postgresReady)
      throw new ServiceUnavailableException('用户数据服务尚未就绪');
    return this.pool;
  }
  /** Redis断线时身份限流失败关闭，不默默绕过。 */
  get redis(): ReturnType<typeof createClient> {
    if (!this.cache?.isReady) throw new ServiceUnavailableException('身份服务暂时不可用');
    return this.cache;
  }
  /** 返回无地址和密钥的公开就绪状态。 */
  status() {
    const enabled = this.config.env.STORAGE_ENABLED === 'true';
    return {
      enabled,
      postgres: enabled
        ? this.postgresReady
          ? ('ready' as const)
          : ('unavailable' as const)
        : ('disabled' as const),
      redis: enabled
        ? this.cache?.isReady
          ? ('ready' as const)
          : ('unavailable' as const)
        : ('disabled' as const),
    };
  }
  /** 运维探针执行真实检查，不只看构造函数是否成功过。 */
  async readiness() {
    if (this.config.env.STORAGE_ENABLED === 'true') {
      try {
        await this.pool?.query('SELECT 1');
        this.postgresReady = true;
      } catch {
        this.postgresReady = false;
        throw new ServiceUnavailableException('用户数据服务尚未就绪');
      }
      try {
        await this.redis.ping();
      } catch {
        throw new ServiceUnavailableException('身份缓存服务暂时不可用');
      }
    }
    return this.status();
  }
  /** 应用关闭时回收连接，不关闭任何外部Docker容器或数据卷。 */
  async onModuleDestroy(): Promise<void> {
    if (this.cache?.isOpen) this.cache.destroy();
    await this.pool?.end();
    this.database = undefined;
    this.postgresReady = false;
  }
  /** 结束存储服务。 */
}
/** 将存储注入独立领域模块，避免各控制器各建一套连接池。 */
@Global()
/** 显式导出真实存储服务。 */
@Module({ providers: [StorageService], exports: [StorageService] })
/** 存储模块没有直接访问业务表的HTTP入口。 */
export class StorageModule {}
