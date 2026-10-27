<!-- 对话组件只负责当前运行内容与滚动，不操纵网络和 SDK。 -->
<script setup lang="ts">
/** 在内容更新后判断是否应该跟随滚动。 */
import { nextTick, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue';
/** 用明确图标区分用户与助手。 */
import { Check, LoaderCircle, Route, UserRound } from 'lucide-vue-next';
/** 引入经过拆分的当前会话纯类型。 */
import type { ChatState } from '@/features/chat/chat-state';
/** 历史只接收通过后端归属校验的公开消息。 */
import type { PersistedMessage } from '@journey/contracts';
/** 富文本组件集中负责解析净化与复制。 */
import MarkdownAnswer from './MarkdownAnswer.vue';
/** 父组件只传入已归约的运行状态。 */
const props = defineProps<{ state: ChatState; history: PersistedMessage[]; hasMore: boolean; loadingHistory: boolean }>();
/** 翻页由父级网络服务执行，组件不直接发请求。 */
const emit = defineEmits<{ more: [] }>();
/** 使用 Vue 3.5 类型安全的模板引用。 */
const scroller = useTemplateRef<HTMLDivElement>('scroller');
/** 用户向上浏览时停止自动滚动，避免抢夺阅读位置。 */
const followBottom = shallowRef(true);
/** 合并连续增量引发的滚动任务。 */
let frame = 0;
/** 记录用户是否仍在接近滚动底部的位置。 */
function onScroll(): void { const el = scroller.value; if (el) followBottom.value = el.scrollHeight - el.clientHeight - el.scrollTop < 90; }
/** 新运行时重置滚动意图，旧回答不会影响新对话。 */
watch(() => props.state.runId, () => { followBottom.value = true; });
/** 回答与步骤更新后在下一帧滚动，只在用户仍愿意跟随时生效。 */
watch(() => [props.state.answer, props.state.progress.length, props.state.status], async () => { await nextTick(); if (!followBottom.value) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { const el = scroller.value; if (el) el.scrollTop = el.scrollHeight; }); }, { immediate: true });
/** 组件卸载时释放尚未执行的动画帧。 */
onUnmounted(() => cancelAnimationFrame(frame));
/** 结束对话组件脚本。 */
</script>
<!-- 区域本身可滚动，底部输入框始终可操作。 -->
<template>
  <!-- 不把逐 token 文本设置成 aria-live，避免读屏重复播报。 -->
  <div ref="scroller" class="thread" @scroll.passive="onScroll">
    <!-- 向上分页保持当前阅读位置，不把整个会话一次载入内存。 -->
    <button v-if="hasMore" type="button" class="history-more" :disabled="loadingHistory" @click="emit('more')">{{ loadingHistory ? '正在读取…' : '加载更早的消息' }}</button>
    <!-- 历史以真实消息ID去重，用户内容始终按普通文本转义。 -->
    <div v-for="message in history" :key="message.id" class="message saved-message"><span :class="['message-avatar', message.role === 'user' ? 'user-avatar' : 'assistant-avatar']"><UserRound v-if="message.role === 'user'" :size="15" /><Route v-else :size="18" /></span><div class="assistant-content"><div class="message-meta">{{ message.role === 'user' ? '你' : '行也' }}<span>已保存 · {{ new Date(message.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}{{ message.role === 'assistant' ? ` · ${message.status === 'completed' ? '已完成' : message.status === 'cancelled' ? '已停止' : message.status === 'failed' ? '未完成' : '运行中'}` : '' }}</span></div><p v-if="message.role === 'user'" class="question">{{ message.content }}</p><MarkdownAnswer v-else :content="message.content || '本轮未产生正文。'" :streaming="false" /></div></div>
    <!-- 用户原文使用插值转义，不能被当成 HTML 执行。 -->
    <div v-if="state.runId" class="message user-message"><span class="message-avatar user-avatar"><UserRound :size="15" /></span><div><div class="message-meta">你<span>当前对话 · 已保存</span></div><p class="question">{{ state.question }}</p></div></div>
    <!-- 助手回答标明本次是框架验证。 -->
    <div v-if="state.runId" class="message assistant-message"><span class="message-avatar assistant-avatar"><Route :size="18" /></span><div class="assistant-content"><div class="message-meta">行也<span>持久化系统自检</span></div><div v-if="state.progress.length" class="progress-summary"><LoaderCircle v-if="state.status === 'running'" :size="13" class="spin" /><Check v-else :size="13" /><span>{{ state.progress.at(-1)?.title }}</span><small>{{ state.status === 'running' ? '进行中' : state.status === 'cancelled' ? '已停止' : state.status === 'failed' ? '未完成' : '已完成' }}</small></div><MarkdownAnswer :content="state.answer" :streaming="state.status === 'running'" /><p v-if="state.error" class="run-error" role="alert">{{ state.error }}</p><p v-if="state.status === 'cancelled'" class="cancelled-note" role="status">已停止，已接收的内容已保留。</p></div></div>
    <!-- 只播报运行终态，辅助技术不被文本增量淹没。 -->
    <span class="sr-only" role="status" aria-live="polite">{{ state.status === 'completed' ? '本次框架自检完成' : state.status === 'cancelled' ? '运行已停止' : '' }}</span>
  <!-- 结束对话滚动区域。 -->
  </div>
<!-- 结束对话模板。 -->
</template>
<!-- 对话使用自然段落布局，避免在每句话外面套卡片。 -->
<style scoped>
/** 相对定位把读屏状态限制在消息滚动容器内，长历史不会撑出外层页面。 */
.thread { position: relative; flex: 1; min-height: 0; overflow-y: auto; padding: 12px 2px 30px; scrollbar-width: thin; scrollbar-color: #cdd8ca transparent; }
/** 更早消息采用轻量入口，保持正文为主要阅读平面。 */
.history-more { display: block; margin: 0 auto 24px; padding: 9px 18px; border: 1px solid var(--line); border-radius: 18px; color: var(--forest); font-size: 11px; }
/** 图标与正文之间保留适中间距。 */
.message { display: flex; gap: 14px; max-width: 760px; margin: 0 auto 35px; }
/** 固定头像尺寸避免文本增量导致布局抖动。 */
.message-avatar { display: grid; place-items: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; }
/** 用户符号采用中性背景。 */
.user-avatar { color: #738069; background: #e7ebdf; }
/** 助手符号使用品牌色。 */
.assistant-avatar { background: var(--forest); color: #fff; border-radius: 9px; }
/** 姓名和模式标注自然排列。 */
.message-meta { display: flex; align-items: center; gap: 12px; font-size: 12px; font-weight: 600; margin: 6px 0 13px; }
/** 模式说明降低对比但保持可见。 */
.message-meta > span { font-size: 10px; color: var(--muted); font-weight: 400; }
/** 问题文本保留换行并自动断词。 */
.question { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; font-size: 13px; margin: 0; }
/** 正文容器最小宽度归零，使表格能在内部滚动。 */
.assistant-content { flex: 1; min-width: 0; }
/** 步骤摘要是可验证的执行状态，不显示模型内部推理。 */
.progress-summary { display: flex; align-items: center; gap: 7px; margin: 6px 0 21px; color: #60785b; font-size: 11px; }
/** 次要执行状态与步骤名称分开显示。 */
.progress-summary small { margin-left: 5px; color: #8d9784; font-size: 9px; }
/** 错误文字配合 role=alert 保证失败可见。 */
.run-error { color: #9a4d35; line-height: 1.7; font-size: 12px; }
/** 取消提示保留用户已获得的内容。 */
.cancelled-note { font-size: 12px; color: var(--muted); margin-top: 18px; }
/** 手机适当缩小正文缩进。 */
@media (max-width: 760px) { .message { gap: 10px; } .message-avatar { width: 26px; height: 26px; } .question { font-size: 14px; } }
/** 结束对话样式。 */
</style>
