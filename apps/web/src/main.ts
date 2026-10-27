/** 创建标准 Vue 3 应用实例。 */
import { createApp } from 'vue';
/** 使用 Pinia 隔离聊天状态与视图组件，便于未来小程序复用。 */
import { createPinia } from 'pinia';
/** 引入薄入口组件，业务视图通过路由组合。 */
import App from './App.vue';
/** 引入页面路由，未来业务模块可增加独立页面。 */
import { router } from './router';
/** 加载统一设计令牌、字体和响应式布局基础。 */
import './styles/base.css';
/** 按顺序安装状态管理和路由，再挂载网页。 */
createApp(App).use(createPinia()).use(router).mount('#app');
