/** 本地存储配置生成器使用安全随机密钥，不写入仓库模板。 */
import { randomBytes } from 'node:crypto';
/** 只创建不存在的配置文件，绝不覆盖用户已有模型或数据库设置。 */
import { writeFile } from 'node:fs/promises';
/** 文件位置相对编译后的脚本目录，与启动工作目录无关。 */
const target = new URL('../../.env.storage.local', import.meta.url);
/** 本项目使用独立端口，不修改占用5432与6379的其他项目。 */
const contents = `# 身份与存储本地专用配置，不提交版本控制。\nSTORAGE_ENABLED=true\nDATABASE_URL=postgresql://journey:journey_local@127.0.0.1:55433/journey\nREDIS_URL=redis://127.0.0.1:56379\nREDIS_PREFIX=journey\nAUTH_SECRET=${randomBytes(48).toString('base64url')}\n`;
/** 写入时使用排他创建，保护已有配置。 */
try {
  await writeFile(target, contents, { flag: 'wx', mode: 0o600 });
  console.log('本地存储配置已创建；已有模型配置未改动。');
} catch (error) {
  /** 已存在则保持原样；其他文件系统错误仍然抛出。 */
  if ((error as NodeJS.ErrnoException).code === 'EEXIST')
    console.log('本地存储配置已存在，保持现有配置。');
  else throw error;
}
