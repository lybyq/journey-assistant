<!-- 日历轴消费不可变版本，不从Markdown猜测时间、坐标或商品。 -->
<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { PlanVersion } from '@journey/contracts';
import { clock } from '@/features/travel/format';
import RouteMap from '@/components/travel/RouteMap.vue';
const props = defineProps<{ version: PlanVersion }>();
const dayIndex = shallowRef(0);
watch(
  () => props.version.id,
  () => {
    dayIndex.value = 0;
  },
);
const day = computed(() => props.version.draft.days[dayIndex.value] ?? props.version.draft.days[0]);
const points = computed(
  () =>
    day.value?.items.flatMap((item) =>
      item.point ? [{ name: item.title, point: item.point }] : [],
    ) ?? [],
);
const kinds = {
  visit: '游玩',
  meal: '用餐',
  hotel: '住宿',
  transit: '交通',
  rest: '休息',
  charging: '充电',
};
</script>
<template>
  <section class="timeline" aria-label="每日行程">
    <div class="days" aria-label="选择行程日期">
      <button
        v-for="(item, index) in version.draft.days"
        :key="item.date"
        type="button"
        :class="{ active: index === dayIndex }"
        :aria-pressed="index === dayIndex"
        @click="dayIndex = index"
      >
        <b>DAY {{ String(index + 1).padStart(2, '0') }}</b>
        <span>{{ item.date.slice(5) }}</span>
      </button>
    </div>
    <div class="day-layout">
      <div class="stops">
        <p v-if="!day?.items.length" class="empty">当天尚无可安排活动，需要补充真实候选。</p>
        <article v-for="item in day?.items" :key="item.id" class="stop">
          <div class="time">
            {{ clock(item.startMinute) }}
            <small>{{ clock(item.endMinute) }}</small>
          </div>
          <div class="stop-body">
            <span class="kind">{{ kinds[item.kind] }}</span>
            <h4>{{ item.title }}</h4>
            <p>{{ item.notes }}</p>
            <span v-if="item.travelBeforeMinutes !== null" class="connection">
              接驳参考 {{ item.travelBeforeMinutes }} 分钟
            </span>
            <span v-else class="pending">接驳待核实</span>
          </div>
        </article>
      </div>
      <aside>
        <RouteMap :points="points" />
        <p class="map-note">地点与连接示意；实际道路、导航和预约以平台为准。</p>
        <details>
          <summary>本方案的规划假设</summary>
          <ul>
            <li v-for="line in version.draft.assumptions" :key="line">{{ line }}</li>
          </ul>
        </details>
      </aside>
    </div>
  </section>
</template>
<style scoped>
.days {
  display: flex;
  gap: 8px;
  overflow: auto;
  padding-bottom: 18px;
}
.days button {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: white;
  border: 1px solid #dce4dd;
  border-radius: 11px;
  padding: 12px 22px;
  color: #697a6d;
  cursor: pointer;
}
.days button.active {
  background: #204e38;
  color: white;
  border-color: #204e38;
}
.days b {
  font-size: 13px;
  letter-spacing: 0.07em;
}
.days span {
  font-size: 12px;
}
.day-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 28px;
}
.stop {
  display: flex;
  gap: 20px;
  padding: 0 0 24px;
}
.time {
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  min-width: 50px;
  padding-top: 4px;
  color: #29543c;
}
.time small {
  display: block;
  color: #8c988e;
  font-size: 12px;
  margin-top: 5px;
}
.stop-body {
  border-left: 2px solid #dce8da;
  padding: 0 0 4px 22px;
  min-width: 0;
  position: relative;
}
.stop-body:before {
  content: '';
  position: absolute;
  left: -5px;
  top: 9px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4d855d;
  box-shadow: 0 0 0 4px #edf3e9;
}
.kind {
  font-size: 11px;
  color: #849281;
  letter-spacing: 0.12em;
}
h4 {
  font-size: 20px;
  margin: 7px 0;
  font-weight: 600;
}
.stop p {
  font-size: 14px;
  color: #718073;
  line-height: 1.8;
  margin: 0 0 8px;
  overflow-wrap: anywhere;
}
.connection,
.pending {
  font-size: 12px;
  color: #597b63;
}
.pending {
  color: #977841;
}
aside {
  align-self: start;
  position: sticky;
  top: 0;
  min-width: 0;
  background: #f1f4eb;
  border-radius: 15px;
  padding: 18px;
}
.map-note,
details {
  font-size: 13px;
  color: #788473;
  line-height: 1.8;
}
details ul {
  padding-left: 18px;
}
summary {
  cursor: pointer;
}
@media (max-width: 1000px) {
  .day-layout {
    grid-template-columns: 1fr;
  }
  aside {
    position: static;
  }
  .days button {
    padding: 10px 17px;
  }
}
</style>
