<!-- 平台交接明确查询入口与商品订单的区别，不收集乘客身份或支付信息。 -->
<script setup lang="ts">
import type { PlanVersion } from '@journey/contracts';
import { computed } from 'vue';
const props = defineProps<{
  version: PlanVersion;
  selected: boolean;
  busy: boolean;
  stale: boolean;
}>();
defineEmits<{ open: [providerId: string] }>();
const checks = computed(() => [
  {
    label: '城际交通',
    ready: props.version.draft.days.some((day) =>
      day.items.some((item) => item.kind === 'transit'),
    ),
    description: '核对去返程、乘客与退改规则',
  },
  {
    label: '住宿与餐饮',
    ready: props.version.draft.days.some((day) => day.items.some((item) => item.kind === 'hotel')),
    description: '核对入住日期、房型、早餐与儿童政策',
  },
  { label: '门票与预约', ready: false, description: '核对开放时间、实名预约及入园时段' },
]);
const channels = [
  { id: 'railway', name: '12306 官方', detail: '火车票查询购票' },
  { id: 'ctrip', name: '携程', detail: '机票 / 酒店 / 游玩' },
  { id: 'qunar', name: '去哪儿', detail: '交通 / 住宿 / 度假' },
  { id: 'meituan', name: '美团', detail: '餐饮 / 门票 / 酒店' },
  { id: 'tongcheng', name: '同程', detail: '交通 / 景点 / 用车' },
  { id: 'fliggy', name: '飞猪', detail: '机票 / 酒店 / 游玩' },
];
</script>
<template>
  <section class="booking">
    <div class="booking-heading">
      <div>
        <span class="eyebrow">NEXT, MAKE IT HAPPEN</span>
        <h3>把计划变成出发</h3>
      </div>
      <span class="free">免费规划 · 平台预订</span>
    </div>
    <div class="checks">
      <div v-for="check in checks" :key="check.label">
        <b>{{ check.label }}</b>
        <span>{{ check.description }}</span>
        <small>{{ check.ready ? '已有安排，订单尚待确认' : '待查询确认' }}</small>
      </div>
    </div>
    <p>
      以下均为平台查询首页，尚未接入指定商品库存和联盟取链。请选择方案后，到平台核对价格并自行确认订单、付款；佣金不影响方案排序。
    </p>
    <div class="channels">
      <button
        v-for="channel in channels"
        :key="channel.id"
        type="button"
        :disabled="busy || !selected"
        @click="$emit('open', channel.id)"
      >
        <strong>{{ channel.name }} ↗</strong>
        <span>{{ channel.detail }}</span>
      </button>
    </div>
    <p v-if="stale">
      当前方案依据已变化或报价已过期；平台通用查询仍可打开，请重新核对，不能把旧报价当成有效报价。
    </p>
    <p v-if="!selected" class="select-note">先选择一套安排，再进入预订清单。</p>
  </section>
</template>
<style scoped>
.booking {
  padding: 27px;
  background: #edf2e8;
  border: 1px solid #dee6d7;
  border-radius: 18px;
}
.booking-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.eyebrow {
  font-size: 10px;
  letter-spacing: 0.16em;
  color: #75826b;
}
h3 {
  font-size: 25px;
  margin: 8px 0 24px;
  color: #294534;
}
.free {
  font-size: 12px;
  color: #5e785b;
}
.checks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.checks div {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-left: 2px solid #a3b597;
  padding-left: 14px;
}
.checks b {
  font-size: 15px;
}
.checks span {
  font-size: 13px;
  color: #6c7b65;
  line-height: 1.7;
}
.checks small {
  font-size: 12px;
  color: #93753e;
}
.booking p {
  font-size: 13px;
  line-height: 1.85;
  color: #6c7b65;
  margin: 24px 0 18px;
}
.channels {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.channels button {
  display: flex;
  flex-direction: column;
  gap: 7px;
  border: 1px solid #d7e0ce;
  border-radius: 10px;
  background: #fbfcf8;
  padding: 15px;
  text-align: left;
  color: #34543b;
  cursor: pointer;
}
.channels button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.channels strong {
  font-size: 15px;
  font-weight: 500;
}
.channels span {
  font-size: 12px;
  color: #89927e;
}
.booking .select-note {
  margin-bottom: 0;
}
@media (max-width: 650px) {
  .booking {
    padding: 20px;
  }
  .checks {
    grid-template-columns: 1fr;
  }
  .channels {
    grid-template-columns: repeat(2, 1fr);
  }
  .booking-heading {
    align-items: start;
    flex-direction: column;
  }
  .free {
    margin-top: -12px;
    margin-bottom: 18px;
  }
}
</style>
