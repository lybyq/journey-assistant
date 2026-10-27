<!-- 执行面板只展示真实公开事件和工具结果。 -->
<script setup lang="ts">
/** 只为派生展示值使用 computed。 */
import { computed } from 'vue';
/** 图标表达步骤、工具和结果状态。 */
import { Activity, ArrowDownToLine, Check, ChevronDown, CircleDashed, Code2, ExternalLink, LoaderCircle, ShieldCheck, X } from 'lucide-vue-next';
/** 共享健康结构只包含公开集成信息。 */
import type { HealthSnapshot } from '@journey/contracts';
/** 工具轨迹使用纯逻辑层统一类型。 */
import type { ChatState } from '@/features/chat/chat-state';
/** 面板由页面传入数据，不直接订阅第二个网络连接。 */
const props = defineProps<{ state: ChatState; health: HealthSnapshot | null; mobileOpen: boolean }>();
/** 移动端关闭意图交给父页面管理。 */
const emit = defineEmits<{ close: [] }>();
/** 只有真实工具完成后才累计完成数。 */
const completedCount = computed(() => props.state.tools.filter((tool) => tool.status === 'completed').length);
/** 原始参数和结果只以转义的纯文本 JSON 展示。 */
function pretty(value: unknown): string { return JSON.stringify(value, null, 2) ?? '暂无返回值'; }
/** 结束执行面板脚本。 */
</script>
<!-- 桌面保持可见，移动端通过真正的按钮展开。 -->
<template>
  <!-- 次要检查区与主要对话形成清晰空间层级。 -->
  <aside :class="['execution-panel', { 'mobile-open': mobileOpen }]" aria-label="执行轨迹与工具结果">
    <!-- 面板标题同时显示当前可核验的运行状态。 -->
    <header class="execution-header"><div><Activity :size="16" /><strong>执行轨迹</strong></div><span class="live-label"><i></i>可追溯</span><button class="mobile-close" type="button" aria-label="关闭执行轨迹" @click="emit('close')"><X :size="18" /></button></header>
    <!-- 说明面板内容是执行摘要，避免将其当作模型内部推理。 -->
    <p class="panel-description">查看步骤摘要、工具调用与返回结果。</p>
    <!-- 没有运行时显示真实空态，不填充伪造工具步骤。 -->
    <div v-if="state.status === 'idle'" class="trace-empty"><div class="empty-orbit"><Activity :size="21" /></div><strong>每一步，都有依据</strong><p>发送消息后，执行进度<br />和真实工具结果会出现在这里。</p><span>当前开放框架自检</span></div>
    <!-- 只要有实际运行，就逐项展示真实事件。 -->
    <div v-else class="trace-content">
      <!-- 当前运行概览不使用假百分比。 -->
      <div class="run-status"><LoaderCircle v-if="state.status === 'running'" class="spin" :size="16" /><Check v-else-if="state.status === 'completed'" :size="16" /><CircleDashed v-else :size="16" /><span>{{ state.status === 'running' ? '运行进行中' : state.status === 'completed' ? '运行已完成' : state.status === 'cancelled' ? '运行已停止' : '运行未完成' }}</span><small>{{ completedCount }} 次工具完成</small></div>
      <!-- 步骤只来自后端公开的 progress 事件。 -->
      <ol class="steps"><li v-for="(step, index) in state.progress" :key="`${state.runId}-${index}`"><span class="step-index">{{ String(index + 1).padStart(2, '0') }}</span><div><strong>{{ step.title }}</strong><p>{{ step.detail }}</p></div></li></ol>
      <!-- 每个工具调用独立折叠，不把大量 JSON 直接塞进回答。 -->
      <details v-for="tool in state.tools" :key="tool.callId" class="tool-detail" open><summary><Code2 :size="14" /><span>{{ tool.name }}</span><Check v-if="tool.status === 'completed'" :size="13" /><LoaderCircle v-else-if="tool.status === 'running'" :size="13" class="spin" /><small>{{ tool.durationMs !== undefined ? `${tool.durationMs.toFixed(1)} ms` : tool.status === 'interrupted' ? '中断' : '执行中' }}</small><ChevronDown class="chevron" :size="13" /></summary><div class="tool-body"><span class="json-label">调用参数</span><pre>{{ pretty(tool.input) }}</pre><span class="json-label"><ArrowDownToLine :size="11" />返回结果</span><pre>{{ pretty(tool.output) }}</pre></div></details>
    <!-- 结束真实轨迹区域。 -->
    </div>
    <!-- 集成状态与执行记录分开，配置就绪不等于工具已调用。 -->
    <div class="integration-block"><div class="integration-heading"><span>数据与工具</span><ShieldCheck :size="13" /></div><div v-for="integration in health?.integrations ?? []" :key="integration.id" class="integration-row"><span class="integration-icon">{{ integration.label.slice(0, 1) }}</span><span>{{ integration.label }}</span><small>{{ integration.connected ? '已验证连接' : integration.configured ? '已配置 · 待验证' : '待接入' }}</small><i :class="{ ready: integration.connected }"></i></div><p v-if="!health" class="health-unavailable">健康状态尚未获取</p><div class="evidence-note"><ExternalLink :size="12" /><span>后续价格与来源将在这里关联展示。</span></div></div>
  <!-- 结束执行检查区。 -->
  </aside>
<!-- 结束执行模板。 -->
</template>
<!-- 次要信息使用更紧凑的排版，保持主回答的阅读空间。 -->
<style scoped>
/** 面板自然滚动，不遮盖主工作区输入。 */
.execution-panel { width: 310px; flex-shrink: 0; border-left: 1px solid var(--line); background: #f8f9f3; padding: 31px 23px 23px; overflow-y: auto; scrollbar-width: thin; }
/** 标题与可追溯标识分置两端。 */
.execution-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
/** 标题图标与文字保持自然基线。 */
.execution-header > div { display: flex; align-items: center; gap: 8px; color: var(--forest); }
/** 面板标题不使用过大的字重。 */
.execution-header strong { font-size: 12px; font-weight: 600; }
/** 可追溯只表示轨迹功能，不冒充网络在线。 */
.live-label { display: flex; align-items: center; gap: 5px; font-size: 9px; color: #7e8c75; }
/** 低权重状态点使用静态颜色。 */
.live-label i { width: 4px; height: 4px; border-radius: 50%; background: #91a580; }
/** 区域说明控制为短句。 */
.panel-description { color: #87907f; font-size: 10px; margin: 15px 0 0; line-height: 1.7; }
/** 轨迹空态使用留白强调等待状态。 */
.trace-empty { text-align: center; padding: 58px 0 53px; }
/** 中心符号属于执行状态，不伪装为正在思考。 */
.empty-orbit { width: 57px; height: 57px; border-radius: 50%; border: 1px dashed #cbd7c1; display: grid; place-items: center; color: #88a174; margin: 0 auto 21px; background: #f1f4eb; }
/** 空态标题保持克制。 */
.trace-empty strong { font-size: 12px; font-weight: 500; color: #5e7054; }
/** 空态说明不给出虚构执行步骤。 */
.trace-empty p { color: #929a88; font-size: 10px; line-height: 1.9; margin: 11px 0 19px; }
/** 明确当前可使用范围。 */
.trace-empty > span { color: #8b967f; font-size: 9px; background: #edf1e4; padding: 5px 9px; border-radius: 4px; }
/** 已运行区域有清晰的起始间距。 */
.trace-content { padding-top: 27px; }
/** 运行状态始终用文字描述，颜色只是辅助。 */
.run-status { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--forest); }
/** 工具完成次数来自真实结果统计。 */
.run-status small { margin-left: auto; font-size: 8px; color: #87937a; }
/** 使用有序列表表达公开执行顺序。 */
.steps { list-style: none; padding: 0; margin: 26px 0 22px; }
/** 每个步骤的序号与说明对齐。 */
.steps li { display: flex; gap: 12px; }
/** 序号比动态装饰更便于定位步骤。 */
.step-index { font-size: 9px; color: #879a76; border-left: 1px solid #dce3d2; padding-left: 9px; padding-top: 2px; }
/** 步骤名称使用统一字重。 */
.steps strong { font-size: 11px; color: #52674a; font-weight: 500; }
/** 详细说明不展示隐藏推理，只展示服务报告的步骤。 */
.steps p { font-size: 10px; color: #87917c; line-height: 1.85; margin: 8px 0 0; }
/** 工具详情是明确可折叠的交互面板，因此保留细边框。 */
.tool-detail { border: 1px solid #dce3d4; border-radius: 8px; margin-bottom: 13px; overflow: hidden; }
/** 原生 summary 提供键盘展开与折叠支持。 */
.tool-detail summary { list-style: none; display: flex; align-items: center; gap: 6px; padding: 11px 10px; color: var(--forest); cursor: pointer; }
/** 隐藏浏览器默认小三角，使用统一的方向图标。 */
.tool-detail summary::-webkit-details-marker { display: none; }
/** 工具名称按代码标识展示，超长名称可以安全换行。 */
.tool-detail summary > span { font-family: 'Cascadia Code', Consolas, monospace; font-size: 10px; overflow-wrap: anywhere; }
/** 耗时以等宽数字对齐。 */
.tool-detail summary small { margin-left: auto; font-size: 8px; white-space: nowrap; color: #819074; font-variant-numeric: tabular-nums; }
/** 折叠箭头反映当前状态。 */
.tool-detail[open] .chevron { transform: rotate(180deg); }
/** 工具参数与结果位于同一安全纯文本区域。 */
.tool-body { padding: 0 10px 10px; }
/** JSON 标签既有图标也有文字。 */
.json-label { display: flex; align-items: center; gap: 5px; font-size: 9px; color: #87937a; margin: 10px 0 6px; }
/** 结果采用有限高度和内部滚动，避免把执行面板无限撑长。 */
pre { padding: 10px; margin: 0; background: #edf1e7; color: #51684d; border-radius: 5px; overflow: auto; max-height: 250px; font: 9px/1.8 'Cascadia Code', Consolas, monospace; tab-size: 2; }
/** 集成状态通过分隔线与执行记录区分。 */
.integration-block { border-top: 1px solid var(--line); padding-top: 21px; }
/** 集成标题对齐安全提示图标。 */
.integration-heading { display: flex; justify-content: space-between; font-size: 10px; color: #7b896f; margin-bottom: 13px; }
/** 供应商以清晰行结构呈现，不使用假在线卡片。 */
.integration-row { display: flex; align-items: center; gap: 9px; padding: 10px 0; font-size: 10px; color: #5b6b53; }
/** 文本标识避免加载未经授权的供应商品牌图。 */
.integration-icon { display: grid; place-items: center; width: 23px; height: 23px; border-radius: 6px; background: #e8eddf; color: #7c8f6b; font-size: 9px; }
/** 未验证状态明确使用文字。 */
.integration-row small { margin-left: auto; color: #89937d; font-size: 8px; }
/** 默认圆点为中性灰，只有真实连接成功才转绿。 */
.integration-row i { width: 4px; height: 4px; border-radius: 50%; background: #bcc4b2; }
/** 预留真实连接成功后的颜色规则。 */
.integration-row i.ready { background: #4a8a5b; }
/** 来源区说明后续展示位置，不填充不存在的价格证据。 */
.evidence-note { display: flex; gap: 7px; margin-top: 22px; padding-top: 15px; border-top: 1px dashed #dce3d4; color: #8b957f; font-size: 9px; line-height: 1.8; }
/** 健康接口失败时保持明确文本空态。 */
.health-unavailable { font-size: 10px; color: var(--muted); }
/** 桌面不显示移动端关闭动作。 */
.mobile-close { display: none; }
/** 中屏适当压缩侧面板。 */
@media (max-width: 1350px) { .execution-panel { width: 275px; padding: 29px 18px 20px; } }
/** 窄屏面板作为固定检查层，由有名称的按钮打开与关闭。 */
@media (max-width: 1050px) { .execution-panel { display: none; } .execution-panel.mobile-open { display: block; position: fixed; right: 0; top: 0; bottom: 0; z-index: 30; width: min(350px, 90vw); box-shadow: -20px 0 60px #10251d22; } .mobile-close { display: grid; place-items: center; width: 32px; height: 32px; } }
/** 结束执行面板样式。 */
</style>
