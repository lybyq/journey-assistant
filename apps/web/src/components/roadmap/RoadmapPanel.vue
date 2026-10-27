<!-- 路线图完整展示产品模块，避免把框架交付误认为完整业务上线。 -->
<script setup lang="ts">
/** 路线数据直接使用跨端共享常量。 */
import { moduleCatalog } from '@journey/contracts';
/** 使用完成和待开始图标区分真实交付状态。 */
import { ArrowUpRight, Check, CircleDashed } from 'lucide-vue-next';
/** 明确允许父页面返回工作台。 */
const emit = defineEmits<{ back: [] }>();
/** 结束路线脚本。 */
</script>
<!-- 以有序模块列表呈现依赖关系，不使用虚构进度。 -->
<template>
  <!-- 路线内容拥有独立滚动区域。 -->
  <section class="roadmap">
    <!-- 清楚标明当前完成范围。 -->
    <header><span class="eyebrow">BUILDING THE JOURNEY</span><h1>从连接，到完整旅程。</h1><p>工程底座与用户数据模块已完成。后续模块由你指定后开始。</p><button type="button" @click="emit('back')">返回工作台<ArrowUpRight :size="14" /></button></header>
    <!-- 状态来自代码中的真实交付清单。 -->
    <ol class="module-list"><li v-for="item in moduleCatalog" :key="item.id" :class="{ ready: item.status === 'ready' }"><span class="module-number">{{ String(item.phase).padStart(2, '0') }}</span><div><h2>{{ item.title }}</h2><p>{{ item.description }}</p></div><span class="module-status"><Check v-if="item.status === 'ready'" :size="13" /><CircleDashed v-else :size="13" />{{ item.status === 'ready' ? '已完成' : '待实现' }}</span></li></ol>
    <!-- 不在页面提供自动开始下一模块的虚假按钮。 -->
    <p class="roadmap-note">下一步建议：生产实时对话。包括消息历史、运行归属、流式传输、取消与断线恢复。</p>
  <!-- 结束路线内容。 -->
  </section>
<!-- 结束路线模板。 -->
</template>
<!-- 路线采用阅读友好的纵向编辑布局。 -->
<style scoped>
/** 路线表在工作区内独立滚动。 */
.roadmap { width: 100%; max-width: 900px; margin: 0 auto; overflow-y: auto; padding: 12px 4px 35px; scrollbar-width: thin; }
/** 阶段眉题使用统一的出版物式排版。 */
.eyebrow { font-size: 9px; letter-spacing: 2px; color: #7b8b79; }
/** 路线标题与首页保持字体一致。 */
h1 { font: 500 30px/1.5 'STSong', 'Songti SC', serif; letter-spacing: 1px; color: var(--forest); margin: 13px 0 10px; }
/** 简介强调范围与用户控制顺序。 */
header > p { font-size: 12px; color: var(--muted); line-height: 1.8; }
/** 返回操作是当前页唯一动作。 */
header > button { display: inline-flex; align-items: center; gap: 8px; color: var(--forest); font-size: 11px; margin: 9px 0 24px; }
/** 有序列表以实际模块编号建立路线。 */
.module-list { list-style: none; padding: 0; margin: 0; }
/** 模块用行分隔避免卡片马赛克。 */
.module-list li { display: flex; align-items: center; gap: 20px; padding: 20px 0; border-top: 1px solid var(--line); }
/** 完成模块仅用轻微底色强调。 */
.module-list li.ready { background: #edf3e71f; }
/** 固定宽度编号有助纵向对齐。 */
.module-number { font-family: Georgia, serif; font-size: 21px; color: #a2ad96; min-width: 30px; }
/** 模块主标题使用正常阅读字号。 */
h2 { margin: 0 0 7px; font-size: 13px; font-weight: 500; color: var(--forest); }
/** 简述限制行长以方便比较相邻模块。 */
.module-list p { margin: 0; color: #8a9380; font-size: 11px; line-height: 1.7; }
/** 状态在右侧保持一行。 */
.module-status { display: flex; align-items: center; gap: 6px; white-space: nowrap; margin-left: auto; color: #9ba58e; font-size: 10px; }
/** 已完成使用与品牌相同的强调色。 */
.ready .module-status, .ready .module-number { color: var(--forest); }
/** 下步建议不自动开始后续工作。 */
.roadmap-note { border-top: 1px solid var(--line); padding-top: 22px; font-size: 11px; line-height: 1.9; color: var(--muted); }
/** 手机缩小编号与间距，完整保留描述与状态。 */
@media (max-width: 760px) { h1 { font-size: 25px; } .module-list li { gap: 13px; } .module-status { font-size: 9px; } .module-list p { font-size: 10px; } }
/** 结束路线样式。 */
</style>
