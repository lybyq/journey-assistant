/** 命令行迁移复用与应用启动完全相同的配置校验。 */
import { loadEnvironment } from '../config/environment.js';
/** 迁移只使用本进程拥有的短生命周期连接池。 */
import { Pool } from 'pg';
/** 与自动启动迁移共用互斥锁、校验和及事务机制。 */
import { migrateDatabase } from '../storage/migrate.js';
/** 读取进程配置和本地存储文件，不打印秘密值。 */
const env = loadEnvironment();
/** 禁用存储时拒绝对默认或猜测的数据库运行迁移。 */
if (env.STORAGE_ENABLED !== 'true') throw new Error('请先配置并启用真实存储');
/** 限制数据库连接等待时间。 */
const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
/** 幂等执行迁移，成功后只报告固定状态。 */
try { await migrateDatabase(pool); console.log('数据库迁移校验通过，已应用所有待执行迁移。'); }
/** 无论成功失败都释放连接，不创建后台进程。 */
finally { await pool.end(); }
