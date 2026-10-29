<!-- 本地表单只编辑草稿，保存时一次性提交明确字段。 -->
<script setup lang="ts">
/** 表单需要深层响应性；网络反馈用浅引用。 */
import { reactive, shallowRef, watch } from 'vue';
/** 字段类型直接复用共享契约。 */
import {
  tripRequestSchema,
  type TripRequest,
  type TripRequestPatch,
  type TripWorkspace,
} from '@journey/contracts';
/** 只有父组件知道网络与账户，表单通过事件保存。 */
const props = defineProps<{
  request: TripRequest;
  clarifications: TripWorkspace['clarifications'];
  busy: boolean;
  parse: (text: string) => Promise<{ request: TripRequest }>;
}>();
/** 明确保存意图，不直接修改props。 */
const emit = defineEmits<{ save: [patch: TripRequestPatch] }>();
/** 数值表单可留空，空字符串在保存时转null而不是0。 */
const form = reactive(tripRequestSchema.parse({}));
const text = shallowRef('');
const parseError = shallowRef('');
const parsing = shallowRef(false);
const min = shallowRef('');
const max = shallowRef('');
const ages = shallowRef('');
const must = shallowRef('');
const dietary = shallowRef('');
/** 项目切换或保存后同步新快照，避免跨项目保留草稿。 */
watch(
  () => props.request,
  (value) => {
    Object.assign(form, JSON.parse(JSON.stringify(value)));
    const scale = value.budget.currency === 'JPY' ? 1 : 100;
    min.value = value.budget.minMinor === null ? '' : String(value.budget.minMinor / scale);
    max.value = value.budget.maxMinor === null ? '' : String(value.budget.maxMinor / scale);
    ages.value = value.childAges.join('、');
    must.value = value.mustVisit.join('、');
    dietary.value = value.dietary.join('、');
  },
  { immediate: true },
);
/** 自然语言提取先填草稿，必须由用户保存才进入真实需求。 */
async function extract() {
  parsing.value = true;
  parseError.value = '';
  try {
    const result = await props.parse(text.value);
    Object.assign(form, result.request);
    min.value =
      result.request.budget.minMinor === null ? '' : String(result.request.budget.minMinor / 100);
    max.value =
      result.request.budget.maxMinor === null ? '' : String(result.request.budget.maxMinor / 100);
    ages.value = result.request.childAges.join('、');
  } catch (cause) {
    parseError.value = cause instanceof Error ? cause.message : '提取失败';
  } finally {
    parsing.value = false;
  }
}
/** 将元文本精确转为分；后端还会再次校验范围与口径。 */
function amount(value: string): number | null {
  if (
    value.trim() &&
    !(form.budget.currency === 'JPY' ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(value)
  )
    return Number.NaN;
  if (!value.trim()) return null;
  const [whole, fraction = ''] = value.split('.');
  return form.budget.currency === 'JPY'
    ? Number(whole)
    : Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}
/** 空输入保留未知，不能把未确认人数静默填成事实。 */
function save() {
  if (Number.isNaN(amount(min.value)) || Number.isNaN(amount(max.value))) {
    parseError.value = '金额精度不合法：日元为整数，其他币种最多两位小数';
    return;
  }
  const payload: TripRequestPatch = JSON.parse(JSON.stringify(form));
  for (const field of [
    'days',
    'nights',
    'adults',
    'children',
    'seniors',
    'rooms',
    'vehicles',
    'maxWalkMinutes',
    'maxDriveMinutes',
  ] as const) {
    const value = (payload as Record<string, unknown>)[field];
    (payload as Record<string, unknown>)[field] =
      value === '' || value === null ? null : Number(value);
  }
  payload.origin = form.origin?.trim() || null;
  payload.destination = form.destination?.trim() || null;
  payload.startDate = form.startDate || null;
  payload.endDate = null;
  payload.destinationTimeZone = form.destinationTimeZone?.trim() || null;
  payload.childAges = ages.value
    ? ages.value
        .split(/[,，、\s]+/)
        .filter(Boolean)
        .map(Number)
    : [];
  payload.mustVisit = must.value
    .split(/[,，、\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  payload.dietary = dietary.value
    .split(/[,，、\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  payload.budget = {
    ...form.budget,
    minMinor: amount(min.value),
    maxMinor: amount(max.value),
  };
  emit('save', payload);
}
</script>
<template>
  <!-- 标题与需求追问均来自真实已保存状态。 -->
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">TRAVEL BRIEF</span>
        <h2>先把这一程，说清楚。</h2>
        <p>不知道的先留空。日期、人数和预算，将成为后续比价与行程验证的共同条件。</p>
      </div>
    </div>
    <!-- 提取不等于确认，用户仍能逐项修订。 -->
    <div class="trip-parse">
      <textarea
        v-model="text"
        aria-label="自然语言旅行需求"
        rows="2"
        placeholder="例如：明天从杭州去苏州，两大一小，三天两晚，人均预算3000元，自由行"
      ></textarea>
      <button
        class="trip-button secondary"
        :disabled="!text.trim() || parsing || busy"
        @click="extract"
      >
        {{ parsing ? '正在提取…' : '提取到表单' }}
      </button>
    </div>
    <p v-if="parseError" class="trip-error">{{ parseError }}</p>
    <!-- 主条件采用紧凑表单，进阶偏好折叠。 -->
    <form class="trip-form" @submit.prevent="save">
      <div class="trip-form-grid">
        <label>
          出发地
          <input v-model="form.origin" placeholder="例如：杭州" maxlength="80" />
        </label>
        <label>
          目的地
          <input v-model="form.destination" placeholder="例如：苏州" maxlength="120" />
        </label>
        <label>
          出发日期
          <input v-model="form.startDate" type="date" />
        </label>
        <label>
          旅行天数
          <input v-model="form.days" type="number" min="1" max="30" placeholder="待确认" />
        </label>
        <label>
          住宿晚数
          <input v-model="form.nights" type="number" min="0" max="29" placeholder="待确认" />
        </label>
        <label>
          成人
          <input v-model="form.adults" type="number" min="1" max="20" placeholder="待确认" />
        </label>
        <label>
          儿童
          <input v-model="form.children" type="number" min="0" max="10" placeholder="没有请填0" />
        </label>
        <label>
          儿童年龄
          <input v-model="ages" placeholder="例如：6、10" />
        </label>
        <label>
          房间数
          <input v-model="form.rooms" type="number" min="1" max="10" placeholder="待确认" />
        </label>
        <label>
          出行方式
          <select v-model="form.mode">
            <option :value="null">待确认</option>
            <option value="independent">自由行</option>
            <option value="driving">自驾游</option>
            <option value="group">跟团游</option>
          </select>
        </label>
        <label>
          目的地时区
          <input v-model="form.destinationTimeZone" placeholder="国内：Asia/Shanghai" />
        </label>
        <label>
          住宿标准
          <input v-model="form.hotelStandard" placeholder="例如：舒适型双床房" />
        </label>
        <label>
          预算口径
          <select v-model="form.budget.scope">
            <option value="total">全程总预算</option>
            <option value="per_person">每人预算</option>
          </select>
        </label>
        <label>
          币种
          <select v-model="form.budget.currency">
            <option v-for="currency in ['CNY', 'USD', 'EUR', 'GBP', 'HKD', 'JPY']" :key="currency">
              {{ currency }}
            </option>
          </select>
        </label>
        <label>
          预算下限
          <input v-model="min" inputmode="decimal" placeholder="可不填" />
        </label>
        <label>
          预算上限
          <input v-model="max" inputmode="decimal" placeholder="待确认" />
        </label>
      </div>
      <details class="trip-details">
        <summary>节奏、老人、车辆与其他偏好</summary>
        <div class="trip-form-grid">
          <label>
            旅行节奏
            <select v-model="form.pace">
              <option :value="null">待确认</option>
              <option value="relaxed">慢慢走</option>
              <option value="balanced">适中</option>
              <option value="intensive">紧凑</option>
            </select>
          </label>
          <label>
            老人（成人子集）
            <input v-model="form.seniors" type="number" min="0" max="20" />
          </label>
          <label>
            车辆数量
            <input v-model="form.vehicles" type="number" min="1" max="10" />
          </label>
          <label>
            每日步行上限（分钟）
            <input v-model="form.maxWalkMinutes" type="number" min="10" max="600" />
          </label>
          <label>
            每日驾驶上限（分钟）
            <input v-model="form.maxDriveMinutes" type="number" min="30" max="600" />
          </label>
          <label>
            行动条件
            <select v-model="form.mobility">
              <option :value="null">待确认</option>
              <option value="normal">普通步行</option>
              <option value="limited">步行受限</option>
              <option value="wheelchair">轮椅通行</option>
            </select>
          </label>
          <label>
            饮食要求
            <input v-model="dietary" placeholder="多个条件用顿号分隔" />
          </label>
          <label>
            必去地点
            <input v-model="must" placeholder="多个地点用顿号分隔" />
          </label>
        </div>
        <label class="trip-full">
          其他约束
          <textarea v-model="form.notes" rows="2" maxlength="2000"></textarea>
        </label>
      </details>
      <div class="trip-actions">
        <button class="trip-button" type="submit" :disabled="busy">保存旅行需求</button>
        <span>保存后更新比较口径；旧方案版本会保留。</span>
      </div>
    </form>
    <!-- 澄清列表不隐藏缺失条件。 -->
    <div v-if="clarifications.length" class="trip-callout">
      <strong>还需要确认</strong>
      <ul>
        <li v-for="item in clarifications" :key="item.field">
          {{ item.question }}
          <small>{{ item.required ? '关键条件' : '补充信息' }}</small>
        </li>
      </ul>
    </div>
  </section>
</template>
