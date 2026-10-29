<!-- 匿名分享仅展示固定版本，不挂载私人账户、项目或聊天数据。 -->
<script setup lang="ts">
/** 分享读取只保留本页公开结果。 */
import { onMounted, shallowRef } from 'vue';
/** 复用已净化的Markdown组件。 */
import MarkdownAnswer from '@/components/chat/MarkdownAnswer.vue';
/** 分享秘密来自fragment，不出现在HTTP URL或访问日志。 */
const markdown = shallowRef('');
const error = shallowRef('');
const loading = shallowRef(true);
/** 不调用身份恢复，不将分享令牌写入浏览器持久化存储。 */
onMounted(async () => {
  const token = window.location.hash.slice(1);
  history.replaceState(null, '', window.location.pathname);
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL ?? ''}/api/v1/shared/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'omit',
        signal: AbortSignal.timeout(12000),
        referrerPolicy: 'no-referrer',
      },
    );
    if (!response.ok) throw new Error('分享不存在、已过期或已被撤销');
    const data = await response.json();
    markdown.value = String(data.markdown ?? '');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '分享暂时不可用';
  } finally {
    loading.value = false;
  }
});
</script>
<template>
  <main class="shared-page">
    <header>
      <a href="/">行也 JOURNEY</a>
      <span>一份为你分享的旅行方案</span>
    </header>
    <p v-if="loading">正在读取固定版本…</p>
    <div v-else-if="error" role="alert">
      <h1>这份旅行暂时无法打开。</h1>
      <p>{{ error }}</p>
      <a href="/">回到行也</a>
    </div>
    <MarkdownAnswer v-else :content="markdown" :streaming="false" />
    <footer>固定版本快照 · 价格、营业与预约需出发前重新核实</footer>
  </main>
</template>
<style scoped>
/** 独立阅读页不加载私人工作台布局。 */
.shared-page {
  max-width: 850px;
  margin: 0 auto;
  padding: 40px 25px;
  color: #244739;
  background: #fafaf5;
  min-height: 100dvh;
  box-sizing: border-box;
}
.shared-page header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid #dce1d5;
  padding-bottom: 25px;
  margin-bottom: 35px;
  font-size: 13px;
}
.shared-page header > a {
  font-size: 19px;
  letter-spacing: 3px;
  color: #345849;
  text-decoration: none;
}
.shared-page footer {
  margin-top: 45px;
  border-top: 1px solid #dce1d5;
  padding-top: 20px;
  font-size: 13px;
  color: #84917c;
}
.shared-page h1 {
  font-family: 'STSong', serif;
  font-size: 28px;
}
.shared-page p {
  font-size: 14px;
  line-height: 1.8;
}
</style>
