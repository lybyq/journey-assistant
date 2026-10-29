<!-- 会话列表提供真实数据库元数据的选择、改名与可恢复归档。 -->
<script setup lang="ts">
/** 编辑状态仅在本列表保存，不污染聊天输入。 */
import { shallowRef } from 'vue';
/** 图标按钮全部有可访问操作名称。 */
import { Archive, Check, MessageSquare, Pencil, X } from 'lucide-vue-next';
/** 会话结构来自服务端共同校验的协议。 */
import type { Conversation } from '@journey/contracts';
/** 列表只消费公开会话，不访问凭据和网络。 */
defineProps<{
  items: Conversation[];
  selectedId: string | null;
  busy: boolean;
  hasMore: boolean;
}>();
/** 用户操作由父组件绑定持久化服务。 */
const emit = defineEmits<{
  select: [id: string];
  rename: [id: string, title: string];
  archive: [id: string];
  more: [];
}>();
/** 改名草稿需要单独确认，避免每次按键都写数据库。 */
const editingId = shallowRef<string | null>(null);
const title = shallowRef('');
/** 提交合法名称后关闭编辑区；网络错误由父级显示。 */
function rename(id: string): void {
  if (!title.value.trim()) return;
  emit('rename', id, title.value.trim());
  editingId.value = null;
}
/** 结束会话列表脚本。 */
</script>
<!-- 原生列表表达真正的已保存会话。 -->
<template>
  <!-- 导航区域在桌面侧栏与手机都可使用。 -->
  <div class="conversation-list">
    <!-- 没有历史时不插入虚构旅行记录。 -->
    <p v-if="!items.length" class="empty-history">
      还没有保存的会话，
      <br />
      点击“新建对话”开始。
    </p>
    <!-- 每个会话使用稳定UUID作为key。 -->
    <div
      v-for="item in items"
      :key="item.id"
      :class="['conversation-row', { selected: item.id === selectedId }]"
    >
      <!-- 改名是显式确认的内联表单。 -->
      <form v-if="editingId === item.id" class="rename-form" @submit.prevent="rename(item.id)">
        <input v-model="title" maxlength="80" required aria-label="新的会话名称" />
        <button type="submit" aria-label="保存会话名称" :disabled="busy">
          <Check :size="13" />
        </button>
        <button type="button" aria-label="取消改名" @click="editingId = null">
          <X :size="13" />
        </button>
      </form>
      <!-- 选择、改名与归档为独立按钮，避免嵌套按钮结构。 -->
      <template v-else>
        <button
          type="button"
          class="conversation-select"
          :disabled="busy"
          :aria-current="item.id === selectedId ? 'true' : undefined"
          @click="emit('select', item.id)"
        >
          <MessageSquare :size="12" />
          <span>{{ item.title }}</span>
        </button>
        <button
          class="row-action"
          type="button"
          :disabled="busy"
          :aria-label="`重命名${item.title}`"
          @click="
            editingId = item.id;
            title = item.title;
          "
        >
          <Pencil :size="11" />
        </button>
        <button
          class="row-action"
          type="button"
          :disabled="busy"
          :aria-label="`归档${item.title}`"
          @click="emit('archive', item.id)"
        >
          <Archive :size="11" />
        </button>
      </template>
      <!-- 结束单会话行。 -->
    </div>
    <!-- 有真实下一页游标时才显示加载按钮。 -->
    <button v-if="hasMore" type="button" class="more" :disabled="busy" @click="emit('more')">
      加载更多会话
    </button>
    <!-- 结束持久化会话列表。 -->
  </div>
  <!-- 结束会话列表模板。 -->
</template>
<!-- 侧栏列表保持紧凑，但按钮可通过键盘访问。 -->
<style scoped>
/** 列表设定最大高度，避免挤走账户入口。 */
.conversation-list {
  max-height: 260px;
  overflow-y: auto;
  scrollbar-width: thin;
  margin-top: 12px;
}
/** 空态明确说明新建行为。 */
.empty-history {
  font-size: 13px;
  color: #87907e;
  line-height: 1.8;
}
/** 一行内区分选择与资源操作。 */
.conversation-row {
  display: flex;
  align-items: center;
  gap: 3px;
  border-radius: 5px;
  padding: 3px 2px;
}
/** 当前会话同时有文字选中语义和淡色底。 */
.conversation-row.selected {
  background: #dfe7d7;
}
/** 长会话名称只在文本内部省略，不撑开侧栏。 */
.conversation-select {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  padding: 9px 3px;
  text-align: left;
  font-size: 13px;
  color: #617359;
}
/** 名称保留title以外的真实文字与辅助技术可读性。 */
.conversation-select span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/** 行操作保留独立触达尺寸，不只在hover时出现。 */
.row-action {
  width: 24px;
  height: 30px;
  display: grid;
  place-items: center;
  color: #839277;
}
/** 内联编辑保持一个可提交表单。 */
.rename-form {
  display: flex;
  gap: 5px;
  align-items: center;
  width: 100%;
  padding: 5px 0;
}
/** 输入宽度随侧栏收缩。 */
.rename-form input {
  width: 0;
  flex: 1;
  border: 1px solid #bfcfb5;
  border-radius: 4px;
  padding: 7px;
  font-size: 13px;
  outline: none;
}
/** 提交与取消按钮均有可用点击面积。 */
.rename-form button {
  min-width: 25px;
  min-height: 30px;
  color: var(--forest);
}
/** 分页动作不显示虚构历史数量。 */
.more {
  font-size: 13px;
  color: var(--forest);
  padding: 10px 3px;
}
/** 手机会话列表限制为适合顶部展开的高度。 */
@media (max-width: 760px) {
  .conversation-list {
    max-height: 170px;
  }
  .conversation-select {
    font-size: 14px;
  }
  .row-action {
    width: 34px;
    height: 34px;
  }
}
/** 结束会话列表样式。 */
</style>
