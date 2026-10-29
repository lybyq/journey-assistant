<!-- 先看团期与条款，再看营销价格。 -->
<script setup lang="ts">
/** 人工资料保存在本地表单，提交后才写入项目。 */
import { reactive } from 'vue';
/** 产品和费用口径使用共享类型。 */
import type { TourProduct, TripRequest } from '@journey/contracts';
/** 人工报价始终保留manual来源。 */
import { manualCost, amountMinor } from '@/features/travel/factories';
/** 只显示后端或人工填写的确定金额。 */
import { money, priceLabel } from '@/features/travel/format';
/** 授权状态由后端能力接口提供。 */
const props = defineProps<{
  products: TourProduct[];
  request: TripRequest;
  busy: boolean;
  configured: boolean;
}>();
/** 查询与手工条款分别发送。 */
const emit = defineEmits<{ search: []; manual: [product: TourProduct] }>();
/** 所有可能影响总价的条款都提供明确字段。 */
const form = reactive({
  name: '',
  departureCity: props.request.origin ?? '',
  date: props.request.startDate ?? '',
  days: props.request.days ?? 1,
  hotel: props.request.hotelStandard ?? '',
  price: '',
  quantity: 1,
  priceType: 'advertised' as 'advertised' | 'estimate',
  url: '',
  included: '',
  excluded: '',
  shopping: '',
  optional: '',
  single: '',
  guide: '',
  pickup: '',
  cancellation: '',
  needs: '',
  covers: [] as ('transport' | 'lodging' | 'ticket' | 'meal' | 'insurance')[],
});
/** 多行条款保留独立项目，不用一段“全包”覆盖缺项。 */
const lines = (value: string) =>
  value
    .split(/\n|；/)
    .map((item) => item.trim())
    .filter(Boolean);
/** 手工产品默认不自动纳入预算，用户之后明确勾选。 */
function save() {
  const quote = manualCost(props.request, {
    label: form.name,
    category: 'tour',
    amount: form.price,
    quantity: Number(form.quantity),
    unit: 'person',
    priceType: form.priceType,
    sourceUrl: form.url,
    notes: '人工录入团产品，需核实指定团期、人数和最终强制费用',
  });
  quote.includes = form.covers;
  quote.conditions.startDate = form.date || null;
  emit('manual', {
    id: crypto.randomUUID(),
    name: form.name,
    departureCity: form.departureCity,
    departureDate: form.date || null,
    days: Number(form.days),
    hotelStandard: form.hotel || null,
    included: lines(form.included),
    excluded: lines(form.excluded),
    shoppingStops: lines(form.shopping),
    optionalActivities: lines(form.optional),
    singleSupplementMinor: amountMinor(form.single, props.request.budget.currency),
    guide: form.guide || null,
    pickup: form.pickup || null,
    cancellation: form.cancellation,
    quote,
    sourceUrl: form.url,
    evidenceIds: [],
    needsConfirmation: lines(form.needs),
    dailySchedule: [],
  });
}
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">READ THE FINE PRINT</span>
        <h2>跟团之前，把小字看清。</h2>
        <p>同名线路不一定是同一产品。团期、单房差、自费、购物和取消规则，与价格一起比较。</p>
      </div>
      <button class="trip-button" :disabled="busy || !configured" @click="emit('search')">
        查询授权团产品
      </button>
    </div>
    <p v-if="!configured" class="trip-callout">
      授权旅行团接口尚未配置。可以先录入有公开来源的产品条款；页面起价不会标成可订库存。
    </p>
    <div v-if="!products.length" class="trip-empty">
      尚无团产品。保留真实条款后，再与自由行、自驾方案比较同口径费用。
    </div>
    <article v-for="product in products" :key="product.id" class="tour-row">
      <div class="tour-heading">
        <div>
          <span class="trip-pill">
            {{ product.departureDate ?? '团期待确认' }} · {{ product.days }}天
          </span>
          <h3>{{ product.name }}</h3>
        </div>
        <div>
          <strong>{{ money(product.quote.unitAmountMinor, product.quote.currency) }}</strong>
          <small>
            {{ priceLabel(product.quote.priceType) }} · 每{{
              product.quote.unit === 'person' ? '人' : '项'
            }}
            × {{ product.quote.quantity }}
          </small>
        </div>
      </div>
      <p>
        {{ product.departureCity }}出发 ·
        {{ product.hotelStandard ?? '酒店标准待确认' }}
      </p>
      <div class="tour-terms">
        <div>
          <strong>包含</strong>
          <p v-for="item in product.included" :key="item">{{ item }}</p>
        </div>
        <div>
          <strong>不包含 / 自费</strong>
          <p v-for="item in [...product.excluded, ...product.optionalActivities]" :key="item">
            {{ item }}
          </p>
          <p>单房差：{{ money(product.singleSupplementMinor, product.quote.currency) }}</p>
        </div>
        <div>
          <strong>购物与退改</strong>
          <p>购物点：{{ product.shoppingStops.join('、') || '尚未提供' }}</p>
          <p>{{ product.cancellation || '取消规则待确认' }}</p>
        </div>
      </div>
      <ul class="trip-warnings">
        <li v-for="item in product.needsConfirmation" :key="item">
          {{ item }}
        </li>
      </ul>
      <a :href="product.sourceUrl" target="_blank" rel="noopener noreferrer">核对产品来源 ↗</a>
    </article>
    <details class="trip-details">
      <summary>录入有来源的旅行团条款</summary>
      <form class="trip-form" @submit.prevent="save">
        <div class="trip-form-grid">
          <label>
            产品名称
            <input v-model="form.name" required maxlength="300" />
          </label>
          <label>
            出发城市
            <input v-model="form.departureCity" required />
          </label>
          <label>
            指定团期
            <input v-model="form.date" type="date" />
          </label>
          <label>
            天数
            <input v-model.number="form.days" type="number" min="1" max="30" />
          </label>
          <label>
            酒店标准
            <input v-model="form.hotel" maxlength="100" />
          </label>
          <label>
            每人价格（留空为未知）
            <input v-model="form.price" inputmode="decimal" />
          </label>
          <label>
            计价人数
            <input v-model.number="form.quantity" type="number" min="1" max="30" required />
          </label>
          <label>
            价格性质
            <select v-model="form.priceType">
              <option value="advertised">页面起价</option>
              <option value="estimate">明确估算</option>
            </select>
          </label>
          <label>
            单房差（未知留空）
            <input v-model="form.single" />
          </label>
          <label>
            导游服务
            <input v-model="form.guide" maxlength="200" />
          </label>
          <label>
            接送说明
            <input v-model="form.pickup" maxlength="500" />
          </label>
          <label>
            公共来源链接
            <input v-model="form.url" type="url" required />
          </label>
        </div>
        <div class="trip-form-grid">
          <label>
            包含项（每行一项）
            <textarea v-model="form.included" rows="3"></textarea>
          </label>
          <label>
            不包含项（每行一项）
            <textarea v-model="form.excluded" rows="3"></textarea>
          </label>
          <label>
            自费项目（每行一项）
            <textarea v-model="form.optional" rows="3"></textarea>
          </label>
          <label>
            购物点（没有也请明确写无）
            <textarea v-model="form.shopping" rows="3"></textarea>
          </label>
        </div>
        <fieldset class="trip-checks">
          <legend>包价明确覆盖的费用类别（避免重复累计）</legend>
          <label
            v-for="item in [
              { id: 'transport', label: '交通' },
              { id: 'lodging', label: '住宿' },
              { id: 'ticket', label: '门票' },
              { id: 'meal', label: '餐饮' },
              { id: 'insurance', label: '保险' },
            ]"
            :key="item.id"
            class="trip-check"
          >
            <input v-model="form.covers" type="checkbox" :value="item.id" />
            {{ item.label }}
          </label>
        </fieldset>
        <label>
          取消与退款
          <textarea v-model="form.cancellation" rows="2" maxlength="1500"></textarea>
        </label>
        <label>
          还需确认的条件
          <textarea v-model="form.needs" rows="2"></textarea>
        </label>
        <button class="trip-button secondary" :disabled="busy">保存人工产品条款</button>
      </form>
    </details>
  </section>
</template>
<style scoped>
/** 产品价格与条款同屏，弱化“低价”营销权重。 */
.tour-row {
  padding: 26px 0;
  border-bottom: 1px solid var(--line);
}
.tour-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.tour-heading h3 {
  font-size: 23px;
  margin: 12px 0;
  color: var(--forest);
}
.tour-heading > div:last-child {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tour-heading > div:last-child strong {
  font-size: 25px;
}
.tour-heading small,
.tour-row p {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.9;
}
.tour-terms {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin: 24px 0;
}
.tour-terms strong {
  font-size: 14px;
}
.tour-row > a {
  font-size: 13px;
  color: var(--forest);
}
@media (max-width: 700px) {
  .tour-terms {
    grid-template-columns: 1fr;
  }
}
</style>
