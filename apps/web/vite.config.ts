/** 使用 URL 工具解析当前配置所在目录，避免中文路径下的手工路径拼接。 */
import { fileURLToPath, URL } from 'node:url';
/** 引入 Vue 单文件组件编译插件。 */
import vue from '@vitejs/plugin-vue';
/** 引入 Vite 配置辅助函数以获得完整类型检查。 */
import { defineConfig } from 'vite';
/** 导出网页构建和本地代理配置；生产环境需由反向代理提供相同路径。 */
export default defineConfig({
  /** 仅编译标准 Vue 3 应用，后续小程序通过独立入口适配。 */
  plugins: [vue()],
  /** 将 @ 映射到网页源码目录，避免组件之间出现多层相对路径。 */
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  /** 固定开发端口，防止自动换端口后与后端来源白名单不一致。 */
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
  /** 预览构建产物时也允许验证真实 API 和 WebSocket。 */
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': { target: 'ws://127.0.0.1:3000', ws: true },
    },
  },
  /** 禁止输出浏览器源码映射，减少生产部署时的源码暴露。 */
  build: { sourcemap: false },
  /** 结束 Vite 配置。 */
});
