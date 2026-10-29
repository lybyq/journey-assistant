<!-- 地点、营业、预约与酒店报价分别确认。 -->
<script setup lang="ts">
/** 编辑草稿不直接改父组件资料。 */
import { reactive, shallowRef } from 'vue';
/** 所有候选数据由共享schema约束。 */
import type { Experience, Evidence, TripRequest } from '@journey/contracts';
/** 价格显示不进行业务计算。 */
import { money, priceLabel } from '@/features/travel/format';
/** 资料检索证据可绑定到手工核实的营业条件。 */
const props = defineProps<{
  entries: Experience[];
  sources: Evidence[];
  request: TripRequest;
  busy: boolean;
  hotelConfigured: boolean;
}>();
/** 三种业务动作独立发出。 */
const emit = defineEmits<{
  search: [input: any];
  hotels: [input: any];
  manual: [input: Experience];
}>();
/** 搜索地点和查酒店库存采用不同条件。 */
const search = reactive({
  keywords: '',
  city: props.request.destination ?? '',
  kind: 'attraction',
});
const code = shallowRef('');
const error = shallowRef('');
/** 手工资料可补齐开放、预约与无障碍信息，但不能伪装官方认证。 */
const form = reactive({
  name: '',
  kind: 'attraction',
  address: '',
  lng: '',
  lat: '',
  opening: '',
  closed: '',
  reservation: 'unknown',
  accessible: 'unknown',
  childPolicy: '',
  cancellation: '',
  notes: '',
  evidenceIds: [] as string[],
});
/** 时间段采用“星期,开始,结束”，提交前仍让后端严格核验。 */
function manual() {
  error.value = '';
  try {
    const entry: Experience = {
      id: crypto.randomUUID(),
      kind: form.kind as Experience['kind'],
      name: form.name,
      address: form.address,
      point:
        form.lng && form.lat
          ? {
              lng: Number(form.lng),
              lat: Number(form.lat),
              coordinateSystem: 'GCJ-02',
            }
          : null,
      opening: form.opening.trim()
        ? form.opening
            .trim()
            .split('\n')
            .map((value) => {
              const [day, open, close] = value.split(/[,，]/).map((part) => part.trim());
              return {
                dayOfWeek: Number(day),
                open: open ?? '',
                close: close ?? '',
              };
            })
        : [],
      closedDates: form.closed.split(/[,，\s]+/).filter(Boolean),
      reservation: form.reservation as Experience['reservation'],
      accessible: form.accessible === 'unknown' ? null : form.accessible === 'yes',
      childPolicy: form.childPolicy,
      cancellation: form.cancellation,
      breakfastIncluded: null,
      evidenceIds: form.evidenceIds,
      quote: null,
      notes: form.notes,
    };
    emit('manual', entry);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '资料格式错误';
  }
}
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">STAY & EXPLORE</span>
        <h2>住得合适，也玩得从容。</h2>
        <p>地图能确认位置，开放、预约和具体房型价格需要另行核实。未知信息始终保留。</p>
      </div>
    </div>
    <form class="trip-inline-form" @submit.prevent="emit('search', { ...search })">
      <input
        v-model="search.city"
        aria-label="地点城市"
        placeholder="城市"
        required
        maxlength="80"
      />
      <input
        v-model="search.keywords"
        aria-label="地点关键词"
        placeholder="景点、酒店或餐馆名称"
        required
        maxlength="120"
      />
      <select v-model="search.kind" aria-label="地点类别">
        <option value="attraction">景点</option>
        <option value="hotel">酒店</option>
        <option value="restaurant">餐馆</option>
      </select>
      <button class="trip-button" :disabled="busy">查地点</button>
    </form>
    <details class="trip-details">
      <summary>查指定日期酒店报价 {{ hotelConfigured ? '' : '· 未配置授权接口' }}</summary>
      <p>
        读取需求中的入住日期、晚数、房间数和成人儿童。当前接口对复杂儿童/分房条件会要求另行确认。
      </p>
      <form class="trip-inline-form" @submit.prevent="emit('hotels', { cityCode: code })">
        <input
          v-model="code"
          placeholder="酒店城市IATA代码，例如SHA"
          pattern="[A-Z]{3}"
          required
          aria-label="酒店城市代码"
        />
        <button class="trip-button secondary" :disabled="busy || !hotelConfigured">
          查授权酒店报价
        </button>
      </form>
    </details>
    <div v-if="!entries.length" class="trip-empty">
      先搜索真实地点，或录入已核实的开放与预约资料。
    </div>
    <article v-for="entry in entries" :key="entry.id" class="place-row">
      <div>
        <span class="trip-pill">
          {{ entry.kind === 'hotel' ? '酒店' : entry.kind === 'restaurant' ? '餐饮' : '游玩' }}
        </span>
        <h3>{{ entry.name }}</h3>
        <p>{{ entry.address || '地址待确认' }}</p>
      </div>
      <div class="place-facts">
        <span>{{ entry.point ? '已获得地图位置' : '位置待确认' }}</span>
        <span>{{ entry.opening.length ? '有开放时段' : '开放时间待核实' }}</span>
        <span>
          {{
            entry.reservation === 'required'
              ? '需要预约'
              : entry.reservation === 'not_required'
                ? '已确认无需预约'
                : '预约规则未知'
          }}
        </span>
        <span>
          无障碍：{{ entry.accessible === null ? '未知' : entry.accessible ? '支持' : '不支持' }}
        </span>
      </div>
      <p v-if="entry.quote">
        <strong>{{ money(entry.quote.unitAmountMinor, entry.quote.currency) }}</strong>
        × {{ entry.quote.quantity }} · {{ priceLabel(entry.quote.priceType) }} ·
        {{ entry.quote.notes }}
      </p>
      <details class="trip-details">
        <summary>条款与依据</summary>
        <p>儿童政策：{{ entry.childPolicy || '待确认' }}</p>
        <p>退改：{{ entry.cancellation || '待确认' }}</p>
        <p>{{ entry.notes }}</p>
        <p v-for="window in entry.opening" :key="`${window.dayOfWeek}-${window.open}`">
          星期{{ window.dayOfWeek }} {{ window.open }}–{{ window.close }}
        </p>
        <p>闭园日期：{{ entry.closedDates.join('、') || '尚未提供' }}</p>
      </details>
    </article>
    <details class="trip-details">
      <summary>录入已核实地点与开放条件</summary>
      <p>可把查询过的地点另存为核实候选，保留原始候选供旧版本追溯。</p>
      <form class="trip-form" @submit.prevent="manual">
        <div class="trip-form-grid">
          <label>
            名称
            <input v-model="form.name" required maxlength="300" />
          </label>
          <label>
            类别
            <select v-model="form.kind">
              <option value="attraction">景点</option>
              <option value="hotel">酒店</option>
              <option value="restaurant">餐馆</option>
            </select>
          </label>
          <label>
            地址
            <input v-model="form.address" maxlength="300" />
          </label>
          <label>
            经度
            <input v-model="form.lng" type="number" step="any" />
          </label>
          <label>
            纬度
            <input v-model="form.lat" type="number" step="any" />
          </label>
          <label>
            预约要求
            <select v-model="form.reservation">
              <option value="unknown">未知</option>
              <option value="required">需要预约</option>
              <option value="not_required">无需预约</option>
            </select>
          </label>
          <label>
            无障碍
            <select v-model="form.accessible">
              <option value="unknown">未知</option>
              <option value="yes">支持</option>
              <option value="no">不支持</option>
            </select>
          </label>
          <label>
            闭园日期
            <input v-model="form.closed" placeholder="2026-11-01，2026-11-02" />
          </label>
        </div>
        <label>
          开放时段（0为周日；每天一行：星期,开始,结束）
          <textarea
            v-model="form.opening"
            rows="3"
            placeholder="1,09:00,17:00&#10;2,09:00,17:00"
          ></textarea>
        </label>
        <div class="trip-form-grid">
          <label>
            儿童政策
            <input v-model="form.childPolicy" maxlength="1000" />
          </label>
          <label>
            取消条款
            <input v-model="form.cancellation" maxlength="1500" />
          </label>
        </div>
        <label>
          备注
          <textarea v-model="form.notes" rows="2" maxlength="1500"></textarea>
        </label>
        <fieldset class="trip-checks">
          <legend>关联本项目证据</legend>
          <label v-for="source in sources" :key="source.id" class="trip-check">
            <input v-model="form.evidenceIds" type="checkbox" :value="source.id" />
            {{ source.title }}
          </label>
          <span v-if="!sources.length">先到资料检索添加来源</span>
        </fieldset>
        <p v-if="error" class="trip-error">{{ error }}</p>
        <button class="trip-button secondary" :disabled="busy">另存核实候选</button>
      </form>
    </details>
  </section>
</template>
<style scoped>
/** 地点信息以编辑目录排布，条款按需展开。 */
.place-row {
  padding: 22px 0;
  border-bottom: 1px solid var(--line);
}
.place-row h3 {
  font-size: 20px;
  margin: 12px 0 8px;
  color: var(--forest);
}
.place-row p {
  font-size: 14px;
  line-height: 1.9;
  color: var(--muted);
}
.place-facts {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--forest);
  margin: 14px 0;
}
</style>
