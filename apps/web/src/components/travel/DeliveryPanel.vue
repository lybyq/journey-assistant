<!-- 导出、分享、撤销与运行摘要都对应真实接口。 -->
<script setup lang="ts">
/** 仅保存分享有效期与剪贴板反馈。 */
import { shallowRef } from 'vue';
/** 版本对象只读，不能在交付时改写验证结果。 */
import type { PlanVersion } from '@journey/contracts';
/** 当前版本质量状态明确显示。 */
import { planStatus } from '@/features/travel/format';
/** 分享列表不含秘密，只有刚创建的链接显示一次。 */
const props = defineProps<{
  version: PlanVersion | null;
  shares: any[];
  newShare: string;
  metrics: any;
  busy: boolean;
}>();
/** 每个按钮都是明确业务动作。 */
const emit = defineEmits<{
  download: [kind: 'pdf' | 'markdown'];
  share: [hours: number];
  revoke: [id: string];
  load: [];
}>();
/** 分享最长7天，默认24小时。 */
const hours = shallowRef(24);
const copied = shallowRef(false);
const copyError = shallowRef('');
/** 剪贴板失败时仍允许用户手动选择链接，不伪报成功。 */
async function copy() {
  try {
    await navigator.clipboard.writeText(props.newShare);
    copied.value = true;
    copyError.value = '';
  } catch {
    copyError.value = '无法自动复制，请手动复制上方链接';
  }
}
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">READY TO TAKE WITH YOU</span>
        <h2>把这一程，带在身边。</h2>
        <p>导出与分享固定到正在查看的版本。链接可以过期或撤销，旧报价仍需出发前刷新。</p>
      </div>
    </div>
    <div v-if="!version" class="trip-empty">先在行程版本生成或保存一个行程版本，再导出或分享。</div>
    <template v-else>
      <div class="trip-callout">
        <strong>当前交付：v{{ version.version }} · {{ version.draft.title }}</strong>
        <p>{{ planStatus(version.status) }}。导出会保留全部待确认项、冲突与估算假设。</p>
      </div>
      <div class="trip-actions">
        <button class="trip-button" :disabled="busy" @click="emit('download', 'pdf')">
          下载中文 PDF
        </button>
        <button
          class="trip-button secondary"
          :disabled="busy"
          @click="emit('download', 'markdown')"
        >
          下载 Markdown
        </button>
      </div>
      <section class="share-section">
        <h3>只分享这一版</h3>
        <p>链接持有人可以查看这份行程，不会获得账户、聊天历史或其他方案。</p>
        <div class="trip-inline-form">
          <label>
            有效期
            <select v-model.number="hours">
              <option :value="1">1小时</option>
              <option :value="24">24小时</option>
              <option :value="72">3天</option>
              <option :value="168">7天</option>
            </select>
          </label>
          <button class="trip-button secondary" :disabled="busy" @click="emit('share', hours)">
            创建限时链接
          </button>
          <button class="trip-text-button" :disabled="busy" @click="emit('load')">
            刷新分享记录
          </button>
        </div>
        <div v-if="newShare" class="share-created">
          <label>
            新链接（只在本次显示）
            <input :value="newShare" readonly aria-label="新建旅行分享链接" />
          </label>
          <button class="trip-button secondary" @click="copy">
            {{ copied ? '已复制' : '复制链接' }}
          </button>
        </div>
        <p v-if="copyError" class="trip-error">{{ copyError }}</p>
        <article v-for="share in shares" :key="share.id" class="share-row">
          <div>
            <strong>
              {{
                share.revokedAt
                  ? '已撤销'
                  : Date.parse(share.expiresAt) <= Date.now()
                    ? '已过期'
                    : '有效分享'
              }}
            </strong>
            <p>
              创建于{{ new Date(share.createdAt).toLocaleString('zh-CN') }} · 到期{{
                new Date(share.expiresAt).toLocaleString('zh-CN')
              }}
            </p>
          </div>
          <button
            v-if="!share.revokedAt"
            class="trip-text-button"
            :disabled="busy"
            @click="emit('revoke', share.id)"
          >
            撤销访问
          </button>
        </article>
      </section>
    </template>
    <section class="metrics-section">
      <span class="trip-eyebrow">YOUR LAST 24 HOURS</span>
      <h3>运行与用量</h3>
      <p v-if="metrics">
        实际模型调用{{ metrics.usage.modelCalls }}次 · 工具{{ metrics.usage.toolCalls }}次 ·
        {{ metrics.usage.estimated ? '约' : '' }}{{ metrics.usage.tokens }} tokens
      </p>
      <p>{{ metrics?.billing ?? '登录后显示自己的运行摘要。' }}</p>
      <div v-for="(row, index) in metrics?.operations ?? []" :key="index" class="metric-row">
        <span>
          {{
            [
              '需求整理',
              '资料检索',
              '交通查询',
              '自驾路线',
              '住宿游玩',
              '旅行团',
              '预算计算',
              '行程生成',
              '交付',
            ][row.module - 6] ?? '业务查询'
          }}
        </span>
        <span>
          {{ row.status === 'completed' ? '完成' : row.status === 'cancelled' ? '取消' : '失败' }}
          {{ row.count }}次
        </span>
        <span>平均{{ row.avg_ms }}ms</span>
      </div>
    </section>
  </section>
</template>
<style scoped>
/** 交付动作集中，令牌输入可手工选择复制。 */
.share-section,
.metrics-section {
  margin-top: 35px;
  padding-top: 25px;
  border-top: 1px solid var(--line);
}
.share-section h3,
.metrics-section h3 {
  font-size: 21px;
  color: var(--forest);
}
.share-section p,
.metrics-section p {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.8;
}
.share-created {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  margin: 22px 0;
}
.share-created label {
  flex: 1;
  min-width: 0;
}
.share-created input {
  width: 100%;
}
.share-row {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  padding: 17px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.metric-row {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
.share-row > div {
  min-width: 0;
}
</style>
