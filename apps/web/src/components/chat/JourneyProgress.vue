<!-- 真实待办和工具记录组成可展开的执行时间线。 -->
<script setup lang="ts">
/** 展开意图只影响本条回答，完成数量由事件派生。 */
import { computed, shallowRef } from 'vue';
/** 图标仅表示真实运行状态，不使用模拟进度。 */
import { Check, ChevronDown, LoaderCircle, Route, Wrench } from 'lucide-vue-next';
/** 直接复用已验证的计划和工具关联结构。 */
import type { ChatState } from '@/features/chat/chat-state';
/** 展示层不调用模型，也不显示内部推理。 */
const props = defineProps<{ state: ChatState }>();
const expanded = shallowRef(false);
/** 完成数只统计真实completed待办。 */
const done = computed(() => props.state.plan.filter((item) => item.status === 'completed').length);
/** 原始参数和结果只以转义文本展示。 */
const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? '等待工具返回';
</script>
<template>
  <section
    v-if="state.plan.length || state.tools.length || state.status === 'running'"
    class="journey-progress"
  >
    <button
      class="progress-toggle"
      type="button"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="progress-icon">
        <LoaderCircle v-if="state.status === 'running'" :size="18" class="spin" />
        <Check v-else :size="18" />
      </span>
      <span>
        <strong>{{ state.status === 'running' ? '正在安排这一程' : '这一程，如何完成' }}</strong>
        <small>
          {{ state.plan.length ? `${done}/${state.plan.length} 项计划完成` : '执行记录' }} ·
          {{ state.tools.length }} 次工具调用
        </small>
      </span>
      <ChevronDown :size="17" :class="{ rotated: expanded }" />
    </button>
    <div v-if="expanded" class="progress-details">
      <ol v-if="state.plan.length" class="journey-plan">
        <li v-for="(item, index) in state.plan" :key="index" :class="item.status">
          <span>
            <Check v-if="item.status === 'completed'" :size="13" />
            <LoaderCircle v-else-if="item.status === 'in_progress'" class="spin" :size="13" />
            <Route v-else :size="13" />
          </span>
          <p>{{ item.content }}</p>
          <small>
            {{
              item.status === 'completed'
                ? '完成'
                : item.status === 'in_progress'
                  ? '进行中'
                  : '待处理'
            }}
          </small>
        </li>
      </ol>
      <details v-for="entry in state.tools" :key="entry.callId" class="inline-tool">
        <summary>
          <Wrench :size="13" />
          <code>{{ entry.name }}</code>
          <small>
            {{
              entry.status === 'completed'
                ? '已完成'
                : entry.status === 'failed'
                  ? '失败'
                  : entry.status === 'interrupted'
                    ? '已中断'
                    : '执行中'
            }}
          </small>
        </summary>
        <p>调用参数</p>
        <pre>{{ pretty(entry.input) }}</pre>
        <p>返回结果</p>
        <pre>{{ pretty(entry.output) }}</pre>
      </details>
      <p class="public-note">这里只展示公开计划与实际工具记录。</p>
    </div>
  </section>
</template>
<style scoped>
/** 计划使用真实状态，时间轴保留可见文字与图标两种提示。 */
.journey-progress {
  border: 1px solid #d6e3cc;
  border-radius: 16px;
  background: linear-gradient(120deg, #edf4df, #f8faf3);
  margin: 0 0 19px;
  overflow: hidden;
}
.progress-toggle {
  display: flex;
  gap: 13px;
  align-items: center;
  padding: 17px 20px;
  width: 100%;
  text-align: left;
}
.progress-icon {
  width: 37px;
  height: 37px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #234e3a;
  color: #d4eb9e;
  box-shadow: 0 4px 12px #20452e15;
}
.progress-toggle > span:nth-child(2) {
  display: flex;
  flex: 1;
  gap: 5px;
  flex-direction: column;
}
.progress-toggle strong {
  font-size: 15px;
  color: #294e37;
  font-weight: 600;
}
.progress-toggle small {
  font-size: 14px;
  color: #738367;
}
.progress-toggle > svg {
  color: #768b65;
  transition: transform 0.2s;
}
.rotated {
  transform: rotate(180deg);
}
.progress-details {
  padding: 0 22px 18px;
}
.journey-plan {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
}
.journey-plan li {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 0;
}
.journey-plan li > span {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #e1e8d8;
  color: #8b9b7e;
}
.journey-plan li.completed > span {
  background: #416b45;
  color: #fff;
}
.journey-plan li.in_progress > span {
  background: #c8e28c;
  color: #244a32;
}
.journey-plan p {
  flex: 1;
  font-size: 16px;
  line-height: 1.7;
  margin: 0;
  color: #49613e;
}
.journey-plan small {
  font-size: 14px;
  color: #7d8e6e;
}
.inline-tool {
  border-top: 1px solid #dae4cd;
  padding: 12px 0;
  font-size: 14px;
}
.inline-tool summary {
  cursor: pointer;
  display: flex;
  gap: 9px;
  align-items: center;
  color: #496441;
}
.inline-tool code {
  font-size: 14px;
  flex: 1;
  overflow-wrap: anywhere;
}
.inline-tool small {
  color: #80916d;
  font-size: 14px;
}
.inline-tool pre {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow: auto;
  background: #173d32;
  color: #d6e6d0;
  border-radius: 8px;
  padding: 14px;
  font-size: 14px;
  line-height: 1.8;
}
.inline-tool p,
.public-note {
  font-size: 14px;
  color: #809070;
}
.public-note {
  margin: 15px 0 0;
}
</style>
