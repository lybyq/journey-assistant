/** 计算迁移文件校验和，防止已执行迁移被静默修改。 */
import { createHash } from 'node:crypto';
/** 使用原生文件接口加载随仓库交付的SQL迁移。 */
import { readdir, readFile } from 'node:fs/promises';
/** 迁移只接受当前已验证连接池，不拼接外部SQL参数。 */
import type { Pool } from 'pg';
/** 仅兼容已验证SQL的注释清理，文件名与双摘要精确匹配；不放宽DDL完整性检查。 */
const commentOnlyCompatibility = [
  {
    name: '0003_agent_runtime.sql',
    old: '21444261e115e64f551f515c19d81e052322220f8bc2e33a3fa0488819eb0245',
    clean: '76547912594f51792f01a4baa1bb75485a8431f8135908b6d513d2785a21e933',
  },
  {
    name: '0003_agent_runtime.sql',
    old: '7b25c7aa67affbc47483c1fec0f66928ec4d1e0379687629c77d02bf856094cc',
    clean: '5d9658f8a3fcab7b9908e9f73dd51efe017e39b8066b91381dd7f216f641b7b4',
  },
  {
    name: '0004_travel_modules.sql',
    old: '8a2e4f0630b75c8384ea9bbd6340287c984cf6a32138995fafee39b0eb65f55f',
    clean: '2e71b9d8ada908ffc5129363cfbecef3b9444ff5e15500f3ad6fd8394a96f6a8',
  },
  {
    name: '0004_travel_modules.sql',
    old: '7ecc10b712e5b61137e916d2aede5dfd744baea7589605d9b4f98cbf3cb194df',
    clean: 'c52d09becda3b459257653601fbd7a993be4fd29fe034e86f7073f9c7a96c2fa',
  },
];
/** 使用数据库级互斥锁和事务，让多个API实例同时启动也不会重复建表。 */
export async function migrateDatabase(pool: Pool): Promise<void> {
  /** 在独立连接上持有互斥锁，直到所有迁移完成。 */
  const client = await pool.connect();
  /** 锁标识仅属于本数据库，不影响其他项目数据库。 */
  const lockId = 77420902;
  /** 发生任何失败都关闭事务并释放连接。 */
  try {
    /** 防止多个实例同时读取尚未登记的迁移。 */
    await client.query('SELECT pg_advisory_lock($1)', [lockId]);
    /** 迁移账本允许重复创建，不修改任何既有业务表。 */
    await client.query(
      'CREATE TABLE IF NOT EXISTS journey_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    /** 迁移目录相对编译产物定位，兼容从根目录或应用目录启动。 */
    const directory = new URL('../../migrations/', import.meta.url);
    /** 只执行明确命名的仓库SQL文件。 */
    const names = (await readdir(directory))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    /** 按编号逐个应用迁移，不并行执行依赖DDL。 */
    for (const name of names) {
      /** 读取迁移内容并计算完整性摘要。 */
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      /** 查询参数化账本记录，文件名不进入SQL拼接。 */
      const previous = await client.query<{ checksum: string }>(
        'SELECT checksum FROM journey_migrations WHERE name=$1',
        [name],
      );
      /** 已执行文件内容改变时拒绝启动，要求新增迁移而非改写历史。 */
      if (previous.rows[0]) {
        const compatible = commentOnlyCompatibility.some(
          (pair) =>
            pair.name === name &&
            pair.old === previous.rows[0]!.checksum &&
            pair.clean === checksum,
        );
        if (previous.rows[0].checksum !== checksum && !compatible)
          throw new Error('已执行迁移的校验和发生变化');
        continue;
      }
      /** 每个迁移与其账本记录必须原子提交。 */
      await client.query('BEGIN');
      /** SQL只来自受版本管理的本地文件，绝不接受HTTP输入。 */
      await client.query(sql);
      /** 成功执行后登记校验和。 */
      await client.query('INSERT INTO journey_migrations(name,checksum) VALUES($1,$2)', [
        name,
        checksum,
      ]);
      /** 提交一次完整迁移。 */
      await client.query('COMMIT');
      /** 结束顺序迁移。 */
    }
    /** 失败时先回滚，随后让启动失败而不是降级到内存假数据。 */
  } catch {
    await client.query('ROLLBACK');
    throw new Error('数据库迁移失败，请检查迁移完整性及数据库权限');
  } finally {
    /** 锁与连接必须始终释放。 */
    await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => undefined);
    client.release();
  }
  /** 结束迁移入口。 */
}
