/** 引入轻量路由组件和 HTML5 history。 */
import { createRouter, createWebHistory } from 'vue-router';
/** 首页只负责组装旅行工作台。 */
import WorkspacePage from '@/pages/WorkspacePage.vue';
/** 导出单一路由实例；不存在的路径回到工作台。 */
export const router = createRouter({
  /** Web 端使用标准浏览器地址；未来小程序可替换页面导航适配器。 */
  history: createWebHistory(),
  /** 当前仅开放已实现的工作台，不提供点击后无结果的业务页面。 */
  routes: [
    { path: '/', component: WorkspacePage },
    /** 分享页只加载固定公开版本，不挂载私人工作区。 */
    { path: '/share', component: () => import('@/pages/SharedPlanPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  /** 结束路由配置。 */
});
