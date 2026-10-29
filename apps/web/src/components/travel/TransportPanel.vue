<!-- 车次与航班对比展示接驳和缓冲，查询从不执行下单。 -->
<script setup lang="ts">
/** 需求变化时更新查询草稿。 */
import { reactive, watch } from 'vue';
/** 使用真实标准化类型。 */
import type { TransportOption, TripRequest } from '@journey/contracts';
/** 金额和时长只做显示格式化。 */
import { money, minutes, priceLabel } from '@/features/travel/format';
/** 网络请求交给父组件。 */
const props = defineProps<{
  request: TripRequest;
  options: TransportOption[];
  busy: boolean;
  flightConfigured: boolean;
}>();
/** 只发送查询条件，不发送供应商Key。 */
const emit = defineEmits<{ rail: [input: any]; flights: [input: any] }>();
/** 铁路和机场参数分开，不能假定中文地名等于IATA编码。 */
const rail = reactive({
  origin: '',
  destination: '',
  date: '',
  accessMinutes: 30,
  bufferMinutes: 30,
  egressMinutes: 30,
  interline: false,
});
const flight = reactive({
  originCode: '',
  destinationCode: '',
  returnDate: null as string | null,
});
/** 当前需求明确时才填入查询输入。 */
watch(
  () => props.request,
  (value) => {
    rail.origin = value.origin ?? '';
    rail.destination = value.destination ?? '';
    rail.date = value.startDate ?? '';
  },
  { immediate: true },
);
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">DOOR TO DOOR</span>
        <h2>比较整段旅程，不只是一张票。</h2>
        <p>把出发接驳、候车与落地交通一起看。铁路参考票面价不会冒充全家出票总价。</p>
      </div>
    </div>
    <form class="trip-form" @submit.prevent="emit('rail', { ...rail })">
      <div class="trip-form-grid">
        <label>
          出发城市 / 车站
          <input v-model="rail.origin" required />
        </label>
        <label>
          到达城市 / 车站
          <input v-model="rail.destination" required />
        </label>
        <label>
          乘车日期
          <input v-model="rail.date" type="date" required />
        </label>
        <label>
          出发接驳（分钟）
          <input v-model.number="rail.accessMinutes" type="number" min="0" max="600" />
        </label>
        <label>
          候车缓冲（分钟）
          <input v-model.number="rail.bufferMinutes" type="number" min="0" max="600" />
        </label>
        <label>
          落地接驳（分钟）
          <input v-model.number="rail.egressMinutes" type="number" min="0" max="600" />
        </label>
      </div>
      <div class="trip-actions">
        <button class="trip-button" :disabled="busy">查询12306</button>
        <label class="trip-check">
          <input v-model="rail.interline" type="checkbox" />
          查询中转
        </label>
      </div>
    </form>
    <details class="trip-details">
      <summary>查询授权航班 {{ flightConfigured ? '' : '· 未配置供应商' }}</summary>
      <p v-if="!flightConfigured">
        尚未配置 Amadeus 授权接口；可继续查询铁路、录入有来源的交通估算。
      </p>
      <form class="trip-inline-form" @submit.prevent="emit('flights', { ...flight })">
        <input
          v-model="flight.originCode"
          aria-label="出发机场IATA代码"
          placeholder="出发机场代码，如HGH"
          pattern="[A-Z]{3}"
          required
        />
        <input
          v-model="flight.destinationCode"
          aria-label="到达机场IATA代码"
          placeholder="到达机场代码，如SHA"
          pattern="[A-Z]{3}"
          required
        />
        <button class="trip-button secondary" :disabled="busy || !flightConfigured">
          查询航班
        </button>
      </form>
    </details>
    <div v-if="!options.length" class="trip-empty">
      查询后，这里会列出实际返回的交通候选与余票状态。
    </div>
    <!-- 每个席别独立列出，不混用不同票种的价格。 -->
    <article v-for="option in options" :key="option.id" class="transport-row">
      <div class="transport-name">
        <span class="trip-pill">
          {{ option.mode === 'rail' ? '铁路' : option.mode === 'flight' ? '航班' : '接驳' }}
        </span>
        <strong>{{ option.label }}</strong>
        <small>
          {{
            option.availability === 'available'
              ? '查询时可用'
              : option.availability === 'unavailable'
                ? '暂无可用余票'
                : '可用性待确认'
          }}
        </small>
      </div>
      <div class="transport-route">
        <div>
          <strong>{{ option.origin }}</strong>
          <span>{{ option.departure ?? '出发时刻待确认' }}</span>
        </div>
        <div class="transport-line">
          <span>{{ minutes(option.durationMinutes) }}</span>
          <i></i>
          <small>换乘 {{ option.transfers }} 次</small>
        </div>
        <div>
          <strong>{{ option.destination }}</strong>
          <span>{{ option.arrival ?? '到达时刻待确认' }}</span>
        </div>
      </div>
      <div class="transport-footer">
        <span>
          接驳与缓冲
          {{ option.accessMinutes + option.bufferMinutes + option.egressMinutes }}
          分钟 · {{ option.seatType ?? '席别待确认' }}
        </span>
        <strong>
          {{
            option.quote ? money(option.quote.unitAmountMinor, option.quote.currency) : '价格待确认'
          }}
          <small>{{ option.quote ? priceLabel(option.quote.priceType) : '' }}</small>
        </strong>
      </div>
      <p>{{ option.notes }}</p>
    </article>
  </section>
</template>
<style scoped>
/** 车次采用横向信息层级，窄屏仍保留路线方向。 */
.transport-row {
  border-bottom: 1px solid var(--line);
  padding: 25px 0;
}
.transport-name,
.transport-footer {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
}
.transport-name > strong {
  font-size: 18px;
}
.transport-name > small {
  margin-left: auto;
  color: var(--muted);
}
.transport-route {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin: 24px 0;
}
.transport-route > div {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.transport-route span {
  font-size: 13px;
  color: var(--muted);
}
.transport-line {
  text-align: center;
}
.transport-line i {
  height: 1px;
  background: var(--line);
  margin: 5px 0;
}
.transport-footer {
  justify-content: space-between;
}
.transport-row > p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--muted);
}
.transport-footer small {
  font-weight: 400;
}
</style>
