<!-- 当前一次真实算路的对比，不在浏览器编造收费或把未知费用当最低价。 -->
<script setup lang="ts">
import { computed } from 'vue';
import type { DrivingRoute } from '@journey/contracts';
import { money, minutes } from '@/features/travel/format';
const props = defineProps<{ routes: DrivingRoute[]; selectedIds?: string[] }>();
/** 旧查询仍保存在项目，默认比较最近一轮而非混用旧路况。 */
const routes = computed(() => {
  const latest = [...props.routes].sort(
    (a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt),
  )[0];
  return latest?.comparisonGroupId
    ? props.routes.filter((route) => route.comparisonGroupId === latest.comparisonGroupId)
    : props.routes.slice(-3);
});
const names = {
  recommended: '高德推荐',
  less_tolls: '少收费',
  fastest: '速度优先',
  provider_alternative: '供应商备选',
};
</script>
<template>
  <section v-if="routes.length" class="driving-comparison" aria-label="自驾路线和过路费对比">
    <header>
      <div>
        <span>COMPARE THE ACTUAL ROUTES</span>
        <h3>路线、时间与过路费</h3>
      </div>
      <small>仅单程 · 查询时估算</small>
    </header>
    <div class="route-table" tabindex="0" role="region" aria-label="路线比较表，可横向滚动">
      <table>
        <thead>
          <tr>
            <th>实际路线</th>
            <th>里程</th>
            <th>驾驶 / 休息</th>
            <th>过路费 / 辆</th>
            <th>已知车辆费用</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="route in routes"
            :key="route.id"
            :class="{ chosen: selectedIds?.includes(route.id) }"
          >
            <td>
              <strong>{{ route.strategy ? names[route.strategy] : '已保存路线' }}</strong>
              <small v-if="selectedIds?.includes(route.id)">当前方案</small>
            </td>
            <td>{{ (route.distanceMeters / 1000).toFixed(1) }} 公里</td>
            <td>
              {{ minutes(route.driveMinutes) }}
              <small>休息 {{ route.restMinutes }} 分钟</small>
            </td>
            <td>
              {{ money(route.tollMinor) }}
              <small>
                {{
                  route.tollSource === 'user_assumption'
                    ? '用户费用假设'
                    : route.tollMinor == null
                      ? '未取得收费字段'
                      : '高德收费估算'
                }}
              </small>
            </td>
            <td>
              {{
                route.costs.some((cost) => cost.unitAmountMinor !== null)
                  ? money(route.knownVehicleMinor)
                  : '待补充'
              }}
              <small>
                {{
                  route.unknownCosts.length
                    ? '仍缺 ' + route.unknownCosts.join('、')
                    : '按已提供假设计算'
                }}
              </small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p>
      过路费是每辆车单程参考；已知车辆费用按所填车辆数计算。燃油/电费须有能耗与单价，缺项未按零元补齐；往返、市内停车、节假日及ETC优惠需另核对。
    </p>
    <details>
      <summary>来源、查询时间与限制</summary>
      <p v-for="route in routes" :key="route.id">
        {{ route.strategy ? names[route.strategy] : '已保存路线' }} ·
        {{ route.source === 'amap_web' ? '高德 Web 路径规划2.0' : '高德 MCP' }} ·
        {{
          new Date(route.checkedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        }}（北京时间）
        <br />
        {{ [...route.assumptions, ...route.warnings].join('；') }}
      </p>
    </details>
  </section>
</template>
<style scoped>
/** 比较放在行程前，让价格与驾驶强度的取舍直接可见。 */
.driving-comparison {
  margin: 26px 0 32px;
  padding: 22px;
  background: #f2f6ed;
  border: 1px solid #dce5d4;
  border-radius: 16px;
  color: #3b5943;
}
.driving-comparison header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.driving-comparison header span {
  font-size: 10px;
  letter-spacing: 0.13em;
  color: #8c9c7f;
}
.driving-comparison h3 {
  font-size: 23px;
  margin: 8px 0 20px;
  font-weight: 500;
}
.driving-comparison small {
  display: block;
  font-size: 11px;
  line-height: 1.7;
  color: #87977b;
  margin-top: 6px;
}
.route-table {
  overflow: auto;
  max-width: 100%;
}
.route-table table {
  border-collapse: collapse;
  width: 100%;
  min-width: 610px;
  text-align: left;
  font-size: 14px;
}
.route-table th {
  padding: 12px 10px;
  font-size: 12px;
  font-weight: 500;
  color: #829477;
  border-bottom: 1px solid #d7e2cd;
}
.route-table td {
  padding: 15px 10px;
  border-bottom: 1px solid #e0e8d8;
  vertical-align: top;
}
.route-table strong {
  font-weight: 500;
}
.route-table tr.chosen {
  background: #e7efdd;
}
.driving-comparison p,
.driving-comparison details {
  font-size: 12px;
  line-height: 1.9;
  color: #7e8d72;
}
.driving-comparison p {
  margin-bottom: 0;
}
.driving-comparison summary {
  cursor: pointer;
}
.driving-comparison details {
  margin-top: 16px;
}
@media (max-width: 650px) {
  .driving-comparison {
    padding: 16px;
  }
  .driving-comparison header {
    align-items: start;
    flex-direction: column;
  }
  .driving-comparison h3 {
    margin-bottom: 0;
  }
  .driving-comparison header > small {
    margin-bottom: 12px;
  }
}
</style>
