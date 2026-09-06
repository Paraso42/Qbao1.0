<template>
  <div class="trend-wrap" :class="{ on }" :style="{ height: height + 'px' }">
    <svg class="trend-svg" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="各轮准确率趋势">
      <defs>
        <linearGradient :id="uid + '-area'" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4176E6" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#4176E6" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g class="trend-grid">
        <line v-for="gy in [25, 50, 100]" :key="gy" x1="0" :x2="100" :y1="y(gy)" :y2="y(gy)" vector-effect="non-scaling-stroke" />
      </g>
      <line class="trend-goal" x1="0" :x2="100" :y1="y(target)" :y2="y(target)" vector-effect="non-scaling-stroke" />
      <g class="trend-clip">
        <path class="trend-area" :d="areaD" :fill="'url(#' + uid + '-area)'" />
        <path class="trend-line" :d="lineD" vector-effect="non-scaling-stroke" />
      </g>
    </svg>
    <!-- 端点：HTML 绝对值定位，避免 preserveAspectRatio=none 下的非等比变形 -->
    <span
      v-for="(p, i) in points"
      :key="i"
      class="trend-dot"
      :class="dotClass(p.rate)"
      :style="{ left: xPct(i) + '%', top: yPct(p.rate) + '%' }"
      :title="p.label + ' · ' + p.rate + '%'"
    ></span>
    <span class="trend-x trend-x-a">{{ points[0] && points[0].label }}</span>
    <span class="trend-x trend-x-b">{{ points.length > 1 && points[points.length - 1].label }}</span>
    <span v-if="target" class="trend-goal-tag" :style="{ top: yPct(target) + '%' }">目标 {{ target }}%</span>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  // [{ label, rate }] rate 0-100
  points: { type: Array, default: () => [] },
  height: { type: Number, default: 120 },
  target: { type: Number, default: 0 } // 0 = 不显示目标线
})

let seq = 0
const uid = 'trend' + (seq++)

// viewBox 100x40；折线区域 Y: 36(0%) → 4(100%)
function y(v) { return 36 - (Math.max(0, Math.min(100, v)) / 100) * 32 }
function xPct(i) {
  const n = props.points.length
  if (n <= 1) return 50
  return (i / (n - 1)) * 92 + 4
}
function yPct(v) { return (y(v) / 40) * 100 }

const lineD = computed(() => {
  const ps = props.points
  if (ps.length === 0) return ''
  if (ps.length === 1) return 'M ' + xPct(0) + ' ' + y(ps[0].rate)
  return ps.map((p, i) => (i === 0 ? 'M ' : 'L ') + xPct(i).toFixed(2) + ' ' + y(p.rate).toFixed(2)).join(' ')
})
const areaD = computed(() => {
  const ps = props.points
  if (ps.length === 0) return ''
  const base = (lineD.value ? lineD.value : '')
  return base + ' L ' + xPct(ps.length - 1).toFixed(2) + ' 38 L ' + xPct(0).toFixed(2) + ' 38 Z'
})

function dotClass(rate) {
  if (rate < 40) return 'bad'
  if (rate < 70) return 'warn'
  return 'ok'
}

// 折线 reveal 入场（克制动效）
const on = ref(false)
onMounted(() => {
  const raf = requestAnimationFrame ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
  raf(() => { on.value = true })
})
</script>

<style scoped>
.trend-wrap { position: relative; width: 100%; }
.trend-svg { width: 100%; height: 100%; display: block; overflow: visible; }
.trend-grid line { stroke: var(--ov-grid, #E5E7EB); stroke-width: 1; stroke-dasharray: 3 4; }
.trend-goal { stroke: var(--color-success, #22C55E); stroke-width: 1.2; opacity: 0.7; stroke-dasharray: 5 4; }
.trend-area { stroke: none; }
.trend-line { stroke: #4176E6; stroke-width: 2; fill: none; }
.trend-clip { clip-path: inset(0 100% 0 0); transition: clip-path 0.5s ease; }
.trend-wrap.on .trend-clip { clip-path: inset(0 0 0 0); }
.trend-dot {
  position: absolute;
  width: 10px; height: 10px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-primary, #4176E6);
  border: 2px solid var(--surface-card, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  cursor: default;
}
.trend-dot.ok { background: var(--color-success, #22C55E); }
.trend-dot.warn { background: var(--color-warning, #F59E0B); }
.trend-dot.bad { background: var(--color-danger, #EF4444); }
.trend-x {
  position: absolute;
  bottom: -18px;
  font-size: 11px;
  color: var(--text-muted, #818588);
  white-space: nowrap;
}
.trend-x-a { left: 0; }
.trend-x-b { right: 0; }
.trend-goal-tag {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--color-success, #22C55E);
  background: var(--surface-card, #fff);
  padding: 0 2px;
  line-height: 1.2;
  opacity: 0.85;
}
@media (prefers-reduced-motion: reduce) {
  .trend-clip { transition: none; clip-path: inset(0 0 0 0); }
}
@media (max-width: 480px) {
  .trend-dot { width: 8px; height: 8px; }
}
</style>
