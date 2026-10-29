<!-- 逐日时间轴、验证结论、局部调整与版本比较。 -->
<script setup lang="ts">
/** 编辑草稿与比较选择本地管理。 */
import { computed, reactive, shallowRef } from 'vue';
/** 方案对象来自共享校验后的结果。 */
import type { PlanVersion, TripWorkspace, ScheduleItem } from '@journey/contracts';
/** 金额和时刻只做展示格式化。 */
import { money, clock, planStatus } from '@/features/travel/format';
/** 地图是独立纯呈现组件。 */
import RouteMap from './RouteMap.vue';
/** 父组件持有唯一版本和网络状态。 */
const props = defineProps<{
  workspace: TripWorkspace;
  version: PlanVersion | null;
  comparison: any;
  busy: boolean;
}>();
/** 编辑、初排和版本切换均经过后端。 */
const emit = defineEmits<{
  generate: [input: any];
  select: [id: string];
  replace: [input: any];
  activate: [id: string];
  compare: [ids: string[]];
}>();
/** 仅用户勾选的候选进入自动初排。 */
const transportIds = shallowRef<string[]>([]);
const drivingId = shallowRef('');
const hotelId = shallowRef('');
const tourId = shallowRef('');
const selected = shallowRef<string[]>([]);
const compareIds = shallowRef<string[]>([]);
const mode = shallowRef(props.workspace.document.request.mode ?? 'independent');
const title = shallowRef('我的旅行方案');
const editing = shallowRef<string | null>(null);
const edit = reactive({
  title: '',
  start: '09:00',
  end: '10:30',
  notes: '',
  reservation: false,
  referenceId: '',
});
/** 地图只展示当前版本活动，而不是随意取最新查询路线。 */
const points = computed(
  () =>
    props.version?.draft.days.flatMap((day) =>
      day.items
        .filter((item) => item.point)
        .map((item) => ({ name: item.title, point: item.point! })),
    ) ?? [],
);
/** 只有该版本引用的驾驶路线才显示实际折线。 */
const path = computed(() => {
  const ids = new Set(
    props.version?.draft.days.flatMap((day) =>
      day.items.flatMap((item) => (item.referenceId ? [item.referenceId] : [])),
    ),
  );
  return props.workspace.document.driving.find((route) => ids.has(route.id))?.path ?? [];
});
/** 首次编辑从真实活动初始化，不能在本地静默修改已保存版本。 */
function begin(item: ScheduleItem) {
  editing.value = item.id;
  edit.title = item.title;
  edit.start = clock(item.startMinute);
  edit.end = clock(item.endMinute);
  edit.notes = item.notes;
  edit.reservation = item.reservationConfirmed === true;
  edit.referenceId = item.referenceId ?? '';
}
/** 新版本引用替换地点的真实坐标和费用，不沿用旧地点假坐标。 */
function replace(item: ScheduleItem) {
  if (!props.version) return;
  const value = (text: string) => {
    const [hour, minute] = text.split(':').map(Number);
    return hour! * 60 + minute!;
  };
  const place = props.workspace.document.experiences.find((entry) => entry.id === edit.referenceId);
  const replacement = {
    ...item,
    title: place?.name ?? edit.title,
    startMinute: value(edit.start),
    endMinute: value(edit.end),
    notes: edit.notes,
    reservationConfirmed: edit.reservation,
    referenceId: place?.id ?? item.referenceId,
    point: place?.point ?? item.point,
    evidenceIds: place?.evidenceIds ?? item.evidenceIds,
    costIds: place ? (place.quote ? [place.quote.id] : []) : item.costIds,
  };
  emit('replace', {
    baseVersionId: props.version.id,
    itemId: item.id,
    replacement,
    reason: '用户局部调整时间或候选地点',
  });
  editing.value = null;
}
/** 初排使用已勾选预算，不自动选中所有酒店和交通候选。 */
function generate() {
  emit('generate', {
    mode: mode.value,
    title: title.value,
    experienceIds: selected.value,
    transportIds: transportIds.value,
    drivingId: drivingId.value || null,
    hotelId: hotelId.value || null,
    tourId: tourId.value || null,
    costIds: props.workspace.document.costs.filter((item) => item.selected).map((item) => item.id),
  });
}
</script>
<template>
  <section class="trip-panel">
    <div class="trip-section-heading">
      <div>
        <span class="trip-eyebrow">A PLAN THAT HOLDS UP</span>
        <h2>安排每一天，也留一点余地。</h2>
        <p>地点、交通和预算共同组成草案。每次调整都会另存版本，重新核对时间、距离与限制。</p>
      </div>
    </div>
    <form class="trip-form" @submit.prevent="generate">
      <div class="trip-inline-form">
        <input v-model="title" aria-label="行程方案名称" maxlength="300" required />
        <select v-model="mode" aria-label="行程方式">
          <option value="independent">自由行方案</option>
          <option value="driving">自驾方案</option>
          <option value="group">跟团方案</option>
        </select>
        <button class="trip-button" :disabled="busy">生成并验证新版本</button>
      </div>
      <div class="trip-form-grid">
        <label>
          选择入住酒店
          <select v-model="hotelId">
            <option value="">尚未确认</option>
            <option
              v-for="entry in workspace.document.experiences.filter(
                (item) => item.kind === 'hotel',
              )"
              :key="entry.id"
              :value="entry.id"
            >
              {{ entry.name }}
            </option>
          </select>
        </label>
        <label v-if="mode === 'driving'">
          绑定真实自驾路线
          <select v-model="drivingId">
            <option value="">尚未查询</option>
            <option v-for="entry in workspace.document.driving" :key="entry.id" :value="entry.id">
              {{ Math.round(entry.distanceMeters / 1000) }}公里 · {{ entry.driveMinutes }}分钟
            </option>
          </select>
        </label>
        <label v-if="mode === 'group'">
          绑定旅行团产品
          <select v-model="tourId">
            <option value="">尚未确认</option>
            <option v-for="entry in workspace.document.tours" :key="entry.id" :value="entry.id">
              {{ entry.name }}
            </option>
          </select>
        </label>
      </div>
      <details class="trip-details">
        <summary>选择真实交通班次（去返程可多选）</summary>
        <div class="trip-checks">
          <label v-for="entry in workspace.document.transport" :key="entry.id" class="trip-check">
            <input v-model="transportIds" type="checkbox" :value="entry.id" />
            {{ entry.label }} · {{ entry.departure ?? '时间待确认' }}
          </label>
        </div>
      </details>
      <details class="trip-details">
        <summary>选择初排地点（未选时使用已查景点）</summary>
        <div class="trip-checks">
          <label v-for="entry in workspace.document.experiences" :key="entry.id" class="trip-check">
            <input v-model="selected" type="checkbox" :value="entry.id" />
            {{ entry.name }}
          </label>
        </div>
        <p>
          当前预算选择{{
            workspace.document.costs.filter((item) => item.selected).length
          }}项费用；请在预算计算先明确选择。
        </p>
      </details>
    </form>
    <!-- 版本切换是只读预览，回退需要用户明确点击。 -->
    <div v-if="workspace.versions.length" class="version-toolbar">
      <label>
        查看版本
        <select
          :value="version?.id ?? workspace.activeVersionId"
          @change="emit('select', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="item in workspace.versions" :key="item.id" :value="item.id">
            v{{ item.version }} · {{ item.title }} ·
            {{ planStatus(item.status) }}
          </option>
        </select>
      </label>
      <button
        v-if="version && workspace.activeVersionId !== version.id"
        class="trip-button secondary"
        :disabled="busy"
        @click="emit('activate', version.id)"
      >
        将此版本设为当前
      </button>
    </div>
    <div v-if="version" class="version-view">
      <div class="version-heading">
        <div>
          <span class="trip-pill">v{{ version.version }} · {{ planStatus(version.status) }}</span>
          <h3>{{ version.draft.title }}</h3>
          <p>{{ version.draft.timeZone }} · {{ version.reason }}</p>
        </div>
        <div>
          <small>{{ version.budget.complete ? '费用合计' : '已知费用小计' }}</small>
          <strong>
            {{ money(version.budget.totalWithReserveMinor, version.budget.currency) }}
          </strong>
        </div>
      </div>
      <ul v-if="version.violations.length" class="trip-warnings">
        <li
          v-for="(issue, index) in version.violations"
          :key="index"
          :class="{ 'trip-error': issue.severity === 'error' }"
        >
          {{ issue.day ?? '' }} {{ issue.message }}
        </li>
      </ul>
      <RouteMap :points="points" :path="path" />
      <section v-for="day in version.draft.days" :key="day.date" class="day-section">
        <header>
          <span>DAY {{ version.draft.days.indexOf(day) + 1 }}</span>
          <h4>{{ day.date }}</h4>
        </header>
        <div v-if="!day.items.length" class="trip-empty">这一天还没有安排。</div>
        <article v-for="item in day.items" :key="item.id" class="timeline-item">
          <div class="timeline-time">
            <strong>{{ clock(item.startMinute) }}</strong>
            <small>{{ clock(item.endMinute) }}</small>
          </div>
          <div class="timeline-body">
            <h5>{{ item.title }}</h5>
            <p>{{ item.notes }}</p>
            <small>
              接驳：{{
                item.travelBeforeMinutes === null ? '未核实' : `${item.travelBeforeMinutes}分钟`
              }}
              · 步行{{ item.walkMinutes }}分钟 · 驾驶{{ item.driveMinutes }}分钟
            </small>
            <button class="trip-text-button" :disabled="busy" @click="begin(item)">
              局部调整 →
            </button>
            <form
              v-if="editing === item.id"
              class="trip-form timeline-edit"
              @submit.prevent="replace(item)"
            >
              <div class="trip-form-grid">
                <label>
                  名称
                  <input v-model="edit.title" required />
                </label>
                <label>
                  开始
                  <input v-model="edit.start" type="time" required />
                </label>
                <label>
                  结束
                  <input v-model="edit.end" type="time" required />
                </label>
                <label>
                  替换为已保存地点
                  <select v-model="edit.referenceId">
                    <option value="">保持原候选</option>
                    <option
                      v-for="entry in workspace.document.experiences"
                      :key="entry.id"
                      :value="entry.id"
                    >
                      {{ entry.name }}
                    </option>
                  </select>
                </label>
              </div>
              <label>
                备注
                <textarea v-model="edit.notes" rows="2"></textarea>
              </label>
              <label class="trip-check">
                <input v-model="edit.reservation" type="checkbox" />
                本人已确认预约（不会代为预约）
              </label>
              <div class="trip-actions">
                <button class="trip-button secondary" :disabled="busy">另存调整版本</button>
                <button class="trip-text-button" type="button" @click="editing = null">
                  取消编辑
                </button>
              </div>
            </form>
          </div>
        </article>
      </section>
      <details class="trip-details">
        <summary>本版本的估算假设</summary>
        <p v-for="assumption in version.draft.assumptions" :key="assumption">
          {{ assumption }}
        </p>
      </details>
    </div>
    <!-- 比较表明确列出不具备排名资格的原因。 -->
    <details v-if="workspace.versions.length > 1" class="trip-details">
      <summary>比较方案版本</summary>
      <div class="trip-checks">
        <label v-for="item in workspace.versions" :key="item.id" class="trip-check">
          <input v-model="compareIds" type="checkbox" :value="item.id" />
          v{{ item.version }} {{ item.title }}
        </label>
      </div>
      <button
        class="trip-button secondary"
        :disabled="busy || compareIds.length < 2 || compareIds.length > 6"
        @click="emit('compare', compareIds)"
      >
        同口径比较所选版本
      </button>
      <div v-if="comparison" class="trip-comparison">
        <p>{{ comparison.rankingLabel }}</p>
        <article v-for="row in comparison.rows" :key="row.id">
          <strong>v{{ row.version }} · {{ row.title }}</strong>
          <span>
            {{ money(row.budget.totalWithReserveMinor, row.budget.currency) }}
            {{ row.budget.complete ? '' : '（小计）' }}
          </span>
          <p>{{ row.reason }}</p>
        </article>
      </div>
    </details>
  </section>
</template>
<style scoped>
/** 时间轴保留明确左侧时间和右侧内容，验证问题不混进正文。 */
.version-toolbar {
  display: flex;
  gap: 15px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin: 28px 0;
}
.version-toolbar label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.version-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  border-top: 1px solid var(--line);
  padding-top: 30px;
}
.version-heading h3 {
  font-size: 29px;
  margin: 13px 0;
  color: var(--forest);
  font-family: var(--font-serif, serif);
}
.version-heading p,
.version-heading small {
  font-size: 13px;
  color: var(--muted);
}
.version-heading > div:last-child {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.version-heading strong {
  font-size: 25px;
}
.day-section {
  margin: 35px 0;
}
.day-section > header {
  display: flex;
  gap: 18px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding-bottom: 15px;
}
.day-section > header > span {
  font-size: 13px;
  letter-spacing: 2px;
  color: var(--muted);
}
.day-section h4 {
  font-size: 20px;
  margin: 0;
  color: var(--forest);
}
.timeline-item {
  display: flex;
  gap: 24px;
  padding-top: 24px;
}
.timeline-time {
  width: 50px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
  color: var(--forest);
}
.timeline-time small {
  color: var(--muted);
}
.timeline-body {
  border-left: 1px solid #cad2c6;
  padding: 0 0 20px 22px;
  flex: 1;
  min-width: 0;
}
.timeline-body h5 {
  font-size: 17px;
  margin: 0 0 10px;
  color: var(--forest);
}
.timeline-body p {
  font-size: 14px;
  line-height: 1.9;
  color: var(--muted);
}
.timeline-body > small {
  font-size: 13px;
  color: var(--muted);
}
.timeline-body > button {
  display: block;
  margin-top: 14px;
}
.timeline-edit {
  margin-top: 20px;
  padding: 16px;
  background: #eef0e7;
  border-radius: 7px;
}
.trip-comparison article {
  border-bottom: 1px solid var(--line);
  padding: 15px 0;
  font-size: 14px;
}
.trip-comparison article > span {
  float: right;
}
.trip-comparison p {
  font-size: 13px;
  color: var(--muted);
}
</style>
