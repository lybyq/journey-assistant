<!-- 根脚本只安装路由视图，不承载聊天或旅行逻辑。 -->
<script setup lang="ts">
/** 引入路由渲染出口，保持根组件职责单一。 */
import { RouterView } from 'vue-router';
/** 结束根组件脚本。 */
</script>
<!-- 根模板由路由决定实际页面。 -->
<template>
  <!-- 渲染当前工作台页面。 -->
  <RouterView />
<!-- 结束根模板。 -->
</template>
