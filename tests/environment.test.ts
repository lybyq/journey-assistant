/** Vitest 只验证配置边界，不为简单可逆样式写实现镜像测试。 */
import { describe, expect, it } from 'vitest';
/** 导入不依赖 Nest 容器的纯配置校验函数。 */
import { parseEnvironment } from '../apps/api/src/config/environment.js';
/** 配置错误必须在监听端口之前被阻止。 */
describe('环境配置边界', () => {
  /** 字符串 false 不能被错误转换为真值。 */
  it('保留显式关闭诊断开关', () => { expect(parseEnvironment({ ENABLE_DIAGNOSTICS: 'false' }).ENABLE_DIAGNOSTICS).toBe('false'); });
  /** 无效端口不能静默回退导致监听到意外地址。 */
  it('拒绝无效端口', () => { expect(() => parseEnvironment({ PORT: '70000' })).toThrow('PORT'); });
  /** 来源白名单不允许通过路径伪装成另一个 origin。 */
  it('拒绝带路径的跨域来源', () => { expect(() => parseEnvironment({ CORS_ORIGINS: 'http://localhost:5173/path' })).toThrow(); });
  /** 未鉴权诊断能力不得在生产中被显式启用。 */
  it('生产环境拒绝开发诊断开关', () => { expect(() => parseEnvironment({ NODE_ENV: 'production', ENABLE_DIAGNOSTICS: 'true' })).toThrow('生产环境'); });
  /** 启动错误只能包含字段名，不能泄漏带凭据的错误 URL。 */
  it('校验失败不泄漏原始配置值', () => { const validate = () => parseEnvironment({ LLM_BASE_URL: 'secret-test-token' }); expect(validate).toThrow('LLM_BASE_URL'); expect(validate).not.toThrow('secret-test-token'); });
/** 结束配置边界测试。 */
});
