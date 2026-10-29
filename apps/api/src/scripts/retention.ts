/** 运维保留策略只清理过期指标与分享记录，不删除旅行和聊天正文。 */
import { Pool } from 'pg';
/** 所有配置仍由后端环境统一校验。 */
import { AppConfig } from '../config/config.module.js';
/** 默认dry-run，显式--apply才执行已写入文档的清理范围。 */
async function main() {
  const config = new AppConfig();
  if (config.env.STORAGE_ENABLED !== 'true') throw new Error('尚未启用存储');
  const pool = new Pool({ connectionString: config.env.DATABASE_URL, max: 1 });
  try {
    const operations = await pool.query(
      "SELECT count(*)::int AS count FROM trip_operations WHERE created_at<now()-interval '90 days'",
    );
    const shares = await pool.query(
      "SELECT count(*)::int AS count FROM trip_shares WHERE expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days'",
    );
    const apply = process.argv.includes('--apply');
    if (apply) {
      await pool.query('BEGIN');
      try {
        await pool.query("DELETE FROM trip_operations WHERE created_at<now()-interval '90 days'");
        await pool.query(
          "DELETE FROM trip_shares WHERE expires_at<now()-interval '30 days' OR revoked_at<now()-interval '30 days'",
        );
        await pool.query('COMMIT');
      } catch {
        await pool.query('ROLLBACK');
        throw new Error('清理未完成，事务已回滚');
      }
    }
    console.log(
      JSON.stringify({
        mode: apply ? 'applied' : 'dry-run',
        operations: operations.rows[0].count,
        expiredShares: shares.rows[0].count,
        preserved: '用户、会话、消息、旅行项目、版本、证据与checkpoint均不删除',
      }),
    );
  } finally {
    await pool.end();
  }
}
/** 不打印包含凭据的SQL异常。 */
main().catch(() => {
  console.error('运维保留策略执行失败，请检查存储配置');
  process.exitCode = 1;
});
