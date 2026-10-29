<!-- 费用入参有明确单位，地图提供真实路线而不是装饰连线。 -->
<script setup lang="ts">
/** 表单字段本地响应，派生地点用computed。 */
import { computed, reactive } from 'vue';
/** 路线与地点契约来自共享包。 */
import type { DrivingRoute, Experience } from '@journey/contracts';
/** 金额与时间仅格式化。 */
import { money, minutes } from '@/features/travel/format';
/** 地点候选来自住宿游玩真实查询。 */
const props = defineProps<{
  routes: DrivingRoute[];
  places: Experience[];
  busy: boolean;
}>();
/** 查询意图交给父组件附加revision。 */
const emit = defineEmits<{ query: [input: any] }>();
/** 所有单价和耗时都显示为用户可以确认的输入。 */
const form = reactive({
  originLng: '',
  originLat: '',
  destinationLng: '',
  destinationLat: '',
  energy: 'fuel',
  consumption: '',
  unitPrice: '',
  source: '',
  toll: '',
  parking: '',
  rental: '',
  insurance: '',
  charging: 0,
  restEvery: 120,
  rest: 20,
  waypoints: '',
});
/** 只有实际有坐标的候选才能用于选择。 */
const points = computed(() => props.places.filter((place) => place.point));
/** 用户选择地点才替换坐标，不凭空猜经纬度。 */
function pick(side: 'origin' | 'destination', id: string) {
  const point = points.value.find((place) => place.id === id)?.point;
  if (point) {
    form[`${side}Lng`] = String(point.lng);
    form[`${side}Lat`] = String(point.lat);
  }
}
/** 空费用保留null，明确0才表示无需该项。 */
const minor = (value: string) => (value.trim() ? Math.round(Number(value) * 100) : null);
/** 以完整有单位的结构提交，后端负责真实路线与确定性计算。 */
function submit() {
  emit('query', {
    origin: {
      lng: Number(form.originLng),
      lat: Number(form.originLat),
      coordinateSystem: 'GCJ-02',
    },
    destination: {
      lng: Number(form.destinationLng),
      lat: Number(form.destinationLat),
      coordinateSystem: 'GCJ-02',
    },
    waypoints: form.waypoints.trim()
      ? form.waypoints
          .trim()
          .split(';')
          .map((value) => {
            const [lng, lat] = value.split(',').map(Number);
            return { lng, lat, coordinateSystem: 'GCJ-02' };
          })
      : [],
    energy: form.energy,
    consumptionPer100: form.consumption,
    energyUnitPriceMinor: minor(form.unitPrice),
    energyPriceSource: form.source,
    tollMinor: minor(form.toll),
    parkingMinor: minor(form.parking),
    rentalMinor: minor(form.rental),
    insuranceMinor: minor(form.insurance),
    chargingMinutes: Number(form.charging),
    restEveryMinutes: Number(form.restEvery),
    restMinutes: Number(form.rest),
    currency: 'CNY',
  });
}
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">ON THE ROAD</span>
        <h2>路有多远，费用就算多细。</h2>
        <p>先在地点面板保存候选，再选择起终点；也可填写高德坐标。请先在需求中确认车辆数量。</p>
      </div>
    </div>
    <form class="trip-form" @submit.prevent="submit">
      <div class="trip-form-grid">
        <label>
          从已查地点选起点
          <select @change="pick('origin', ($event.target as HTMLSelectElement).value)">
            <option value="">选择地点</option>
            <option v-for="place in points" :key="place.id" :value="place.id">
              {{ place.name }}
            </option>
          </select>
        </label>
        <label>
          从已查地点选终点
          <select @change="pick('destination', ($event.target as HTMLSelectElement).value)">
            <option value="">选择地点</option>
            <option v-for="place in points" :key="place.id" :value="place.id">
              {{ place.name }}
            </option>
          </select>
        </label>
        <label>
          起点经度
          <input v-model="form.originLng" type="number" step="any" required />
        </label>
        <label>
          起点纬度
          <input v-model="form.originLat" type="number" step="any" required />
        </label>
        <label>
          终点经度
          <input v-model="form.destinationLng" type="number" step="any" required />
        </label>
        <label>
          终点纬度
          <input v-model="form.destinationLat" type="number" step="any" required />
        </label>
        <label>
          能源类型
          <select v-model="form.energy">
            <option value="fuel">燃油（升）</option>
            <option value="electric">电能（度）</option>
          </select>
        </label>
        <label>
          百公里消耗
          <input v-model="form.consumption" required placeholder="例如：8.5" inputmode="decimal" />
        </label>
        <label>
          每升 / 每度价格（元）
          <input
            v-model="form.unitPrice"
            required
            inputmode="decimal"
            placeholder="请填写确认单价"
          />
        </label>
        <label>
          单价来源
          <input
            v-model="form.source"
            required
            placeholder="例如：本人加油小票，10月28日"
            maxlength="300"
          />
        </label>
        <label>
          每辆全程过路费（元）
          <input v-model="form.toll" placeholder="未知留空，确认无需填0" />
        </label>
        <label>
          每辆全程停车费（元）
          <input v-model="form.parking" placeholder="未知留空" />
        </label>
        <label>
          每辆全程租车费（元）
          <input v-model="form.rental" placeholder="自有车辆确认无需请填0" />
        </label>
        <label>
          每辆车辆保险（元）
          <input v-model="form.insurance" placeholder="未知留空" />
        </label>
        <label>
          每隔多少分钟休息
          <input v-model.number="form.restEvery" type="number" min="30" max="240" />
        </label>
        <label>
          每次休息（分钟）
          <input v-model.number="form.rest" type="number" min="10" max="120" />
        </label>
        <label>
          充电合计（分钟）
          <input v-model.number="form.charging" type="number" min="0" max="600" />
        </label>
      </div>
      <details class="trip-details">
        <summary>添加途经点</summary>
        <label>
          高德坐标，最多5个，用分号分隔
          <input v-model="form.waypoints" placeholder="120.1,30.2;120.3,30.4" />
        </label>
      </details>
      <button class="trip-button" :disabled="busy">查路线并计算车辆费用</button>
    </form>
    <div v-if="!routes.length" class="trip-empty">
      尚未查询路线。未知路费会保留为待确认，不自动填零。
    </div>
    <article v-for="route in routes" :key="route.id" class="drive-result">
      <div class="drive-stat">
        <strong>
          {{ (route.distanceMeters / 1000).toFixed(1) }}
          <small>公里</small>
        </strong>
        <strong>{{ minutes(route.totalMinutes) }}</strong>
        <strong>
          {{ money(route.knownVehicleMinor) }}
          <small>已知车辆总费</small>
        </strong>
      </div>
      <p>
        驾驶 {{ minutes(route.driveMinutes) }} · 休息 {{ route.restMinutes }}分钟 · 充电
        {{ route.chargingMinutes }}分钟
      </p>
      <p>
        人均：{{ money(route.perPersonMinor) }}
        {{ route.unknownCosts.length ? '（全程费用尚未齐全）' : '' }}
      </p>
      <ul>
        <li v-for="value in route.assumptions" :key="value">{{ value }}</li>
        <li v-for="value in route.unknownCosts" :key="value">待确认：{{ value }}</li>
        <li v-for="value in route.warnings" :key="value" class="trip-error">
          {{ value }}
        </li>
      </ul>
    </article>
  </section>
</template>
<style scoped>
/** 里程、耗时与车辆总费平行展示，未知费用保持文字提示。 */
.drive-result {
  border-top: 1px solid var(--line);
  padding: 25px 0;
  margin-top: 20px;
  font-size: 14px;
  line-height: 1.9;
}
.drive-stat {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
}
.drive-stat strong {
  font-size: 23px;
  color: var(--forest);
}
.drive-stat small {
  font-size: 13px;
  font-weight: 400;
}
.drive-result > p,
.drive-result li {
  color: var(--muted);
}
</style>
