<!-- 本地SVG展示已查询的GCJ-02点位，不需要把地图Key放进网页。 -->
<script setup lang="ts">
/** 坐标投影是纯派生值，没有网络或持久化副作用。 */
import { computed } from 'vue';
/** 地图点固定坐标系。 */
import type { GeoPoint } from '@journey/contracts';
/** path只接受供应商实际路线，普通点位连接明确作为示意。 */
const props = defineProps<{
  points: { name: string; point: GeoPoint }[];
  path?: GeoPoint[];
}>();
/** 投影依据全部实际点位取边界，空数据不生成假地图。 */
const map = computed(() => {
  const all = [...props.points.map((item) => item.point), ...(props.path ?? [])];
  if (!all.length) return null;
  const minLng = Math.min(...all.map((point) => point.lng));
  const maxLng = Math.max(...all.map((point) => point.lng));
  const minLat = Math.min(...all.map((point) => point.lat));
  const maxLat = Math.max(...all.map((point) => point.lat));
  const middle = (minLat + maxLat) / 2;
  const cosine = Math.max(0.1, Math.cos((middle * Math.PI) / 180));
  const width = Math.max((maxLng - minLng) * cosine, 0.002);
  const height = Math.max(maxLat - minLat, 0.002);
  const scale = Math.min(590 / width, 220 / height);
  const offsetX = 45 + (590 - width * scale) / 2;
  const offsetY = 45 + (220 - height * scale) / 2;
  const project = (point: GeoPoint) => ({
    x: offsetX + (point.lng - minLng) * cosine * scale,
    y: offsetY + (maxLat - point.lat) * scale,
  });
  return {
    pins: props.points.map((item, index) => ({
      ...item,
      ...project(item.point),
      number: index + 1,
    })),
    line: (props.path?.length ? props.path : props.points.map((item) => item.point))
      .map((point) => {
        const p = project(point);
        return `${p.x},${p.y}`;
      })
      .join(' '),
    actual: Boolean(props.path?.length),
  };
});
/** 深链只拼固定高德域名和用户已选择的点位，不带Key或账户数据。 */
const navigation = computed(() => {
  const first = props.points[0];
  const last = props.points.at(-1);
  if (!first || !last || props.points.length < 2) return null;
  const query = new URLSearchParams({
    from: `${first.point.lng},${first.point.lat},${first.name}`,
    to: `${last.point.lng},${last.point.lat},${last.name}`,
    mode: 'car',
    src: 'journey',
    coordinate: 'gaode',
    callnative: '0',
  });
  return `https://uri.amap.com/navigation?${query}`;
});
</script>
<template>
  <figure v-if="map" class="route-map">
    <div class="map-top">
      <span>{{ map.actual ? '供应商返回的路线折线' : '行程点位示意' }}</span>
      <small>GCJ-请以实际导航为准</small>
    </div>
    <svg viewBox="0 0 680 310" role="img" aria-label="已保存旅行点位与路线示意">
      <defs>
        <pattern id="trip-map-grid" width="34" height="31" patternUnits="userSpaceOnUse">
          <path d="M 34 0 L 0 0 0 31" fill="none" stroke="#d4dcd2" stroke-width="0.5" />
        </pattern>
      </defs>
      <rect width="680" height="310" fill="url(#trip-map-grid)" />
      <polyline
        :points="map.line"
        fill="none"
        stroke="#476f5e"
        stroke-width="2.5"
        :stroke-dasharray="map.actual ? undefined : '6 6'"
        stroke-linejoin="round"
      />
      <g v-for="pin in map.pins" :key="`${pin.number}-${pin.name}`">
        <circle :cx="pin.x" :cy="pin.y" r="12" fill="#31564a" stroke="#f7f7ef" stroke-width="3" />
        <text :x="pin.x" :y="pin.y + 4" text-anchor="middle" fill="#fff" font-size="10">
          {{ pin.number }}
        </text>
        <title>{{ pin.name }} · {{ pin.point.lng }},{{ pin.point.lat }}</title>
      </g>
    </svg>
    <figcaption>
      <span v-for="pin in map.pins" :key="pin.number">{{ pin.number }} {{ pin.name }}</span>
      <a v-if="navigation" :href="navigation" target="_blank" rel="noopener noreferrer">
        在高德查看起终点导航 ↗
      </a>
    </figcaption>
  </figure>
  <div v-else class="trip-empty">当前行程尚无已确认坐标。查询或补齐地点后会显示点位。</div>
</template>
<style scoped>
/** 采用轻量路线图纸视觉，不把静态示意冒充实时导航。 */
.route-map {
  margin: 20px 0;
  background: #edf0e7;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
.map-top {
  display: flex;
  justify-content: space-between;
  padding: 15px 18px;
  font-size: 13px;
  gap: 10px;
  color: var(--forest);
}
.map-top small {
  font-size: 12px;
  color: var(--muted);
}
.route-map svg {
  display: block;
  width: 100%;
  height: auto;
}
.route-map figcaption {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 15px 18px;
  font-size: 13px;
  color: var(--forest);
}
.route-map a {
  margin-left: auto;
  color: var(--forest);
}
</style>
