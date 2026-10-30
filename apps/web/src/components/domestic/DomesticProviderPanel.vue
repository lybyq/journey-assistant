<!-- 官方有能力不等于当前部署已获得权限，渠道面板分别展示。 -->
<script setup lang="ts">
import type { DomesticProvider } from '@journey/contracts';
defineProps<{ providers: DomesticProvider[] }>();
const labels = {
  ready: '已连接',
  idle: '按需连接',
  unconfigured: '未配置',
  unavailable: '暂不可用',
  partner_required: '待申请合作',
};
</script>
<template>
  <details class="providers">
    <summary>
      数据与平台覆盖
      <span>
        {{ providers.filter((provider) => provider.implemented).length }} 个已实现渠道 /
        {{ providers.length }} 个已调研渠道
      </span>
    </summary>
    <div class="provider-grid">
      <article v-for="provider in providers" :key="provider.id">
        <div>
          <b>{{ provider.label }}</b>
          <span :class="{ ready: provider.state === 'ready' }">{{ labels[provider.state] }}</span>
        </div>
        <p>{{ provider.accessNote }}</p>
        <a :href="provider.officialUrl" target="_blank" rel="noopener noreferrer">官方能力说明 ↗</a>
      </article>
    </div>
  </details>
</template>
<style scoped>
.providers {
  border-top: 1px solid #dee5da;
  padding-top: 22px;
  font-size: 14px;
  color: #5e705f;
}
summary {
  cursor: pointer;
  line-height: 1.8;
}
summary > span {
  font-size: 12px;
  margin-left: 12px;
  color: #879080;
}
.provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  margin-top: 24px;
}
.provider-grid article > div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.provider-grid b {
  font-size: 14px;
  font-weight: 500;
}
.provider-grid span {
  font-size: 11px;
  color: #957e51;
}
.provider-grid span.ready {
  color: #3d8555;
}
.provider-grid p {
  font-size: 13px;
  line-height: 1.8;
  color: #85907d;
}
.provider-grid a {
  font-size: 12px;
  color: #497450;
}
@media (max-width: 650px) {
  .provider-grid {
    grid-template-columns: 1fr;
  }
  summary > span {
    display: block;
    margin-left: 14px;
  }
}
</style>
