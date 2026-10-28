<!-- 输入组件负责草稿、输入法处理和提交操作，不持有网络连接。 -->
<script setup lang="ts">
/** 浅层状态适合保存当前选择的出行偏好。 */
import { computed, shallowRef, watch } from "vue";
/** 读取基础旅行偏好的共享类型，不复制另一份出行方式枚举。 */
import type { TravelerProfile } from '@journey/contracts';
/** 统一使用线性图标表现发送与停止。 */
import {
  ArrowUp,
  CarFront,
  Compass,
  Square,
  UsersRound,
} from "lucide-vue-next";
/** 使用显式 v-model 将草稿与父页面同步，示例选择也能更新此输入框。 */
const draft = defineModel<string>({ required: true });
/** 连接状态由父级传入，组件不能自行假定服务在线。 */
const props = defineProps<{ busy: boolean; connected: boolean; pending?: boolean; preferredMode?: TravelerProfile['preferredMode'] }>();
/** 明确声明提交与停止意图。 */
const emit = defineEmits<{ submit: [message: string]; cancel: [] }>();
/** 偏好只作为输入附加信息，真实约束解析属于第六模块。 */
const mode = shallowRef("自由行");
/** 登录或保存偏好时将账户默认方式同步到输入区，用户仍可临时切换。 */
watch(() => props.preferredMode, (value) => { mode.value = value === 'driving' ? '自驾游' : value === 'group' ? '跟团游' : '自由行'; }, { immediate: true });
/** 静态选项不使用不必要的响应式代理。 */
const modes = [
  { name: "自由行", icon: Compass },
  { name: "自驾游", icon: CarFront },
  { name: "跟团游", icon: UsersRound },
] as const;
/** 从草稿与连接状态推导是否可发送。 */
const sendable = computed(
  () =>
    props.connected &&
    !props.busy &&
    draft.value.trim().length > 0 &&
    draft.value.length <= 1800,
);
/** 发送时附带偏好，输入内容仍保留直到用户主动新建对话。 */
function submit(): void {
  if (sendable.value)
    emit("submit", `出行偏好：${mode.value}。${draft.value.trim()}`);
}
/** Enter 发送，Shift+Enter 换行；中文输入法确认候选时不能误发送。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}
/** 结束输入脚本。 */
</script>
<!-- 表单提供键盘与按钮一致的提交行为。 -->
<template>
  <!-- 输入区域固定在工作区底部，但不遮挡聊天滚动内容。 -->
  <div class="composer-wrap">
    <!-- 主输入表单仅有一个主要动作。 -->
    <form class="composer" @submit.prevent="submit">
      <!-- 真实可用的偏好选择，按下状态对辅助技术可见。 -->
      <div class="mode-list" aria-label="出行偏好">
        <button
          v-for="item in modes"
          :key="item.name"
          type="button"
          :class="['mode', { selected: mode === item.name }]"
          :aria-pressed="mode === item.name"
          :disabled="busy"
          @click="mode = item.name"
        >
          <component :is="item.icon" :size="13" />{{ item.name }}</button
        ><span class="input-limit">{{ draft.length }} / 1800</span>
      </div>
      <!-- textarea 带可访问标签，最多1800字，为传输附加信息留出空间。 -->
      <textarea
        v-model="draft"
        aria-label="描述你的旅行需求"
        placeholder="想去哪里、和谁一起、预算多少？把你的旅行想法告诉我…"
        :disabled="busy"
        maxlength="1800"
        rows="2"
        @keydown="onKeydown"
      ></textarea>
      <!-- 底部明确当前运行范围，避免框架诊断被误认作真实报价。 -->
      <div class="composer-actions">
        <span>04 智能体 · 05 MCP 工具</span
        ><button
          v-if="busy"
          type="button"
          class="send-button stop"
          aria-label="停止当前运行"
          :disabled="pending"
          @click="emit('cancel')"
        >
          <Square :size="13" fill="currentColor" /></button
        ><button
          v-else
          type="submit"
          class="send-button"
          :disabled="!sendable"
          aria-label="发送并保存本轮对话"
        >
          <ArrowUp :size="19" />
        </button>
      </div>
      <!-- 结束主输入表单。 -->
    </form>
    <!-- 不把估算包装成实时交易价格，底座阶段也明确说明。 -->
    <p class="composer-footnote">
      报价以工具证据为准；缺失数据会明确说明。Enter 发送，Shift + Enter 换行。
    </p>
    <!-- 结束输入区域。 -->
  </div>
  <!-- 结束输入模板。 -->
</template>
<!-- 输入框使用焦点光环和细微位移，突出交互而非装饰。 -->
<style scoped>
/** 输入区域使用与内容相同的最大宽度。 */
.composer-wrap {
  max-width: 760px;
  width: 100%;
  margin: auto;
}
/** 自然投影区分输入平面，焦点时强调边界。 */
.composer {
  border: 1px solid #d9dfd4;
  border-radius: 13px;
  background: #fff;
  padding: 13px 15px 11px;
  box-shadow: 0 4px 23px #213b2910;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
/** focus-within 覆盖输入、模式与发送按钮的键盘焦点。 */
.composer:focus-within {
  border-color: #8aab96;
  box-shadow:
    0 4px 24px #213b2919,
    0 0 0 3px #b1c6b21f;
}
/** 模式选项使用水平排列，保留输入空间。 */
.mode-list {
  display: flex;
  align-items: center;
  gap: 4px;
}
/** 偏好按钮拥有足够内边距但不引入醒目的药丸堆叠。 */
.mode {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  padding: 7px 9px;
  border-radius: 5px;
  color: #7b8577;
}
/** 选中偏好使用单一绿色强调。 */
.mode.selected {
  background: var(--wash);
  color: var(--forest);
}
/** 字数提示靠右，避免与输入内容混淆。 */
.input-limit {
  margin-left: auto;
  font-size: 9px;
  color: #899182;
  font-variant-numeric: tabular-nums;
}
/** 原生多行输入便于未来移动端适配，不依赖 contenteditable。 */
textarea {
  display: block;
  width: 100%;
  resize: vertical;
  border: 0;
  background: transparent;
  min-height: 57px;
  max-height: 150px;
  padding: 14px 3px 3px;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  line-height: 1.8;
  outline: none;
}
/** 占位文字对比适中，必要标签由 aria-label 提供。 */
textarea::placeholder {
  color: #8b9486;
}
/** 状态与发送按钮位于独立底栏。 */
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 3px;
}
/** 明确说明运行范围，字号不低于辅助信息标准。 */
.composer-actions > span {
  color: #7c8875;
  font-size: 10px;
}
/** 主要动作保持大于图标的命中范围。 */
.send-button {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: var(--forest);
  color: #fff;
  transition:
    background 0.2s,
    transform 0.15s;
}
/** 可用发送按钮悬停时略微提亮。 */
.send-button:hover:not(:disabled) {
  background: #2a5948;
  transform: translateY(-1px);
}
/** 禁用状态不再使用错误的在线绿色。 */
.send-button:disabled {
  opacity: 1;
  background: #dce3d8;
  color: #899783;
  cursor: not-allowed;
}
/** 停止与发送共用位置，避免运行时布局跳动。 */
.stop {
  background: #526859;
}
/** 页脚说明不增加额外面板。 */
.composer-footnote {
  font-size: 9px;
  color: #92988a;
  text-align: center;
  margin: 12px 0 0;
  line-height: 1.6;
}
/** 手机维持可触达发送尺寸并略增输入字号。 */
@media (max-width: 760px) {
  textarea {
    font-size: 14px;
    min-height: 64px;
  }
  .mode {
    padding: 8px;
    font-size: 11px;
  }
  .send-button {
    width: 42px;
    height: 42px;
  }
  .composer-footnote {
    font-size: 9px;
    margin-bottom: 4px;
  }
}
/** 减少动态偏好时去掉装饰过渡。 */
@media (prefers-reduced-motion: reduce) {
  .composer,
  .send-button {
    transition: none;
  }
}
/** 结束输入样式。 */
</style>
