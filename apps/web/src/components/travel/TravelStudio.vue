<!-- 页面只组合领域面板，网络和凭据由composable统一管理。 -->
<script setup lang="ts">
/** 视图状态与业务快照分开管理。 */
import { computed, shallowRef, watch } from 'vue';
/** 当前账户只从同一Pinia仓库读取。 */
import { useIdentityStore } from '@/stores/identity';
/** 单一旅行项目状态来源。 */
import { useTravelWorkspace } from '@/features/travel/use-travel-workspace';
/** 需求、资料、交通和费用等各自保留独立呈现职责。 */
import TripRequestEditor from './TripRequestEditor.vue';
/** 资料检索来源。 */
import ResearchPanel from './ResearchPanel.vue';
/** 交通查询交通。 */
import TransportPanel from './TransportPanel.vue';
/** 自驾规划车辆成本。 */
import DrivingPanel from './DrivingPanel.vue';
/** 住宿游玩住宿游玩。 */
import ExperiencePanel from './ExperiencePanel.vue';
/** 旅行团跟团条款。 */
import TourPanel from './TourPanel.vue';
/** 预算计算预算。 */
import PricingPanel from './PricingPanel.vue';
/** 行程版本行程版本。 */
import PlanPanel from './PlanPanel.vue';
/** 分享与运维交付与指标。 */
import DeliveryPanel from './DeliveryPanel.vue';
/** 登录意图交给已有页面认证入口，不重复实现密码处理。 */
const emit = defineEmits<{ login: [] }>();
/** 网络状态与全部领域面板共用同一对象，props向下、events向上。 */
const identity = useIdentityStore();
const studio = useTravelWorkspace();
/** 导航键仅控制当前面板，不参与服务端业务判断。 */
const tabs = [
  { id: 6, title: '需求' },
  { id: 7, title: '资料' },
  { id: 8, title: '交通' },
  { id: 9, title: '自驾' },
  { id: 10, title: '住宿游玩' },
  { id: 11, title: '旅行团' },
  { id: 12, title: '预算' },
  { id: 13, title: '行程' },
  { id: 14, title: '交付' },
];
/** 草稿创建有明确按钮，不向模型静默发送。 */
const active = shallowRef(6);
const creating = shallowRef(false);
const title = shallowRef('');
const text = shallowRef('');
const bind = shallowRef(true);
/** 能力摘要只用于解释供应商是否配置，不声称已经验证网络连接。 */
const amadeus = computed(() =>
  studio.capabilities.value?.suppliers.find((item) => item.id === 'amadeus'),
);
const tours = computed(() =>
  studio.capabilities.value?.suppliers.find((item) => item.id === 'tour_gateway'),
);
/** 当前项目只在有真实快照时才出现业务面板。 */
const trip = computed(() => studio.workspace.value);
/** 交付面板切入时加载分享列表，预算切入时重算真实结果。 */
watch(active, (value) => {
  if (!trip.value) return;
  if (value === 14) void studio.loadShares();
  if (value === 12) void studio.calculate();
});
/** 成功创建后关闭草稿表单，失败保留用户输入。 */
async function create() {
  await studio.create(title.value, text.value, bind.value);
  if (studio.workspace.value) {
    creating.value = false;
    active.value = 6;
  }
}
</script>
<template>
  <div class="travel-studio">
    <!-- 旅行工作区采用清晰的编辑台层级，当前业务职责始终可见。 -->
    <header class="studio-masthead">
      <div>
        <span class="trip-eyebrow">JOURNEY / TRAVEL ATELIER</span>
        <h1>把一程，安排妥当。</h1>
        <p>从一句想法，到有依据、算得清、能调整的旅行方案。</p>
      </div>
    </header>
    <div v-if="!identity.user" class="trip-empty studio-login">
      <h2>为下一程，留一个位置。</h2>
      <p>登录后创建自己的旅行项目，保存来源、预算和每一次调整。</p>
      <button class="trip-button" @click="emit('login')">登录并开始规划</button>
    </div>
    <template v-else>
      <!-- 项目选择与创建是真实持久化动作。 -->
      <div class="studio-projectbar">
        <label>
          正在规划
          <select
            :value="trip?.id ?? ''"
            :disabled="studio.busy.value"
            @change="studio.select(($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>选择旅行项目</option>
            <option v-for="item in studio.projects.value" :key="item.id" :value="item.id">
              {{ item.title }}{{ item.archived ? '（已归档）' : '' }}
            </option>
          </select>
        </label>
        <button
          class="trip-button secondary"
          :disabled="studio.busy.value"
          @click="creating = !creating"
        >
          {{ creating ? '收起' : '＋ 新旅行' }}
        </button>
        <button
          v-if="trip"
          class="trip-text-button"
          :disabled="studio.busy.value"
          @click="studio.reload"
        >
          刷新项目
        </button>
        <button
          v-if="trip"
          class="trip-text-button"
          :disabled="studio.busy.value"
          @click="studio.archive(!trip.archived)"
        >
          {{ trip.archived ? '恢复项目' : '归档项目' }}
        </button>
      </div>
      <form
        v-if="creating || (!studio.projects.value.length && !studio.loading.value)"
        class="studio-create trip-form"
        @submit.prevent="create"
      >
        <div class="trip-section-heading">
          <div>
            <span class="trip-eyebrow">A NEW CHAPTER</span>
            <h2>这一程，叫什么？</h2>
          </div>
        </div>
        <label>
          旅行项目名称
          <input v-model="title" required maxlength="100" placeholder="例如：江南三日，慢慢走" />
        </label>
        <label>
          先描述你的需求
          <textarea
            v-model="text"
            maxlength="4000"
            rows="3"
            placeholder="从哪里出发，想去哪，几个人，几天，预算多少？未确认的可以留空。"
          ></textarea>
        </label>
        <label class="trip-check">
          <input v-model="bind" type="checkbox" :disabled="!identity.selectedId" />
          {{
            identity.selectedId
              ? '关联当前聊天，智能体可继续规划同一项目'
              : '当前未选择聊天，将创建独立旅行项目'
          }}
        </label>
        <button class="trip-button" :disabled="studio.busy.value">创建并整理需求</button>
      </form>
      <!-- 成功与失败反馈都来自真实操作结果。 -->
      <p v-if="studio.error.value" class="trip-error" role="alert">
        {{ studio.error.value }}
      </p>
      <p v-if="studio.notice.value" class="studio-notice" role="status">
        ✓ {{ studio.notice.value }}
      </p>
      <div v-if="studio.busy.value" class="studio-busy" role="status">
        <span class="studio-spinner"></span>
        正在查询或保存实际结果…
        <button class="trip-text-button" @click="studio.cancel">取消当前操作</button>
      </div>
      <p v-if="studio.loading.value" class="trip-empty">正在恢复你的旅行资料…</p>
      <template v-if="trip">
        <!-- 各面板按需求、候选、费用、行程和交付组织真实操作。 -->
        <div class="studio-tripline">
          <strong>{{ trip.title }}</strong>
          <span>
            {{ trip.document.request.origin ?? '出发地待确认' }} →
            {{ trip.document.request.destination ?? '目的地待确认' }}
          </span>
          <span>
            {{ trip.document.request.startDate ?? '日期待确认' }} ·
            {{ trip.document.request.days ?? '—' }}天{{ trip.document.request.nights ?? '—' }}晚
          </span>
          <small>修订 {{ trip.revision }} · {{ trip.archived ? '已归档' : '已保存' }}</small>
        </div>
        <nav class="studio-tabs" aria-label="旅行服务">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :class="{ active: active === tab.id }"
            :aria-current="active === tab.id ? 'page' : undefined"
            @click="active = tab.id"
          >
            {{ tab.title }}
          </button>
        </nav>
        <p v-if="amadeus?.configured && amadeus.environment === 'test'" class="trip-callout">
          Amadeus 当前为测试环境，返回数据不代表生产可预订库存。
        </p>
        <!-- 父组件只路由动作，所有业务规则仍在独立服务和composable。 -->
        <TripRequestEditor
          v-if="active === 6"
          :request="trip.document.request"
          :clarifications="trip.clarifications"
          :busy="studio.busy.value || trip.archived"
          :parse="studio.parse"
          @save="studio.saveRequest"
        />
        <ResearchPanel
          v-else-if="active === 7"
          :sources="trip.document.evidence"
          :busy="studio.busy.value || trip.archived"
          @search="(input) => studio.query('/research', input)"
          @manual="(input) => studio.query('/research/manual', input)"
        />
        <TransportPanel
          v-else-if="active === 8"
          :request="trip.document.request"
          :options="trip.document.transport"
          :busy="studio.busy.value || trip.archived"
          :flight-configured="Boolean(amadeus?.configured)"
          @rail="(input) => studio.query('/transport/rail', input)"
          @flights="(input) => studio.query('/transport/flights', input)"
        />
        <DrivingPanel
          v-else-if="active === 9"
          :routes="trip.document.driving"
          :places="trip.document.experiences"
          :busy="studio.busy.value || trip.archived"
          @query="(input) => studio.query('/driving', input)"
        />
        <ExperiencePanel
          v-else-if="active === 10"
          :entries="trip.document.experiences"
          :sources="trip.document.evidence"
          :request="trip.document.request"
          :busy="studio.busy.value || trip.archived"
          :hotel-configured="Boolean(amadeus?.configured)"
          @search="(input) => studio.query('/experiences/search', input)"
          @hotels="(input) => studio.query('/experiences/hotels', input)"
          @manual="(input) => studio.query('/experiences/manual', input)"
        />
        <TourPanel
          v-else-if="active === 11"
          :products="trip.document.tours"
          :request="trip.document.request"
          :busy="studio.busy.value || trip.archived"
          :configured="Boolean(tours?.configured)"
          @search="studio.query('/tours/search')"
          @manual="(input) => studio.query('/tours/manual', input)"
        />
        <PricingPanel
          v-else-if="active === 12"
          :workspace="trip"
          :budget="studio.budget.value"
          :busy="studio.busy.value || trip.archived"
          @toggle="studio.toggleCost"
          @calculate="studio.calculate"
          @add="(input) => studio.query('/pricing/items', input)"
          @save="(rates, reserveBps) => studio.savePricing(trip!.document.costs, rates, reserveBps)"
        />
        <PlanPanel
          v-else-if="active === 13"
          :workspace="trip"
          :version="studio.version.value"
          :comparison="studio.comparison.value"
          :busy="studio.busy.value || trip.archived"
          @generate="(input) => studio.query('/plans/generate', input)"
          @select="studio.loadVersion"
          @replace="(input) => studio.query('/plans/replace', input)"
          @activate="studio.activate"
          @compare="studio.compare"
        />
        <DeliveryPanel
          v-else
          :version="studio.version.value"
          :shares="studio.shares.value"
          :new-share="studio.newShare.value"
          :metrics="studio.metrics.value"
          :busy="studio.busy.value || trip.archived"
          @download="studio.download"
          @share="studio.createShare"
          @revoke="studio.revokeShare"
          @load="studio.loadShares"
        />
      </template>
    </template>
    <footer class="studio-footer">
      <span>有来源 · 有条件 · 可复算 · 可回退</span>
      <span>公开执行摘要，不展示隐藏推理</span>
    </footer>
  </div>
</template>
<style>
/** 统一编辑台视觉；子面板共享语义样式，避免九套不一致的表单。 */
.travel-studio {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 32px clamp(18px, 4vw, 62px) 22px;
  color: var(--ink);
  background: #fafaf5;
  scrollbar-width: thin;
}
.studio-masthead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 25px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 30px;
  margin-bottom: 25px;
}
.trip-eyebrow {
  font-size: 12px;
  letter-spacing: 2px;
  font-weight: 600;
  color: #6e8273;
}
.studio-masthead h1 {
  font-family: 'STSong', 'Songti SC', serif;
  font-size: clamp(28px, 3.5vw, 46px);
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--forest);
  margin: 16px 0;
}
.studio-masthead p,
.trip-section-heading p {
  font-size: 14px;
  line-height: 1.9;
  color: var(--muted);
  margin: 0;
}
.studio-edition {
  font-family: Georgia, serif;
  font-size: 25px;
  color: #8c987e;
  letter-spacing: 2px;
  text-align: right;
  white-space: nowrap;
}
.studio-edition small {
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0;
}
.studio-projectbar {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin: 15px 0 24px;
}
.studio-projectbar > label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  min-width: 180px;
}
.studio-create {
  padding: 25px;
  background: #eff1e8;
  border: 1px solid #dce1d3;
  border-radius: 9px;
  margin: 20px 0;
}
.studio-tripline {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  font-size: 13px;
  padding: 15px 0;
}
.studio-tripline > strong {
  font-size: 16px;
  color: var(--forest);
}
.studio-tripline > span {
  color: var(--muted);
}
.studio-tripline > small {
  margin-left: auto;
  color: #839078;
  font-size: 13px;
}
.studio-tabs {
  display: flex;
  gap: 5px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 30px;
  flex-wrap: wrap;
}
.studio-tabs button {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 13px 10px;
  font-size: 14px;
  color: var(--muted);
  cursor: pointer;
}
.studio-tabs button small {
  font-size: 12px;
  display: block;
  letter-spacing: 1px;
  margin-bottom: 7px;
}
.studio-tabs button.active {
  color: var(--forest);
  border-color: var(--forest);
  font-weight: 600;
}
.trip-panel {
  animation: trip-panel-enter 0.3s ease-out;
}
.trip-section-heading {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 25px;
}
.trip-section-heading h2 {
  font-family: 'STSong', 'Songti SC', serif;
  font-weight: 500;
  letter-spacing: 0.5px;
  font-size: 26px;
  color: var(--forest);
  margin: 12px 0;
}
.trip-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.trip-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 17px;
}
.trip-form label,
.travel-studio .trip-inline-form > label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: #526153;
}
.travel-studio input:not([type='checkbox']),
.travel-studio select,
.travel-studio textarea {
  border: 1px solid #d9ded1;
  border-radius: 6px;
  padding: 11px 12px;
  background: #fffef9;
  color: #304b3e;
  font: inherit;
  font-size: 14px;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
.travel-studio input:focus,
.travel-studio select:focus,
.travel-studio textarea:focus {
  outline: 2px solid #b6c6a5;
  outline-offset: 1px;
}
.travel-studio textarea {
  resize: vertical;
  line-height: 1.8;
  width: 100%;
}
.travel-studio input[type='checkbox'] {
  accent-color: #31584a;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.trip-inline-form {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin: 15px 0;
}
.trip-inline-form > input {
  flex: 1;
  min-width: 150px;
}
.trip-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
  gap: 8px;
  padding: 12px 19px;
  border: 1px solid #345849;
  border-radius: 6px;
  background: #345849;
  color: #fffef4;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}
.trip-button:hover {
  background: #254637;
}
.trip-button.secondary {
  background: transparent;
  color: #345849;
  border-color: #bfcbb6;
}
.trip-button.secondary:hover {
  background: #edf1e7;
}
.travel-studio button:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.trip-text-button {
  border: 0;
  background: transparent;
  color: var(--forest);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 7px 0;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.trip-actions {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin: 10px 0 20px;
}
.trip-actions > span {
  font-size: 13px;
  color: var(--muted);
}
.travel-studio .trip-check {
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--muted);
}
.trip-checks {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  border: 1px solid var(--line);
  padding: 13px;
  border-radius: 6px;
  font-size: 13px;
}
.trip-checks legend {
  font-size: 13px;
  color: var(--muted);
}
.trip-details {
  border-top: 1px solid var(--line);
  margin: 15px 0;
  padding: 15px 0;
  font-size: 14px;
  line-height: 1.9;
}
.trip-details > summary {
  cursor: pointer;
  color: var(--forest);
  font-size: 13px;
  padding-bottom: 10px;
}
.trip-details .trip-form {
  padding-top: 10px;
}
.trip-callout {
  padding: 17px 19px;
  margin: 22px 0;
  background: #f0f2e8;
  border-left: 3px solid #9eaf85;
  font-size: 14px;
  line-height: 1.9;
  color: #526048;
}
.trip-callout ul {
  padding-left: 18px;
}
.trip-callout small {
  font-size: 12px;
  color: #859079;
}
.trip-pill {
  display: inline-block;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 1.5;
  background: #edf0e5;
  color: #627950;
  border-radius: 4px;
}
.trip-error {
  color: #a04e39 !important;
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.trip-warnings {
  font-size: 13px;
  color: #8c7142;
  line-height: 1.9;
  padding-left: 20px;
  background: #f6f2e6;
  border-radius: 5px;
  padding-top: 13px;
  padding-bottom: 13px;
}
.trip-empty {
  padding: 35px 15px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
  line-height: 2;
}
.studio-login {
  padding: 50px 20px;
}
.studio-login h2 {
  font-size: 27px;
  color: var(--forest);
  font-family: 'STSong', serif;
  font-weight: 500;
}
.studio-login .trip-button {
  margin-top: 20px;
}
.trip-parse {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  padding: 18px;
  background: #eff1e8;
  border-radius: 8px;
  margin-bottom: 25px;
}
.trip-parse textarea {
  flex: 1;
}
.studio-busy {
  display: flex;
  gap: 13px;
  align-items: center;
  font-size: 13px;
  color: var(--forest);
  padding: 12px 0;
}
.studio-spinner {
  width: 12px;
  height: 12px;
  border: 1px solid #bccbb2;
  border-top-color: #345849;
  border-radius: 50%;
  animation: trip-spin 1s linear infinite;
}
.studio-notice {
  font-size: 13px;
  color: var(--forest);
}
.studio-footer {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  font-size: 12px;
  color: #9aab8f;
  border-top: 1px solid var(--line);
  padding-top: 20px;
  margin-top: 40px;
  flex-wrap: wrap;
}
@keyframes trip-panel-enter {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes trip-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 700px) {
  .studio-edition {
    display: none;
  }
  .studio-masthead {
    padding-bottom: 20px;
  }
  .studio-tabs button {
    padding: 11px 8px;
    font-size: 13px;
  }
  .trip-parse {
    flex-direction: column;
    align-items: stretch;
  }
  .trip-parse button {
    align-self: flex-end;
  }
  .trip-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .trip-section-heading h2 {
    font-size: 23px;
  }
  .travel-studio {
    padding: 24px 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .trip-panel,
  .studio-spinner {
    animation: none;
  }
}

/** 编辑工作区使用相同的字体阶梯和面板层次，表单不再依赖微小文字。 */
.travel-studio {
  background: radial-gradient(ellipse at 100% 0, #e5efd6, transparent 55%), #fafbf5;
}
.studio-masthead {
  padding-bottom: 25px;
}
.studio-masthead h1 {
  font-size: clamp(32px, 3.5vw, 46px);
}
.studio-masthead p,
.trip-section-heading p {
  font-size: 15px;
}
.trip-eyebrow {
  font-size: 12px;
  letter-spacing: 1.8px;
}
.trip-panel {
  background: #fffefb;
  border: 1px solid #dce5d5;
  border-radius: 20px;
  padding: clamp(20px, 3vw, 35px);
  box-shadow: 0 12px 32px #27442e08;
}
.trip-section-heading h2 {
  font-size: 29px;
}
.trip-form label,
.travel-studio .trip-inline-form > label {
  font-size: 14px;
}
.travel-studio input:not([type='checkbox']),
.travel-studio select,
.travel-studio textarea {
  font-size: 16px;
  min-height: 44px;
  border-radius: 9px;
  background: #fcfdf8;
}
.trip-button {
  font-size: 14px;
  padding: 13px 20px;
  border-radius: 10px;
  background: #2b553d;
}
.trip-text-button {
  font-size: 14px;
}
.trip-tabs button,
.studio-tabs button {
  font-size: 15px;
  padding: 15px 16px;
}
.studio-tabs button.active {
  background: #e9f1db;
  border-radius: 10px 10px 0 0;
}
.trip-callout {
  font-size: 15px;
}
.trip-checks,
.travel-studio .trip-check {
  font-size: 14px;
}
.trip-pill {
  font-size: 12px;
}
.trip-details,
.trip-details > summary {
  font-size: 14px;
}
.trip-error,
.trip-empty {
  font-size: 15px;
}
.studio-tripline {
  font-size: 14px;
}
.studio-tripline > strong {
  font-size: 18px;
}
.studio-projectbar > label {
  font-size: 13px;
}
.studio-footer {
  font-size: 12px;
}
.trip-warnings {
  font-size: 14px;
  line-height: 1.9;
}
.trip-form-grid {
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(185px, 1fr));
}
@media (max-width: 760px) {
  .travel-studio {
    padding: 20px 13px;
  }
  .trip-panel {
    padding: 20px 16px;
    border-radius: 15px;
  }
  .trip-form-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .trip-section-heading h2 {
    font-size: 25px;
  }
  .studio-tabs button {
    font-size: 13px;
    padding: 12px 10px;
  }
  .trip-button {
    font-size: 13px;
    padding: 12px 16px;
  }
}
</style>
