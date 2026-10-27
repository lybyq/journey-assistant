/** 使用Node内置异步scrypt，不引入平台相关的原生密码模块。 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
/** 密码服务作为单例复用一致的派生参数。 */
import { Injectable, type OnModuleInit } from "@nestjs/common";
/** 使用OWASP列出的等价scrypt配置N=2^15、r=8、p=3。 */
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
/** 异步派生避免阻塞Node事件循环；固定64字节输出。 */
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}
/** 统一注册和登录密码处理，数据库绝不保存原文。 */
@Injectable()
/** 未知邮箱也执行相同密码验证，减小用户枚举的时序差异。 */
export class PasswordService implements OnModuleInit {
  /** 虚拟摘要仅用于未知邮箱的验证，不对应可登录账户。 */
  private dummyHash = "";
  /** 启动时准备一次虚拟凭据，避免登录时泄露邮箱是否存在。 */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash(randomBytes(32).toString("base64url"));
  }
  /** 为每个密码生成独立的随机盐及版本化摘要格式。 */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(32);
    const key = await derive(password, salt);
    return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
  }
  /** 仅支持固定的已知参数，防止异常存储值触发超大资源消耗。 */
  async verify(password: string, stored?: string): Promise<boolean> {
    /** 缺少用户凭据时同样执行一次合法派生。 */
    const encoded = stored ?? this.dummyHash;
    /** 对存储结构先进行严格格式检查。 */
    const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{64})\$([a-f0-9]{128})$/.exec(
      encoded,
    );
    /** 无效存储值不进入任意参数派生逻辑。 */
    if (!match?.[1] || !match[2]) return false;
    /** 使用常量时间比较验证派生结果。 */
    const actual = await derive(password, Buffer.from(match[1], "hex"));
    return (
      timingSafeEqual(actual, Buffer.from(match[2], "hex")) && Boolean(stored)
    );
    /** 结束密码验证。 */
  }
  /** 结束密码服务。 */
}
