<!-- 决策工作台负责页面组合；版本预览是本地状态，正式选择由父级调用CAS接口。 -->
<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { DomesticDecision, DomesticProvider } from '@journey/contracts';
import PlanChoiceCard from './PlanChoiceCard.vue';
import PlanTimeline from './PlanTimeline.vue';
import BudgetEvidencePanel from './BudgetEvidencePanel.vue';
import BookingChecklist from './BookingChecklist.vue';
import DomesticProviderPanel from './DomesticProviderPanel.vue';
const props = defineProps<{
  decision: DomesticDecision;
  providers: DomesticProvider[];
  busy: boolean;
}>();
defineEmits<{
  select: [versionId: string];
  open: [providerId: string];
  adjust: [message: string];
}>();
const previewId = shallowRef('');
watch(
  () => [props.decision.optionSet?.id, props.decision.workspace?.activeVersionId],
  () => {
    previewId.value =
      props.decision.workspace?.activeVersionId ??
      props.decision.optionSet?.options[0]?.version.id ??
      '';
  },
  { immediate: true },
);
const preview = computed(
  () =>
    props.decision.optionSet?.options.find((option) => option.version.id === previewId.value) ??
    props.decision.optionSet?.options[0],
);
const selected = computed(
  () => preview.value?.version.id === props.decision.workspace?.activeVersionId,
);
const request = computed(() => props.decision.workspace?.document.request);
/** 调整快捷键只填写输入，用户确认发送后才修改需求。 */
const adjustments = [
  '把行程安排得更轻松一些，保留必去点',
  '重新比较交通选择，优先控制预算',
  '检查这套安排对老人和儿童的适合程度',
];
</script>
<template>
  <div class="decision-board">
    <header class="decision-hero">
      <div>
        <span class="kicker">YOUR JOURNEY, THOUGHTFULLY ARRANGED</span>
        <h2>
          {{ request?.destination }}，
          <em>这次这样出发。</em>
        </h2>
        <p>
          {{ request?.origin }} 出发
          <i>·</i>
          {{ request?.startDate }}
          <i>·</i>
          {{ request?.days }} 天
          <i>·</i>
          {{ request?.adults }} 成人
          <span v-if="request?.children">/ {{ request.children }} 儿童</span>
        </p>
      </div>
      <div class="hero-number">
        <b>{{ String(decision.optionSet?.options.length ?? 0).padStart(2, '0') }}</b>
        <span>套真实候选组合</span>
      </div>
    </header>
    <p v-if="decision.stale" class="warning" role="status">
      方案依据已变化或报价已过期。下面保留历史方案，请在对话中重新安排后再选择。
    </p>
    <div class="choices">
      <PlanChoiceCard
        v-for="(option, index) in decision.optionSet?.options"
        :key="option.version.id"
        :option="option"
        :index="index"
        :preview="preview?.version.id === option.version.id"
        :selected="decision.workspace?.activeVersionId === option.version.id"
        @preview="previewId = option.version.id"
      />
    </div>
    <template v-if="preview">
      <section class="itinerary">
        <div class="section-heading">
          <div>
            <span class="kicker">THE DAY-BY-DAY</span>
            <h3>
              {{ preview.label }}
              <small>· 逐日安排</small>
            </h3>
          </div>
          <button
            class="primary"
            type="button"
            :disabled="busy || decision.stale || selected || preview.version.status === 'invalid'"
            @click="$emit('select', preview.version.id)"
          >
            {{
              selected
                ? '✓ 已选定此方案'
                : preview.version.status === 'invalid'
                  ? '先解决行程冲突'
                  : '选择这套安排'
            }}
          </button>
        </div>
        <details v-if="preview.version.violations.length" class="validation">
          <summary>
            {{ preview.version.status === 'invalid' ? '存在冲突，需要调整' : '出发前待核实' }} ·
            {{ preview.version.violations.length }} 项
          </summary>
          <ul>
            <li v-for="(issue, index) in preview.version.violations" :key="index">
              {{ issue.message }}
            </li>
          </ul>
        </details>
        <PlanTimeline :version="preview.version" />
      </section>
      <div class="adjustments">
        <span>接着优化</span>
        <button
          v-for="message in adjustments"
          :key="message"
          type="button"
          :disabled="busy"
          @click="$emit('adjust', message)"
        >
          {{ message }} ↗
        </button>
      </div>
      <BudgetEvidencePanel :version="preview.version" />
      <BookingChecklist
        :version="preview.version"
        :selected="selected"
        :busy="busy"
        :stale="decision.stale"
        @open="$emit('open', $event)"
      />
      <details class="limits">
        <summary>本次资料范围与缺项</summary>
        <ul>
          <li v-for="line in decision.optionSet?.limitations" :key="line">{{ line }}</li>
        </ul>
        <p>
          查询时间：{{
            new Date(decision.optionSet!.createdAt).toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
            })
          }}（北京时间）。报价有效期各不相同，请以来源与平台确认页为准。
        </p>
      </details>
    </template>
    <DomesticProviderPanel :providers="providers" />
  </div>
</template>
<style scoped>
.decision-board {
  max-width: 1200px;
  width: 100%;
  margin: auto;
  padding: 14px 8px 40px;
  color: #283d30;
}
.decision-hero {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0 28px;
  gap: 22px;
}
.kicker {
  font-size: 10px;
  letter-spacing: 0.18em;
  color: #8c9b83;
}
.decision-hero h2 {
  font-size: clamp(28px, 3vw, 44px);
  letter-spacing: -0.06em;
  line-height: 1.35;
  margin: 16px 0 15px;
  font-weight: 500;
}
.decision-hero em {
  font-family: Georgia, 'Noto Serif SC', serif;
  font-weight: 400;
  color: #5a7858;
}
.decision-hero p {
  font-size: 14px;
  color: #7c8874;
}
.decision-hero i {
  margin: 0 10px;
  font-style: normal;
  color: #bcc6b4;
}
.hero-number {
  border-left: 1px solid #dbe4d3;
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.hero-number b {
  font:
    52px Georgia,
    serif;
  color: #426b46;
  line-height: 1.1;
}
.hero-number span {
  font-size: 11px;
  color: #839078;
  margin-top: 9px;
}
.choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
}
.itinerary {
  margin-top: 40px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 24px;
}
.section-heading h3 {
  font-size: 26px;
  letter-spacing: -0.04em;
  margin: 10px 0;
}
.section-heading small {
  font-size: 15px;
  font-weight: 400;
  color: #7c8a72;
}
.primary {
  border: 0;
  border-radius: 25px;
  background: #27593e;
  color: white;
  padding: 13px 23px;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
}
.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.validation,
.warning {
  background: #fbf4e4;
  border: 1px solid #eee2c4;
  border-radius: 10px;
  padding: 14px 18px;
  font-size: 13px;
  color: #927844;
  line-height: 1.8;
  margin-bottom: 25px;
}
.validation summary,
.limits summary {
  cursor: pointer;
}
.validation ul,
.limits ul {
  padding-left: 18px;
}
.adjustments {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
  padding: 18px 0 30px;
}
.adjustments > span {
  font-size: 12px;
  color: #8a977f;
  margin-right: 5px;
}
.adjustments button {
  border: 1px solid #dce4d5;
  border-radius: 20px;
  background: white;
  padding: 10px 14px;
  font-size: 12px;
  color: #69805e;
  cursor: pointer;
}
.limits {
  padding: 26px 2px;
  font-size: 13px;
  line-height: 1.9;
  color: #7d8974;
}
@media (max-width: 650px) {
  .decision-board {
    padding: 6px 0 24px;
  }
  .hero-number {
    display: none;
  }
  .decision-hero {
    padding-top: 0;
  }
  .decision-hero h2 {
    font-size: 29px;
  }
  .decision-hero p {
    font-size: 12px;
  }
  .choices {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding: 2px 2px 15px;
  }
  .choices > * {
    min-width: 260px;
    scroll-snap-align: center;
  }
  .section-heading {
    flex-wrap: wrap;
  }
  .section-heading h3 {
    font-size: 23px;
  }
  .primary {
    padding: 11px 18px;
  }
}
</style>
