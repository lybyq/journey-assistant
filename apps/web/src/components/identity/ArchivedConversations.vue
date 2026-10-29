<!-- 归档列表作为独立账户功能，恢复不会删除或重建原会话。 -->
<script setup lang="ts">
/** 原生折叠区域按需加载，不在首页增加额外请求。 */
import { shallowRef } from 'vue';
/** 恢复操作使用明确图标和文字。 */
import { ArchiveRestore, LoaderCircle } from 'lucide-vue-next';
/** 所有归档响应都需要通过共享schema。 */
import { conversationListSchema, type Conversation } from '@journey/contracts';
/** 复用统一的自动续期和访问令牌处理。 */
import { authenticatedRequest } from '@/services/http-client';
/** 恢复后同步当前用户的活动会话列表。 */
import { useIdentityStore } from '@/stores/identity';
/** 本组件只保存当前已展示的归档页。 */
const items = shallowRef<Conversation[]>([]);
const cursor = shallowRef<string | null>(null);
const busy = shallowRef(false);
const loaded = shallowRef(false);
const error = shallowRef('');
const identity = useIdentityStore();
/** 归档列表使用服务端分页，不猜测当前用户的归档总数。 */
async function load(more = false): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = conversationListSchema.parse(
      await authenticatedRequest(
        `/conversations?archived=true${more && cursor.value ? `&cursor=${cursor.value}` : ''}`,
      ),
    );
    items.value = more ? [...items.value, ...result.items] : result.items;
    cursor.value = result.nextCursor;
    loaded.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取归档失败';
  } finally {
    busy.value = false;
  }
}
/** 恢复保留原始ID、创建时间和资源归属。 */
async function restore(id: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await identity.updateConversation(id, { archived: false });
    items.value = items.value.filter((item) => item.id !== id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '恢复失败';
  } finally {
    busy.value = false;
  }
}
/** 首次真正展开后才发起网络请求，失败后重新展开可重试。 */
function onToggle(event: Event): void {
  if ((event.target as HTMLDetailsElement).open && !loaded.value) void load();
}
/** 结束归档组件脚本。 */
</script>
<!-- 原生details提供键盘操作和展开语义。 -->
<template>
  <!-- 归档区不与资料保存争夺主操作。 -->
  <details class="archives" @toggle="onToggle">
    <summary>已归档的旅行会话</summary>
    <p class="archive-note">归档只收起会话，随时可以恢复。</p>
    <p v-if="error" class="archive-error" role="alert">{{ error }}</p>
    <p v-if="loaded && !items.length" class="archive-note">还没有归档会话。</p>
    <div v-for="item in items" :key="item.id" class="archive-row">
      <span>{{ item.title }}</span>
      <button
        type="button"
        :disabled="busy"
        :aria-label="`恢复${item.title}`"
        @click="restore(item.id)"
      >
        <ArchiveRestore :size="13" />
        恢复
      </button>
    </div>
    <LoaderCircle v-if="busy" :size="15" class="spin" />
    <button v-if="cursor" class="archive-more" type="button" :disabled="busy" @click="load(true)">
      加载更多归档
    </button>
  </details>
  <!-- 结束归档模板。 -->
</template>
<!-- 归档采用紧凑行布局，与账户表单一致。 -->
<style scoped>
/** 与常用资料操作保持清晰分隔。 */
.archives {
  border-top: 1px solid var(--line);
  margin-top: 30px;
  padding-top: 20px;
  font-size: 14px;
  color: var(--forest);
}
/** 原生summary保留可见的折叠指示。 */
summary {
  cursor: pointer;
  padding: 5px 0;
}
/** 辅助说明不虚构归档内容。 */
.archive-note {
  font-size: 13px;
  line-height: 1.8;
  color: var(--muted);
}
/** 每个归档项有独立恢复按钮。 */
.archive-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
/** 名称过长时允许断词，不挤压动作区域。 */
.archive-row span {
  overflow-wrap: anywhere;
}
/** 恢复动作保持足够点击面积。 */
.archive-row button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  color: var(--forest);
}
/** 失败可以通过重新展开或再次操作恢复。 */
.archive-error {
  color: #974c35;
  line-height: 1.8;
}
/** 分页按真实游标出现。 */
.archive-more {
  margin-top: 14px;
  padding: 8px 0;
  font-size: 13px;
}
/** 结束归档样式。 */
</style>
