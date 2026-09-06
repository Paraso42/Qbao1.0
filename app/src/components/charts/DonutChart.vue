<template>
  <div
    class="donut-wrap"
    :style="{ width: size + 'px', height: size + 'px' }"
    role="img"
    :aria-label="ariaLabel"
  >
    <svg class="donut-svg" :viewBox="'0 0 ' + size + ' ' + size">
      <defs>
        <linearGradient
          v-for="(p, i) in gradientDefs"
          :key="i"
          :id="uid + '-g' + i"
          x1="0" y1="0" x2="1" y2="1"
        >
          <stop offset="0%" :stop-color="p[0]" />
          <stop offset="100%" :stop-color="p[1]" />
        </linearGradient>
      </defs>
      <!-- 轨道（未答/总底色） -->
      <circle
        class="donut-track"
        :cx="c" :cy="c" :r="r"
        :stroke-width="thickness"
        fill="none"
      />
      <!-- 分段：圆端路径 + pathLength 归一化做 sweep 入场 -->
      <path
        v-for="p in paths"
        :key="p.i"
        class="donut-seg"
        :class="{ on }"
        :d="p.d"
        pathLength="1"
        fill="none"
        :stroke="p.stroke"
        :stroke-width="thickness"
        stroke-linecap="round"
      >
        <title v-if="p.label">{{ p.label }}</title>
      </path>
    </svg>
    <div class="donut-center"><slot /></div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  // [{ value, color, gradient: [from,to]?, label? }]
  segments: { type: Array, default: () => [] },
  size: { type: Number, default: 184 },
  thickness: { type: Number, default: 18 },
  // 段间隙（沿圆周 px）
  gap: { type: Number, default: 6 },
  // 分母覆盖：默认 = 各段值之和；传入 total 时弧长 = value/total（未答段以轨道呈现）
  total: { type: Number, default: 0 }
})

let seq = 0
const uid = 'donut' + (seq++)

const c = computed(() => props.size / 2)
const r = computed(() => (props.size - props.thickness) / 2 - 1)
const segSum = computed(() => props.segments.reduce((a, s) => a + (s && s.value > 0 ? s.value : 0), 0))
const total = computed(() => (props.total > 0 ? props.total : segSum.value))

const gradientDefs = computed(() => props.segments.filter((s) => s && Array.isArray(s.gradient) && s.gradient.length === 2).map((s) => s.gradient))

const paths = computed(() => {
  const C = 2 * Math.PI * r.value
  const visible = props.segments.filter((s) => s && s.value > 0)
  if (C <= 0 || visible.length === 0) return []
  const g = Math.min(props.gap, C / visible.length / 2)
  const out = []
  let angle = -Math.PI / 2
  props.segments.forEach((s, i) => {
    if (!s || !(s.value > 0)) return
    const arcLen = Math.max(0, (s.value / total.value) * C - g)
    if (arcLen <= 0.5) return
    const a0 = angle
    const a1 = angle + arcLen / r.value
    angle = a1 + g / r.value
    const p1x = c.value + r.value * Math.cos(a0)
    const p1y = c.value + r.value * Math.sin(a0)
    const p2x = c.value + r.value * Math.cos(a1)
    const p2y = c.value + r.value * Math.sin(a1)
    const large = arcLen > C / 2 ? 1 : 0
    out.push({
      i,
      d: 'M ' + p1x.toFixed(2) + ' ' + p1y.toFixed(2) + ' A ' + r.value + ' ' + r.value + ' 0 ' + large + ' 1 ' + p2x.toFixed(2) + ' ' + p2y.toFixed(2),
      stroke: Array.isArray(s.gradient) && s.gradient.length === 2 ? 'url(#' + uid + '-g' + gradientDefs.value.indexOf(s.gradient) + ')' : s.color,
      label: s.label
    })
  })
  return out
})

const ariaLabel = computed(() =>
  '掌握度环图：' + props.segments.filter((s) => s && s.value > 0).map((s) => (s.label || '') + ' ' + s.value).join('，')
)

// sweep 入场（克制动效；reduced-motion 直出终态）
const on = ref(false)
onMounted(() => {
  const raf = requestAnimationFrame ? requestAnimationFrame : (fn) => setTimeout(fn, 16)
  raf(() => { on.value = true })
})
</script>

<style scoped>
.donut-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
.donut-svg { width: 100%; height: 100%; display: block; }
.donut-track { stroke: var(--ov-track, #E5E7EB); }
.donut-seg {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  transition: stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.donut-seg.on { stroke-dashoffset: 0; }
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .donut-seg { transition: none; stroke-dashoffset: 0; }
}
</style>
