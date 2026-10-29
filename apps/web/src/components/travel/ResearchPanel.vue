<!-- 检索与证据呈现独立于需求和行程，原文只作为纯文本。 -->
<script setup lang="ts">
/** 表单状态不写入父组件数据。 */
import { shallowRef } from 'vue';
/** 来源类型保留时间和抽取状态。 */
import type { Evidence } from '@journey/contracts';
/** 父层负责网络、归属与修订号。 */
defineProps<{ sources: Evidence[]; busy: boolean }>();
/** 搜索与人工录入是两个明确用户动作。 */
const emit = defineEmits<{
  search: [input: { query: string; extract: boolean; refresh: boolean }];
  manual: [
    input: {
      url: string;
      title: string;
      excerpt: string;
      publishedAt: null;
      claims: [];
    },
  ];
}>();
/** 只保存当前表单草稿。 */
const query = shallowRef('');
const refresh = shallowRef(false);
const url = shallowRef('');
const title = shallowRef('');
const excerpt = shallowRef('');
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">EVIDENCE DESK</span>
        <h2>每个决定，有据可循。</h2>
        <p>检索后提取来源，区分文章发布日期、查询时刻和资料有效期。网页起价保留为营销信息。</p>
      </div>
    </div>
    <form
      class="trip-inline-form"
      @submit.prevent="emit('search', { query, extract: true, refresh })"
    >
      <input
        v-model="query"
        aria-label="旅游资料检索关键词"
        placeholder="例如：苏州博物馆 官方 预约 开放时间"
        required
        minlength="2"
        maxlength="500"
      />
      <button class="trip-button" :disabled="busy">搜索并提取</button>
      <label class="trip-check">
        <input v-model="refresh" type="checkbox" />
        刷新有效期内缓存
      </label>
    </form>
    <div v-if="!sources.length" class="trip-empty">
      还没有来源。先查官方开放、交通与预约信息，再开始安排。
    </div>
    <!-- 每条资料都能展开核对摘录与结论。 -->
    <article v-for="source in sources" :key="source.id" class="source-row">
      <div class="source-meta">
        <span class="trip-pill">
          {{
            source.kind === 'official'
              ? '官方域名'
              : source.kind === 'manual'
                ? '人工录入'
                : '网页资料'
          }}
        </span>
        <span>
          {{
            source.extraction === 'success'
              ? '已提取'
              : source.extraction === 'failed'
                ? '提取失败，仅有摘要'
                : '仅有摘要'
          }}
        </span>
      </div>
      <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a>
      <p>{{ source.url }}</p>
      <small>
        发布：{{
          source.publishedAt ? new Date(source.publishedAt).toLocaleDateString('zh-CN') : '未提供'
        }}
        · 查询：{{ new Date(source.checkedAt).toLocaleString('zh-CN') }} · 到期：{{
          new Date(source.expiresAt).toLocaleString('zh-CN')
        }}
      </small>
      <details class="trip-details">
        <summary>核对来源摘录与结论</summary>
        <p class="source-excerpt">
          {{ source.excerpt || '来源未返回可保存文字' }}
        </p>
        <ul>
          <li v-for="(claim, index) in source.claims" :key="index">
            {{ claim.text }} ·
            {{ claim.confidence === 'quoted' ? '有摘录' : '需确认' }}
          </li>
        </ul>
      </details>
    </article>
    <details class="trip-details">
      <summary>录入已有来源</summary>
      <form
        class="trip-form"
        @submit.prevent="emit('manual', { url, title, excerpt, publishedAt: null, claims: [] })"
      >
        <label>
          来源标题
          <input v-model="title" required maxlength="300" />
        </label>
        <label>
          公共来源链接
          <input v-model="url" required type="url" />
        </label>
        <label>
          核实的原文摘录
          <textarea v-model="excerpt" required maxlength="6000" rows="4"></textarea>
        </label>
        <button class="trip-button secondary" :disabled="busy">保存为人工来源</button>
      </form>
    </details>
  </section>
</template>
<style scoped>
/** 来源采用编辑台式横向分隔，长链接不会撑开页面。 */
.source-row {
  padding: 24px 0;
  border-bottom: 1px solid var(--line);
  overflow-wrap: anywhere;
}
.source-row > a {
  font-size: 17px;
  font-weight: 600;
  color: var(--forest);
  text-decoration: none;
}
.source-row > p,
.source-row > small {
  font-size: 13px;
  color: var(--muted);
}
.source-meta {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 12px;
}
.source-excerpt {
  white-space: pre-wrap;
  line-height: 1.9;
  font-size: 14px;
  max-height: 300px;
  overflow: auto;
}
</style>
