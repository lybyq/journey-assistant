<!-- 安全回答组件只负责富文本呈现、来源链接与复制。 -->
<script setup lang="ts">
/** computed 缓存净化结果，watch 将频繁文本增量合并到一帧渲染。 */
import { computed, onUnmounted, shallowRef, watch } from 'vue';
/** 复制反馈图标使用统一线性图标体系。 */
import { Check, Copy } from 'lucide-vue-next';
/** 所有 Markdown 必须通过统一净化函数后才允许使用 v-html。 */
import { renderMarkdown } from '@/features/chat/markdown';
/** 明确输入为普通字符串，组件不访问网络和模型 SDK。 */
const props = defineProps<{ content: string; streaming: boolean }>();
/** 暂存已提交渲染的文本，限制每帧最多更新一次。 */
const renderedSource = shallowRef(props.content);
/** 记录复制完成的短暂反馈。 */
const copied = shallowRef(false);
/** 剪贴板被禁用时给出可见失败提示，不假装操作成功。 */
const copyFailed = shallowRef(false);
/** 保存浏览器资源句柄，组件卸载时需要释放。 */
let frame = 0; let copyTimer: ReturnType<typeof setTimeout> | undefined;
/** 合并同一帧内收到的增量，减少 Markdown 反复重解析。 */
watch(() => props.content, () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { renderedSource.value = props.content; }); });
/** 此值已完成允许列表净化，是模板唯一允许注入的 HTML。 */
const safeHtml = computed(() => renderMarkdown(renderedSource.value));
/** 复制原始 Markdown，保留表格与链接供用户继续编辑。 */
async function copy(): Promise<void> {
  /** 剪贴板可能被权限策略禁用，需要明确给出操作结果。 */
  try { await navigator.clipboard.writeText(props.content); copied.value = true; copyFailed.value = false; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = false; }, 1800); }
  /** 失败时保留可选中文本，不伪装为复制成功。 */
  catch { copied.value = false; copyFailed.value = true; }
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
  try { const url = new URL(anchor.getAttribute('href') ?? ''); if (['http:', 'https:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer'); }
  /** 非法 URL 直接忽略，不执行外部内容。 */
  catch { return; }
/** 结束来源链接处理。 */
}
/** 释放动画帧和反馈计时器。 */
onUnmounted(() => { cancelAnimationFrame(frame); clearTimeout(copyTimer); });
/** 结束组件脚本。 */
</script>
<!-- 富文本区域保持可选中，不对每个 token 做读屏播报。 -->
<template>
  <!-- 回答主体与复制操作属于同一语义文章。 -->
  <article class="answer-body">
    <!-- safeHtml 仅来自 renderMarkdown 的允许列表净化结果。 -->
    <div class="markdown" @click="openSource" v-html="safeHtml"></div>
    <!-- 流式光标只有执行中可见，减少动态干扰。 -->
    <span v-if="streaming" class="stream-cursor" aria-label="正在接收回答"></span>
    <!-- 完成后才显示复制，避免用户误以为复制了完整回答。 -->
    <button v-else-if="content" class="copy-button" type="button" @click="copy"><Check v-if="copied" :size="14" /><Copy v-else :size="14" />{{ copied ? '已复制 Markdown' : copyFailed ? '复制失败，请选择正文复制' : '复制回答' }}</button>
  <!-- 结束回答文章。 -->
  </article>
<!-- 结束富文本模板。 -->
</template>
<!-- 富文本样式只在当前回答组件生效。 -->
<style scoped>
/** 使用可读行高和适中的文字对比，兼顾长报告阅读。 */
.markdown { color: var(--ink); font-size: 14px; line-height: 1.9; overflow-wrap: anywhere; }
/** 主回答标题不与页面导航争夺视觉焦点。 */
.markdown :deep(h2) { margin: 4px 0 18px; font-size: 22px; font-weight: 650; line-height: 1.45; letter-spacing: -.5px; }
/** 层级标题为行程与费用分段建立清晰边界。 */
.markdown :deep(h3) { margin: 24px 0 9px; font-size: 15px; }
/** 段落之间保留阅读呼吸。 */
.markdown :deep(p) { margin: 10px 0; }
/** 列表保持简洁的缩进。 */
.markdown :deep(ul), .markdown :deep(ol) { padding-left: 22px; }
/** 来源链接始终带下划线，避免仅靠颜色识别。 */
.markdown :deep(a) { color: var(--forest); text-decoration: underline; text-underline-offset: 3px; }
/** 引用用于呈现限制与出处，保留真实可读文字。 */
.markdown :deep(blockquote) { border-left: 2px solid var(--sage); background: var(--wash); margin: 18px 0; padding: 8px 16px; color: var(--muted); }
/** 表格在窄屏横向滚动，不撑破整个聊天布局。 */
.markdown :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; width: 100%; margin: 18px 0; font-size: 13px; }
/** 表格采用行分隔而非密集网格。 */
.markdown :deep(th), .markdown :deep(td) { padding: 9px 18px 9px 0; min-width: 110px; border-bottom: 1px solid var(--line); text-align: left; }
/** 表头使用淡色背景帮助扫描列名。 */
.markdown :deep(th) { color: var(--muted); font-weight: 500; }
/** 代码块采用深色对比并允许横向滚动。 */
.markdown :deep(pre) { background: #19372f; color: #e7eee8; padding: 18px; border-radius: 10px; overflow-x: auto; font-size: 12px; line-height: 1.7; }
/** 行内代码与长文本区分，但不使用高亮背景包围整段。 */
.markdown :deep(code) { font-family: 'Cascadia Code', Consolas, monospace; }
/** 代码关键词使用低饱和暖色。 */
.markdown :deep(.hljs-keyword), .markdown :deep(.hljs-attr) { color: #e6bd84; }
/** 字符串高亮与森林主题保持一致。 */
.markdown :deep(.hljs-string) { color: #b4d1a7; }
/** 光标强调文本仍在接收，不显示伪造的思考动画。 */
.stream-cursor { display: inline-block; width: 7px; height: 17px; background: var(--forest); animation: blink 1s step-end infinite; }
/** 复制按钮保持低权重，避免抢占回答内容。 */
.copy-button { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; padding: 7px 0; margin-top: 12px; }
/** 光标按固定节奏闪烁，减少视觉噪声。 */
@keyframes blink { 50% { opacity: 0; } }
/** 尊重减少动态效果的系统偏好。 */
@media (prefers-reduced-motion: reduce) { .stream-cursor { animation: none; } }
/** 结束当前组件样式。 */
</style>
