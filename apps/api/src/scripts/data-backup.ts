/** 真实PostgreSQL备份/恢复工具；密码只经子进程环境传递。 */
import { spawn } from 'node:child_process';
/** 二进制备份通过Node流传递，避免旧PowerShell重定向改变字节。 */
import { createReadStream, createWriteStream } from 'node:fs';
/** 等待写流真正完成后才报告备份成功。 */
import { pipeline } from 'node:stream/promises';
/** 创建本地目录和检查明确文件，不递归删除任何路径。 */
import { mkdir, stat } from 'node:fs/promises';
/** 路径只由命令行调用者指定，HTTP与模型不能调用此脚本。 */
import { resolve, dirname } from 'node:path';
/** 从受校验的后端配置读取数据库URI，不打印其原文。 */
import { AppConfig } from '../config/config.module.js';
/** 固定路径默认在.gitignore排除的.local，避免私有备份进入Git。 */
const compose = process.argv.find((value) => value.startsWith('--docker-compose='))?.slice(17);
const command = process.argv[2] ?? 'backup';
const fileArg = process.argv.find((value) => value.startsWith('--file='))?.slice(7);
const config = new AppConfig();
/** Docker仅接收定位客户端配置所需环境，供应商密钥不传给子进程。 */
const dockerEnv: NodeJS.ProcessEnv = Object.fromEntries(
  [
    'PATH',
    'SystemRoot',
    'USERPROFILE',
    'HOME',
    'APPDATA',
    'LOCALAPPDATA',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_CONFIG',
    'TEMP',
    'TMP',
    'ProgramData',
    'ProgramFiles',
    'ProgramW6432',
    'ProgramFiles(x86)',
    'ALLUSERSPROFILE',
    'COMSPEC',
    'HOMEDRIVE',
    'HOMEPATH',
  ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
);
/** 外部命令不通过shell拼接，避免密码或文件名触发命令解释。 */
async function run(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  output?: string,
  input?: string,
) {
  await new Promise<void>((resolveTask, reject) => {
    const child = spawn(binary, args, {
      env,
      stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'],
      windowsHide: true,
    });
    const streams: Promise<unknown>[] = [];
    if (output && child.stdout)
      streams.push(pipeline(child.stdout, createWriteStream(output, { flags: 'wx' })));
    if (input && child.stdin) streams.push(pipeline(createReadStream(input), child.stdin));
    for (const task of streams) task.catch(reject);
    let failed = false;
    child.stderr?.on('data', () => {
      failed = true;
    });
    child.once('error', () =>
      reject(new Error('未找到PostgreSQL客户端工具，请安装pg_dump/pg_restore或在API容器内执行')),
    );
    child.once('exit', (code) =>
      code === 0
        ? void Promise.all(streams).then(() => resolveTask(), reject)
        : reject(
            new Error(`数据库工具执行失败${failed ? '，详细诊断请由管理员在受控环境检查' : ''}`),
          ),
    );
  });
}
/** 只传必要libpq环境，不让子进程继承LLM和地图密钥。 */
async function main() {
  if (!config.env.DATABASE_URL) throw new Error('未配置DATABASE_URL');
  const url = new URL(config.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('数据库协议不合法');
  const database = decodeURIComponent(url.pathname.slice(1));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer',
    PGCONNECT_TIMEOUT: '10',
  };
  const file = resolve(
    fileArg ?? `.local/backups/journey-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`,
  );
  /** 恢复是显式危险动作，必须明确给出文件和目标库名，不默认覆盖任何库。 */
  if (command === 'restore') {
    if (!fileArg || !process.argv.includes(`--confirm-target=${database}`))
      throw new Error('恢复需要--file=绝对备份路径及--confirm-target=目标库名；先在新数据库演练');
    const info = await stat(file);
    if (!info.isFile() || info.size < 100) throw new Error('备份文件不可用');
    if (compose)
      await run(
        'docker',
        [
          'compose',
          '-f',
          resolve(compose),
          'exec',
          '-T',
          'postgres',
          'pg_restore',
          '-U',
          env.PGUSER!,
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          '--dbname',
          database,
        ],
        dockerEnv,
        undefined,
        file,
      );
    else
      await run(
        'pg_restore',
        [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-acl',
          '--exit-on-error',
          '--dbname',
          database,
          file,
        ],
        env,
      );
    console.log('已恢复明确确认的目标数据库，请执行就绪检查与业务验收');
    return;
  }
  /** 默认执行只读逻辑备份，不改源数据库；文件已存在则拒绝覆盖。 */
  if (command !== 'backup') throw new Error('只支持backup或restore');
  await mkdir(dirname(file), { recursive: true });
  try {
    await stat(file);
    throw new Error('备份目标已存在，请换一个文件名');
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  if (compose)
    await run(
      'docker',
      [
        'compose',
        '-f',
        resolve(compose),
        'exec',
        '-T',
        'postgres',
        'pg_dump',
        '-U',
        env.PGUSER!,
        '-d',
        database,
        '--format=custom',
        '--no-owner',
        '--no-acl',
      ],
      dockerEnv,
      file,
    );
  else await run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file], env);
  const result = await stat(file);
  console.log(
    JSON.stringify({
      file,
      bytes: result.size,
      message: '备份完成；请加密保存并定期在新库做恢复演练',
    }),
  );
}
/** 失败只输出固定业务说明，不带私密连接信息或工具stderr。 */
main().catch((error) => {
  console.error(error instanceof Error ? error.message : '备份操作失败');
  process.exitCode = 1;
});
