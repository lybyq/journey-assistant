<!-- 安全回答组件只负责富文本呈现、来源链接与复制。 -->
<script setup lang="ts">
/** computed 缓存净化结果，watch 将频繁文本增量合并到一帧渲染。 */
import { computed, onUnmounted, shallowRef, watch, useId, useTemplateRef } from 'vue';
/** 复制反馈图标使用统一线性图标体系。 */
import { Check, Copy, BookOpen, ArrowUpRight, Sparkles } from 'lucide-vue-next';
/** 标题目录直接读取Markdown语法树，保留模型原文，不生成额外旅行结论。 */
import { marked, type Tokens } from 'marked';
/** 所有 Markdown 必须通过统一净化函数后才允许使用 v-html。 */
import { renderMarkdown } from '@/features/chat/markdown';
/** 明确输入为普通字符串，组件不访问网络和模型 SDK。 */
const props = defineProps<{ content: string; streaming: boolean }>();
/** 每条回答拥有独立锚点，页面多个历史回答不会跳错章节。 */
const prefix = useId().replace(/[^a-zA-Z0-9-]/g, '');
const article = useTemplateRef<HTMLElement>('article');
const expandedReading = shallowRef(true);
/** 目录只取真实标题；展示最多八项，避免长文目录占满首屏。 */
const sections = computed(() =>
  marked
    .lexer(renderedSource.value)
    .filter((token): token is Tokens.Heading => token.type === 'heading')
    .map((token, index) => ({
      title: token.text.replace(/[*_`]/g, ''),
      id: `${prefix}-section-${index}`,
    }))
    .slice(0, 8),
);
/** 文字量属于阅读提示，不能冒充模型运行进度或报价完整率。 */
const reading = computed(() => Math.max(1, Math.ceil(props.content.length / 500)));
/** 滚动限定在本条回答内；减少动态偏好时使用即时定位。 */
function jump(id: string) {
  article.value?.querySelector(`[id="${id}"]`)?.scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    block: 'start',
  });
}
/** 暂存已提交渲染的文本，限制每帧最多更新一次。 */
const renderedSource = shallowRef(props.content);
/** 记录复制完成的短暂反馈。 */
const copied = shallowRef(false);
/** 剪贴板被禁用时给出可见失败提示，不假装操作成功。 */
const copyFailed = shallowRef(false);
/** 保存浏览器资源句柄，组件卸载时需要释放。 */
let frame = 0;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
/** 合并同一帧内收到的增量，减少 Markdown 反复重解析。 */
watch(
  () => props.content,
  () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      renderedSource.value = props.content;
    });
  },
);
/** 此值已完成允许列表净化，是模板唯一允许注入的 HTML。 */
const safeHtml = computed(() => renderMarkdown(renderedSource.value, prefix));
/** 复制原始 Markdown，保留表格与链接供用户继续编辑。 */
async function copy(): Promise<void> {
  /** 剪贴板可能被权限策略禁用，需要明确给出操作结果。 */
  try {
    await navigator.clipboard.writeText(props.content);
    copied.value = true;
    copyFailed.value = false;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    /** 失败时保留可选中文本，不伪装为复制成功。 */
    copied.value = false;
    copyFailed.value = true;
  }
  /** 结束复制操作。 */
}
/** 外部来源只允许 http、https；阻止其他协议和页面跳转劫持。 */
function openSource(event: MouseEvent): void {
  /** 从实际点击元素向上查找最近的 Markdown 链接。 */
  const anchor = (event.target as Element).closest('a');
  /** 点击正文或代码时不执行链接逻辑。 */
  if (!anchor) return;
  /** 在任何校验之前阻止浏览器默认导航。 */
  event.preventDefault();
  /** 只允许绝对的网络来源链接，拒绝相对路径与 javascript。 */
  try {
    const url = new URL(anchor.getAttribute('href') ?? '');
    if (['http:', 'https:'].includes(url.protocol))
      window.open(url.href, '_blank', 'noopener,noreferrer');
  } catch {
    /** 非法 URL 直接忽略，不执行外部内容。 */
    return;
  }
  /** 结束来源链接处理。 */
}
/** 释放动画帧和反馈计时器。 */
onUnmounted(() => {
  cancelAnimationFrame(frame);
  clearTimeout(copyTimer);
});
/** 结束组件脚本。 */
</script>
<!-- 富文本区域保持可选中，不对每个 token 做读屏播报。 -->
<template>
  <!-- 回答主体与复制操作属于同一语义文章。 -->
  <article ref="article" :class="['answer-body', { 'reading-expanded': expandedReading }]">
    <header v-if="content" class="answer-header">
      <span class="answer-signature">
        <Sparkles :size="16" />
        行也的旅行笔记
      </span>
      <span class="answer-reading">
        <i :class="{ live: streaming }"></i>
        {{ streaming ? '正在整理' : '约 ' + reading + ' 分钟阅读' }}
      </span>
    </header>
    <nav v-if="sections.length > 1" class="answer-outline" aria-label="回答章节导航">
      <button v-for="section in sections" :key="section.id" type="button" @click="jump(section.id)">
        {{ section.title }}
        <ArrowUpRight :size="12" />
      </button>
    </nav>
    <!-- safeHtml 仅来自 renderMarkdown 的允许列表净化结果。 -->
    <div class="markdown" @click="openSource" v-html="safeHtml"></div>
    <!-- 流式光标只有执行中可见，减少动态干扰。 -->
    <span v-if="streaming" class="stream-cursor" aria-label="正在接收回答"></span>
    <!-- 完成后才显示复制，避免用户误以为复制了完整回答。 -->
    <footer v-if="!streaming && content" class="answer-actions">
      <button class="copy-button" type="button" @click="copy">
        <Check v-if="copied" :size="14" />
        <Copy v-else :size="14" />
        {{ copied ? '已复制 Markdown' : copyFailed ? '复制失败，请选择正文复制' : '复制回答' }}
      </button>
      <button
        type="button"
        class="reading-button"
        :aria-pressed="expandedReading"
        @click="expandedReading = !expandedReading"
      >
        <BookOpen :size="15" />
        {{ expandedReading ? '舒展阅读' : '紧凑阅读' }}
      </button>
    </footer>
    <!-- 结束回答文章。 -->
  </article>
  <!-- 结束富文本模板。 -->
</template>
<!-- 富文本样式只在当前回答组件生效。 -->
<style scoped>
/** 使用可读行高和适中的文字对比，兼顾长报告阅读。 */
.markdown {
  color: var(--ink);
  font-size: 16px;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
/** 回答是完整阅读面板；短答保持紧凑，长答通过目录和排版建立层次。 */
.answer-body {
  background: #fffefb;
  border: 1px solid #dce5da;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 12px 40px #183d3010;
  position: relative;
}
.answer-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 18px 24px;
  border-bottom: 1px solid #e5eadf;
  background: linear-gradient(110deg, #f0f5e9, #fbfcf6);
}
.answer-signature {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 16px;
  font-weight: 650;
  color: #234b3c;
}
.answer-signature svg {
  color: #668b3f;
}
.answer-reading {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  color: #687b69;
  white-space: nowrap;
}
.answer-reading i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8aa17a;
}
.answer-reading i.live {
  background: #82ac30;
  box-shadow: 0 0 0 4px #c5e19544;
  animation: blink 1.2s infinite;
}
.markdown {
  padding: 12px 26px 20px;
}
.reading-expanded .markdown {
  font-size: 17px;
  line-height: 1.95;
}
.answer-outline {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 17px 24px 4px;
}
.answer-outline button {
  display: flex;
  align-items: center;
  gap: 7px;
  background: #f3f5ed;
  border: 1px solid #dde5d7;
  padding: 7px 10px;
  border-radius: 7px;
  color: #55704c;
  font-size: 14px;
  transition:
    background 0.2s,
    transform 0.2s;
}
.answer-outline button:hover {
  background: #e8f2d8;
  transform: translateY(-1px);
}
.markdown :deep(h1) {
  font-family: var(--font-display);
  font-size: 30px;
  line-height: 1.4;
  color: #173e2f;
  margin: 22px 0;
}
.markdown :deep(h2) {
  position: relative;
  font-size: 24px !important;
  letter-spacing: 0 !important;
  color: #1a4936;
  margin: 29px 0 16px !important;
  padding: 0 0 12px;
  border-bottom: 1px solid #e0e8d9;
  scroll-margin-top: 25px;
}
.markdown :deep(h2)::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 42px;
  height: 3px;
  background: #b7d77c;
  border-radius: 3px;
}
.markdown :deep(h3) {
  font-size: 19px !important;
  color: #345942;
  margin: 25px 0 11px !important;
  scroll-margin-top: 25px;
}
.markdown :deep(h4) {
  font-size: 17px;
  color: #446448;
}
.markdown :deep(strong) {
  color: #244c38;
  font-weight: 680;
}
.markdown :deep(p) {
  margin: 14px 0 !important;
}
.markdown :deep(li) {
  margin: 10px 0;
  padding-left: 5px;
}
.markdown :deep(li)::marker {
  color: #789b4d;
  font-weight: 700;
}
.markdown :deep(ol) {
  list-style: none;
  counter-reset: journey-step;
  padding-left: 0 !important;
}
.markdown :deep(ol > li) {
  counter-increment: journey-step;
  position: relative;
  margin: 17px 0;
  padding: 1px 0 7px 43px;
  border-left: 1px solid #dce6d3;
  margin-left: 14px;
}
.markdown :deep(ol > li)::before {
  content: counter(journey-step, decimal-leading-zero);
  position: absolute;
  left: -15px;
  top: 0;
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  background: #edf4df;
  border: 1px solid #cdddb3;
  border-radius: 9px;
  font:
    600 12px Georgia,
    serif;
  color: #557238;
}
.markdown :deep(blockquote) {
  background: #eff4e6 !important;
  border-left: 3px solid #99b969 !important;
  border-radius: 0 12px 12px 0;
  margin: 24px 0 !important;
  padding: 6px 20px !important;
  color: #4b6546 !important;
}
.markdown :deep(.table-shell) {
  overflow-x: auto;
  border: 1px solid #dbe4d4;
  border-radius: 12px;
  margin: 22px 0;
  background: #fff;
}
.markdown :deep(table) {
  display: table !important;
  margin: 0 !important;
  min-width: 100%;
  font-size: 15px !important;
  border-collapse: collapse;
}
.markdown :deep(th) {
  background: #eaf1df;
  color: #3c5e35 !important;
  font-weight: 600 !important;
  white-space: nowrap;
}
.markdown :deep(th),
.markdown :deep(td) {
  padding: 13px 16px !important;
  min-width: 100px;
  border-bottom: 1px solid #e6ebdf !important;
}
.markdown :deep(tr:last-child td) {
  border-bottom: 0 !important;
}
.markdown :deep(tbody tr:nth-child(even)) {
  background: #f9fbf5;
}
.markdown :deep(tbody tr:hover) {
  background: #f0f6e5;
}
.markdown :deep(pre) {
  background: #173d32 !important;
  border: 1px solid #315647;
  border-radius: 13px !important;
  font-size: 16px !important;
  line-height: 1.8 !important;
  padding: 22px !important;
  box-shadow: inset 0 1px #ffffff12;
}
.markdown :deep(:not(pre) > code) {
  padding: 3px 6px;
  border-radius: 5px;
  background: #edf1e7;
  color: #426738;
  font-size: 0.9em;
}
.markdown :deep(hr) {
  height: 1px;
  border: 0;
  background: linear-gradient(90deg, #cddcc3, transparent);
  margin: 28px 0;
}
.markdown :deep(a) {
  color: #2b775c !important;
  text-decoration-color: #a6c7aa !important;
}
.answer-actions {
  display: flex;
  gap: 15px;
  justify-content: space-between;
  align-items: center;
  padding: 13px 24px;
  border-top: 1px solid #edf0e6;
  background: #fbfcf7;
}
.answer-actions .copy-button {
  margin: 0;
  padding: 5px 0;
  font-size: 14px;
}
.reading-button {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #69805e;
  font-size: 14px;
}
.stream-cursor {
  margin-left: 26px;
  margin-bottom: 20px;
}
@media (max-width: 760px) {
  .answer-header {
    padding: 15px 17px;
  }
  .answer-signature {
    font-size: 14px;
  }
  .answer-reading {
    font-size: 13px;
  }
  .markdown {
    padding: 9px 18px 17px;
  }
  .reading-expanded .markdown {
    font-size: 16px;
  }
  .answer-outline {
    padding: 13px 17px 2px;
  }
  .answer-actions {
    padding: 12px 17px;
  }
  .markdown :deep(h2) {
    font-size: 22px !important;
  }
}
/** 主回答标题不与页面导航争夺视觉焦点。 */
.markdown :deep(h2) {
  margin: 4px 0 18px;
  font-size: 22px;
  font-weight: 650;
  line-height: 1.45;
  letter-spacing: -0.5px;
}
/** 层级标题为行程与费用分段建立清晰边界。 */
.markdown :deep(h3) {
  margin: 24px 0 9px;
  font-size: 15px;
}
/** 段落之间保留阅读呼吸。 */
.markdown :deep(p) {
  margin: 10px 0;
}
/** 列表保持简洁的缩进。 */
.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 22px;
}
/** 来源链接始终带下划线，避免仅靠颜色识别。 */
.markdown :deep(a) {
  color: var(--forest);
  text-decoration: underline;
  text-underline-offset: 3px;
}
/** 引用用于呈现限制与出处，保留真实可读文字。 */
.markdown :deep(blockquote) {
  border-left: 2px solid var(--sage);
  background: var(--wash);
  margin: 18px 0;
  padding: 8px 16px;
  color: var(--muted);
}
/** 表格在窄屏横向滚动，不撑破整个聊天布局。 */
.markdown :deep(table) {
  display: block;
  overflow-x: auto;
  border-collapse: collapse;
  width: 100%;
  margin: 18px 0;
  font-size: 14px;
}
/** 表格采用行分隔而非密集网格。 */
.markdown :deep(th),
.markdown :deep(td) {
  padding: 9px 18px 9px 0;
  min-width: 110px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}
/** 表头使用淡色背景帮助扫描列名。 */
.markdown :deep(th) {
  color: var(--muted);
  font-weight: 500;
}
/** 代码块采用深色对比并允许横向滚动。 */
.markdown :deep(pre) {
  background: #19372f;
  color: #e7eee8;
  padding: 18px;
  border-radius: 10px;
  overflow-x: auto;
  font-size: 14px;
  line-height: 1.7;
}
/** 行内代码与长文本区分，但不使用高亮背景包围整段。 */
.markdown :deep(code) {
  font-family: 'Cascadia Code', Consolas, monospace;
}
/** 代码关键词使用低饱和暖色。 */
.markdown :deep(.hljs-keyword),
.markdown :deep(.hljs-attr) {
  color: #e6bd84;
}
/** 字符串高亮与森林主题保持一致。 */
.markdown :deep(.hljs-string) {
  color: #b4d1a7;
}
/** 光标强调文本仍在接收，不显示伪造的思考动画。 */
.stream-cursor {
  display: inline-block;
  width: 7px;
  height: 17px;
  background: var(--forest);
  animation: blink 1s step-end infinite;
}
/** 复制按钮保持低权重，避免抢占回答内容。 */
.copy-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 14px;
  padding: 7px 0;
  margin-top: 12px;
}
/** 光标按固定节奏闪烁，减少视觉噪声。 */
@keyframes blink {
  50% {
    opacity: 0;
  }
}
/** 尊重减少动态效果的系统偏好。 */
@media (prefers-reduced-motion: reduce) {
  .stream-cursor {
    animation: none;
  }
}
/** 结束当前组件样式。 */
</style>
