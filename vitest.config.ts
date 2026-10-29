/** 导入测试配置函数，避免把测试运行配置混入应用构建。 */
import { defineConfig } from 'vitest/config';
/** 统一执行协议、服务和网页纯逻辑测试，组件测试将在对应业务模块补充。 */
export default defineConfig({
  /** 服务端测试需要 Node 的真实 HTTP 和 WebSocket 能力。 */
  /** 集成套件会启动真实Nest子进程；限制并行避免同时加载多份模型SDK导致启动争用。 */
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
    maxWorkers: 2,
  },
  /** 结束测试配置声明。 */
});
