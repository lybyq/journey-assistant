<!-- 单个方案卡只展示经过服务端验证的版本，预览与正式选中分别表达。 -->
<script setup lang="ts">
import type { DomesticOptionSet } from '@journey/contracts';
import { money, planStatus } from '@/features/travel/format';
defineProps<{
  option: DomesticOptionSet['options'][number];
  index: number;
  preview: boolean;
  selected: boolean;
}>();
defineEmits<{ preview: [] }>();
</script>
<template>
  <button
    type="button"
    class="choice"
    :class="{ preview }"
    :aria-pressed="preview"
    @click="$emit('preview')"
  >
    <span class="choice-top">
      <span>OPTION 0{{ index + 1 }}</span>
      <span v-if="selected" class="chosen">已选择</span>
    </span>
    <h3>{{ option.label }}</h3>
    <p>{{ option.reason }}</p>
    <div class="price">
      <strong>
        {{
          option.version.prices.some((price) => price.unitAmountMinor !== null)
            ? money(option.version.budget.totalWithReserveMinor, option.version.budget.currency)
            : '待补充'
        }}
      </strong>
      <span>
        {{ option.version.budget.complete ? '方案预算含预备金' : '已知小计含预备金，非旅行总价' }}
      </span>
    </div>
    <div class="choice-bottom">
      <span>
        {{ option.version.draft.days.length }} 天 ·
        {{
          option.version.draft.mode === 'driving'
            ? '自驾游'
            : option.version.draft.mode === 'group'
              ? '跟团游'
              : '自由行'
        }}
      </span>
      <span>{{ planStatus(option.version.status) }} →</span>
    </div>
  </button>
</template>
<style scoped>
.choice {
  display: flex;
  flex-direction: column;
  text-align: left;
  min-width: 0;
  padding: 24px;
  border: 1px solid #dce4dd;
  border-radius: 18px;
  background: #fff;
  color: #243c32;
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
}
.choice:hover {
  transform: translateY(-3px);
  border-color: #719a81;
}
.choice.preview {
  border: 2px solid #28714d;
  padding: 23px;
  background: #f5faf3;
  box-shadow: 0 8px 24px #214a2d12;
}
.choice-top,
.choice-bottom {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  letter-spacing: 0.05em;
}
.choice-top {
  color: #718477;
  align-items: center;
}
.chosen {
  background: #245b40;
  color: white;
  padding: 3px 9px;
  border-radius: 20px;
}
h3 {
  font-size: 24px;
  letter-spacing: -0.04em;
  margin: 20px 0 9px;
}
p {
  font-size: 14px;
  line-height: 1.8;
  color: #66776a;
  margin: 0 0 24px;
  flex: 1;
}
.price {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.price strong {
  font-size: 27px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.price span {
  font-size: 12px;
  color: #7c6c4e;
}
.choice-bottom {
  margin-top: 22px;
  border-top: 1px solid #dce4dd;
  padding-top: 15px;
  flex-wrap: wrap;
  line-height: 1.5;
}
@media (prefers-reduced-motion: reduce) {
  .choice {
    transition: none;
  }
  .choice:hover {
    transform: none;
  }
}
</style>
