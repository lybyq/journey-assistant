<!-- 费用来源和未知类别在方案旁可展开，金额只展示服务端快照。 -->
<script setup lang="ts">
import type { PlanVersion } from '@journey/contracts';
import { money, priceLabel } from '@/features/travel/format';
defineProps<{ version: PlanVersion }>();
</script>
<template>
  <details class="cost-evidence">
    <summary>
      费用明细与资料来源
      <span>
        {{ version.budget.complete ? '预算口径已覆盖' : '预算仍有缺项' }} ·
        {{ version.prices.length }} 项费用 / {{ version.sources.length }} 条来源
      </span>
    </summary>
    <p v-if="!version.prices.length">当前没有已保存的费用报价，不能比较完整旅行总价。</p>
    <div class="cost-rows">
      <article v-for="price in version.prices" :key="price.id">
        <div>
          <b>{{ price.label }}</b>
          <span>{{ money(price.unitAmountMinor, price.currency) }} × {{ price.quantity }}</span>
        </div>
        <p>
          {{ priceLabel(price.priceType) }} · {{ price.provider }}
          <br />
          {{ price.notes }}
        </p>
        <small>
          查询：{{
            new Date(price.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          }}（北京时间）
          <template v-if="price.validUntil">
            · 有效至
            {{ new Date(price.validUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }}
          </template>
        </small>
        <a v-if="price.sourceUrl" :href="price.sourceUrl" target="_blank" rel="noopener noreferrer">
          查看价格来源 ↗
        </a>
      </article>
    </div>
    <p>
      已知费用 {{ money(version.budget.knownTotalMinor, version.budget.currency) }} ＋ 预备金
      {{ money(version.budget.reserveMinor, version.budget.currency) }} ＝
      {{ money(version.budget.totalWithReserveMinor, version.budget.currency) }}；{{
        version.budget.complete ? '预算口径已覆盖' : '缺项仍需另行补齐'
      }}。
    </p>
    <ul>
      <li v-for="issue in version.budget.issues" :key="issue">{{ issue }}</li>
      <li
        v-for="issue in version.violations.filter(
          (issue) => issue.code === 'MISSING_COST_CATEGORY',
        )"
        :key="issue.message"
      >
        {{ issue.message }}
      </li>
    </ul>
    <div class="sources">
      <a
        v-for="source in version.sources"
        :key="source.id"
        :href="source.url"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ source.title }} ↗
      </a>
    </div>
  </details>
</template>
<style scoped>
.cost-evidence {
  font-size: 13px;
  color: #71806a;
  line-height: 1.8;
  padding: 22px 0;
  border-top: 1px solid #dce4d5;
  margin-bottom: 22px;
}
.cost-evidence summary {
  cursor: pointer;
  color: #52694c;
}
.cost-evidence summary > span {
  font-size: 12px;
  color: #929c88;
  margin-left: 14px;
}
.cost-rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 20px;
}
.cost-rows article {
  border-bottom: 1px solid #e4eadd;
  padding-bottom: 15px;
}
.cost-rows article > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
}
.cost-rows b {
  font-weight: 500;
}
.cost-rows small {
  display: block;
  font-size: 11px;
  color: #929c88;
}
.cost-rows a {
  font-size: 12px;
}
.sources {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 16px;
}
.cost-evidence ul {
  padding-left: 18px;
}
@media (max-width: 650px) {
  .cost-rows {
    grid-template-columns: 1fr;
  }
  .cost-evidence summary > span {
    display: block;
    margin-left: 14px;
  }
}
</style>
