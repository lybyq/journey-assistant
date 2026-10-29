/** 在HTTP边界统一验证不可信请求参数。 */
import { BadRequestException, type PipeTransform } from '@nestjs/common';
/** Zod类型参数让控制器获得与校验结果一致的静态类型。 */
import type { ZodType } from 'zod';
/** 每个路由显式提供共享schema，不允许额外字段绕过校验。 */
export class SchemaPipe<T> implements PipeTransform<unknown, T> {
  /** schema由受版本管理的代码传入，不接受客户端动态定义。 */
  constructor(private readonly schema: ZodType<T>) {}
  /** 只返回安全的字段路径，不反射原始密码或请求值。 */
  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success)
      throw new BadRequestException(
        `请检查输入字段：${[...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '请求内容'))].join('、')}`,
      );
    return parsed.data;
  }
  /** 结束统一校验管道。 */
}
