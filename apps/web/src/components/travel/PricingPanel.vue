<!-- 费用选择、人工报价与汇率输入；所有总和来自后端。 -->
<script setup lang="ts">
/** 本地表单状态与已保存预算分开。 */
import { reactive, shallowRef, watch } from 'vue';
/** 预算与报价类型共用。 */
import type { TripWorkspace, CostBreakdown, CostItem, ExchangeRate } from '@journey/contracts';
/** 金额文本转最小单位与人工来源保持一致。 */
import { manualCost } from '@/features/travel/factories';
/** 只格式化后端计算结果。 */
import { money, priceLabel } from '@/features/travel/format';
/** 整个聚合是只读props，组件不能直接更改费用。 */
const props = defineProps<{
  workspace: TripWorkspace;
  budget: CostBreakdown | null;
  busy: boolean;
}>();
/** 明确选择、新增与汇率保存动作。 */
const emit = defineEmits<{
  toggle: [id: string, selected: boolean];
  calculate: [];
  add: [item: CostItem];
  save: [rates: ExchangeRate[], reserveBps: number];
}>();
/** 新费用来源始终manual，未填写金额时保留unknown。 */
const form = reactive({
  label: '',
  category: 'meal' as CostItem['category'],
  amount: '',
  quantity: 1,
  unit: 'trip' as CostItem['unit'],
  priceType: 'estimate' as 'estimate' | 'advertised' | 'unknown',
  url: '',
  notes: '',
  selected: true,
});
/** 汇率必须有来源与有效期，不能默认跨币种1:1。 */
const rate = reactive({
  from: 'USD',
  to: props.workspace.document.request.budget.currency,
  rate: '',
  source: '',
  url: '',
  validUntil: '',
  kind: 'reference',
});
const reserve = shallowRef(10);
const localError = shallowRef('');
/** 保存后按真实预备金比例恢复草稿。 */
watch(
  () => props.workspace.document.reserveBps,
  (value) => {
    reserve.value = value / 100;
  },
  { immediate: true },
);
/** 每条费用都带完整旅行条件，后端会再次检查来源身份。 */
function add() {
  emit(
    'add',
    manualCost(props.workspace.document.request, {
      ...form,
      sourceUrl: form.url,
    }),
  );
}
/** 汇率新增不能覆盖过去来源，完整记录用于复算。 */
function saveRate() {
  localError.value = '';
  try {
    const value: ExchangeRate = {
      from: rate.from as ExchangeRate['from'],
      to: rate.to as ExchangeRate['to'],
      rate: rate.rate,
      source: rate.source,
      sourceUrl: rate.url,
      checkedAt: new Date().toISOString(),
      validUntil: new Date(rate.validUntil).toISOString(),
      kind: rate.kind as ExchangeRate['kind'],
    };
    emit('save', [...props.workspace.document.rates, value], Math.round(reserve.value * 100));
  } catch {
    localError.value = '请填写有效的汇率到期时间';
  }
}
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">THE REAL NUMBERS</span>
        <h2>每一笔，都算得明白。</h2>
        <p>勾选要纳入方案的费用。已包含项会排除重复，未知价格不会按零元计入。</p>
      </div>
      <button class="trip-button secondary" :disabled="busy" @click="emit('calculate')">
        重新计算
      </button>
    </div>
    <div v-if="budget" class="budget-summary">
      <div>
        <span>{{ budget.complete ? '费用合计' : '已知费用小计' }}</span>
        <strong>{{ money(budget.knownTotalMinor, budget.currency) }}</strong>
      </div>
      <div>
        <span>预备金</span>
        <strong>{{ money(budget.reserveMinor, budget.currency) }}</strong>
      </div>
      <div>
        <span>含预备金 {{ budget.complete ? '总计' : '小计' }}</span>
        <strong>{{ money(budget.totalWithReserveMinor, budget.currency) }}</strong>
      </div>
      <div>
        <span>人均分摊上限</span>
        <strong>{{ money(budget.perPersonMinor, budget.currency) }}</strong>
      </div>
    </div>
    <ul v-if="budget?.issues.length" class="trip-warnings">
      <li v-for="issue in budget.issues" :key="issue">{{ issue }}</li>
    </ul>
    <div v-if="!workspace.document.costs.length" class="trip-empty">
      尚无费用项。查询供应商或录入有依据的人工估算。
    </div>
    <!-- 费用性质与条件在每行都可核对。 -->
    <article v-for="item in workspace.document.costs" :key="item.id" class="cost-row">
      <label class="trip-check">
        <input
          type="checkbox"
          :checked="item.selected"
          :disabled="busy"
          @change="emit('toggle', item.id, ($event.target as HTMLInputElement).checked)"
        />
        <strong>{{ item.label }}</strong>
      </label>
      <div class="cost-number">
        <span>{{ money(item.unitAmountMinor, item.currency) }} × {{ item.quantity }}</span>
        <small class="trip-pill">{{ priceLabel(item.priceType) }}</small>
      </div>
      <details class="trip-details">
        <summary>查看计价条件与来源</summary>
        <p>
          单位：{{ item.unit }} · 来源：{{ item.provider }} · 查询：{{
            new Date(item.checkedAt).toLocaleString('zh-CN')
          }}
        </p>
        <p>
          日期：{{ item.conditions.startDate ?? '未知' }} ～
          {{ item.conditions.endDate ?? '未知' }} · 成人{{ item.conditions.adults ?? '未知' }} /
          儿童{{ item.conditions.children ?? '未知' }} · 房间{{ item.conditions.rooms ?? '未知' }} ·
          {{ item.conditions.nights ?? '未知' }}晚
        </p>
        <p>
          覆盖费用：{{ item.includes.join('、') || '无额外包价包含项' }} · 强制税费：{{
            item.conditions.mandatoryFeesIncluded === true
              ? '已含'
              : item.conditions.mandatoryFeesIncluded === false
                ? '未全含'
                : '未确认'
          }}
        </p>
        <p>{{ item.notes }}</p>
        <a v-if="item.sourceUrl" :href="item.sourceUrl" target="_blank" rel="noopener noreferrer">
          核对价格来源 ↗
        </a>
      </details>
    </article>
    <div class="trip-inline-form">
      <label>
        预备金比例（%）
        <input v-model.number="reserve" type="number" min="0" max="50" step="0.1" />
      </label>
      <button
        class="trip-button secondary"
        :disabled="busy"
        @click="emit('save', workspace.document.rates, Math.round(reserve * 100))"
      >
        保存预备金
      </button>
    </div>
    <details class="trip-details">
      <summary>新增人工估算 / 页面价格</summary>
      <form class="trip-form" @submit.prevent="add">
        <div class="trip-form-grid">
          <label>
            费用名称
            <input v-model="form.label" required maxlength="300" />
          </label>
          <label>
            分类
            <select v-model="form.category">
              <option
                v-for="item in [
                  { id: 'transport', label: '交通' },
                  { id: 'lodging', label: '住宿' },
                  { id: 'ticket', label: '门票' },
                  { id: 'meal', label: '餐饮' },
                  { id: 'driving', label: '车辆' },
                  { id: 'tour', label: '团费' },
                  { id: 'insurance', label: '保险' },
                  { id: 'other', label: '其他' },
                ]"
                :key="item.id"
                :value="item.id"
              >
                {{ item.label }}
              </option>
            </select>
          </label>
          <label>
            单价（{{ workspace.document.request.budget.currency }}，未知留空）
            <input v-model="form.amount" inputmode="decimal" />
          </label>
          <label>
            数量
            <input v-model.number="form.quantity" type="number" min="1" max="10000" required />
          </label>
          <label>
            计价单位
            <select v-model="form.unit">
              <option value="trip">全程 / 项</option>
              <option value="person">每人</option>
              <option value="room_night">每间每晚</option>
              <option value="vehicle">每辆</option>
              <option value="ticket">每张</option>
              <option value="meal">每餐</option>
            </select>
          </label>
          <label>
            价格性质
            <select v-model="form.priceType">
              <option value="estimate">明确估算</option>
              <option value="advertised">页面起价</option>
              <option value="unknown">未知</option>
            </select>
          </label>
          <label>
            公共来源链接（可选）
            <input v-model="form.url" type="url" />
          </label>
        </div>
        <label>
          估算假设、税费和适用条件
          <textarea
            v-model="form.notes"
            required
            rows="2"
            maxlength="1500"
            placeholder="例如：本人愿意按每人每天100元餐费预留，不是餐馆实时报价"
          ></textarea>
        </label>
        <label class="trip-check">
          <input v-model="form.selected" type="checkbox" />
          保存后计入当前预算
        </label>
        <button class="trip-button secondary" :disabled="busy">保存人工费用</button>
      </form>
    </details>
    <details class="trip-details">
      <summary>跨币种汇率与来源</summary>
      <p v-for="(value, index) in workspace.document.rates" :key="index">
        {{ value.from }} → {{ value.to }} · {{ value.rate }} · {{ value.source }} ·
        {{ value.kind === 'estimate' ? '估算' : '参考汇率' }} · 到期{{
          new Date(value.validUntil).toLocaleString('zh-CN')
        }}
      </p>
      <form class="trip-form" @submit.prevent="saveRate">
        <div class="trip-form-grid">
          <label>
            来源币种
            <select v-model="rate.from">
              <option
                v-for="currency in ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY']"
                :key="currency"
              >
                {{ currency }}
              </option>
            </select>
          </label>
          <label>
            目标币种
            <select v-model="rate.to">
              <option
                v-for="currency in ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY']"
                :key="currency"
              >
                {{ currency }}
              </option>
            </select>
          </label>
          <label>
            汇率
            <input v-model="rate.rate" required placeholder="最多8位小数" />
          </label>
          <label>
            来源名称
            <input v-model="rate.source" required />
          </label>
          <label>
            来源链接
            <input v-model="rate.url" type="url" required />
          </label>
          <label>
            有效截止
            <input v-model="rate.validUntil" type="datetime-local" required />
          </label>
          <label>
            性质
            <select v-model="rate.kind">
              <option value="reference">有来源的参考值</option>
              <option value="estimate">估算</option>
            </select>
          </label>
        </div>
        <p v-if="localError" class="trip-error">{{ localError }}</p>
        <button class="trip-button secondary" :disabled="busy">保存汇率并重算</button>
      </form>
    </details>
  </section>
</template>
<style scoped>
/** 整数总额占据主视觉，其下保留每一项计算口径。 */
.budget-summary {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
  padding: 25px 0 30px;
  border-bottom: 1px solid var(--line);
}
.budget-summary > div {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.budget-summary span {
  font-size: 13px;
  color: var(--muted);
}
.budget-summary strong {
  font-size: 25px;
  color: var(--forest);
}
.cost-row {
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.cost-number {
  display: flex;
  gap: 15px;
  align-items: center;
  margin: 12px 0 0 24px;
  font-size: 16px;
}
.cost-row p {
  font-size: 13px;
  line-height: 1.9;
  color: var(--muted);
}
.cost-row a {
  font-size: 13px;
  color: var(--forest);
}
</style>
