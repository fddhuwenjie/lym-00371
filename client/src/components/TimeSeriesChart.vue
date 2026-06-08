<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import type { MetricConfig } from '../types'

const props = defineProps<{
  metricConfigs: MetricConfig[]
  queryResults: Map<string, {
    points: { timestamp: number; value: number }[]
    downsampled: boolean
    originalCount: number
  }>
  startTime: number
  endTime: number
  normalize: boolean
}>()

const emit = defineEmits<{
  zoom: [start: number, end: number]
}>()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null
const tooltipData = ref<{
  visible: boolean
  x: number
  y: number
  time: number
  values: { metric: string; value: number; color: string }[]
}>({ visible: false, x: 0, y: 0, time: 0, values: [] })

const dualYAxis = computed(() => {
  const axes = new Set(props.metricConfigs.map(c => c.yAxisIndex))
  return axes.size > 1
})

const statsInfo = computed(() => {
  const allResults = Array.from(props.queryResults.values())
  if (allResults.length === 0) return null

  const totalPoints = allResults.reduce((sum, r) => sum + r.originalCount, 0)
  const returnedPoints = allResults.reduce((sum, r) => sum + r.points.length, 0)
  const downsampled = allResults.some(r => r.downsampled)

  return { totalPoints, returnedPoints, downsampled }
})

function normalizeData(points: { timestamp: number; value: number }[]) {
  if (points.length === 0) return points

  const values = points.map(p => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return points.map(p => ({
    timestamp: p.timestamp,
    value: ((p.value - min) / range) * 100
  }))
}

function getChartOption(): echarts.EChartsOption {
  const series: echarts.SeriesOption[] = []
  const yAxes: any[] = []

  yAxes.push({
    type: 'value',
    position: 'left',
    name: props.normalize ? '归一化 (%)' : 'Y1',
    nameTextStyle: { color: '#94a3b8', fontSize: 11 },
    axisLine: { lineStyle: { color: '#475569' } },
    axisLabel: { color: '#94a3b8', fontSize: 11 },
    splitLine: { lineStyle: { color: '#1e293b' } }
  })

  if (dualYAxis.value) {
    yAxes.push({
      type: 'value',
      position: 'right',
      name: 'Y2',
      nameTextStyle: { color: '#94a3b8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      splitLine: { show: false }
    })
  }

  for (const config of props.metricConfigs) {
    const result = props.queryResults.get(config.name)
    if (!result || result.points.length === 0) continue

    let points = result.points
    if (props.normalize) {
      points = normalizeData(points)
    }

    series.push({
      name: config.name,
      type: 'line',
      smooth: true,
      symbol: 'none',
      sampling: 'none',
      yAxisIndex: config.yAxisIndex,
      lineStyle: {
        color: config.color,
        width: 1.5
      },
      itemStyle: {
        color: config.color
      },
      data: points.map(p => [p.timestamp, p.value]),
      emphasis: {
        focus: 'series',
        lineStyle: { width: 3 }
      }
    })
  }

  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: {
      left: dualYAxis.value ? 60 : 50,
      right: dualYAxis.value ? 60 : 20,
      top: 30,
      bottom: 40
    },
    tooltip: {
      show: false,
      trigger: 'axis'
    },
    xAxis: {
      type: 'time',
      min: props.startTime,
      max: props.endTime,
      axisLine: { lineStyle: { color: '#475569' } },
      axisLabel: { color: '#94a3b8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#1e293b' } }
    },
    yAxis: yAxes,
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        bottom: 0,
        height: 20,
        borderColor: 'transparent',
        backgroundColor: '#1e293b',
        fillerColor: 'rgba(59, 130, 246, 0.2)',
        handleStyle: {
          color: '#3b82f6',
          borderColor: '#3b82f6'
        },
        textStyle: { color: 'transparent' }
      }
    ],
    legend: {
      show: props.metricConfigs.length > 1,
      top: 5,
      textStyle: { color: '#94a3b8', fontSize: 11 },
      data: props.metricConfigs.map(c => c.name)
    },
    series
  }
}

function updateChart() {
  if (!chartInstance) return
  chartInstance.setOption(getChartOption(), true)
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatValue(v: number): string {
  if (v >= 1000) return v.toFixed(1)
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.01) return v.toFixed(4)
  return v.toExponential(2)
}

function onMouseMove(e: MouseEvent) {
  if (!chartInstance || !chartRef.value) return

  const point = chartInstance.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [e.offsetX, e.offsetY])
  if (!point || point.length < 2) return

  const timestamp = point[0]
  if (timestamp < props.startTime || timestamp > props.endTime) {
    tooltipData.value.visible = false
    return
  }

  const values: { metric: string; value: number; color: string }[] = []

  for (const config of props.metricConfigs) {
    const result = props.queryResults.get(config.name)
    if (!result || result.points.length === 0) continue

    let points = result.points
    if (props.normalize) {
      points = normalizeData(points)
    }

    let closest = points[0]
    let minDiff = Math.abs(points[0].timestamp - timestamp)

    for (const p of points) {
      const diff = Math.abs(p.timestamp - timestamp)
      if (diff < minDiff) {
        minDiff = diff
        closest = p
      }
    }

    if (Math.abs(closest.timestamp - timestamp) < 60000) {
      values.push({
        metric: config.name,
        value: closest.value,
        color: config.color
      })
    }
  }

  const rect = chartRef.value.getBoundingClientRect()
  tooltipData.value = {
    visible: true,
    x: e.clientX - rect.left + 15,
    y: e.clientY - rect.top + 15,
    time: timestamp,
    values
  }
}

function onMouseLeave() {
  tooltipData.value.visible = false
}

function onDataZoom(params: any) {
  if (params.batch && params.batch.length > 0) {
    const { startValue, endValue } = params.batch[0]
    if (startValue !== undefined && endValue !== undefined) {
      emit('zoom', startValue, endValue)
    }
  }
}

watch([() => props.metricConfigs, () => props.queryResults, () => props.normalize, () => props.startTime, () => props.endTime], () => {
  updateChart()
}, { deep: true })

onMounted(() => {
  if (chartRef.value) {
    chartInstance = echarts.init(chartRef.value)
    chartInstance.setOption(getChartOption())
    chartInstance.getZr().on('mousemove', onMouseMove)
    chartInstance.getZr().on('mouseout', onMouseLeave)
    chartInstance.on('dataZoom', onDataZoom)

    window.addEventListener('resize', () => {
      chartInstance?.resize()
    })
  }
})

onBeforeUnmount(() => {
  if (chartInstance) {
    chartInstance.dispose()
    chartInstance = null
  }
})
</script>

<template>
  <div class="chart-container">
    <div ref="chartRef" class="chart-wrapper"></div>

    <div
      v-if="tooltipData.visible && tooltipData.values.length > 0"
      class="tooltip-panel"
      :style="{ left: tooltipData.x + 'px', top: tooltipData.y + 'px' }"
    >
      <div class="tooltip-time">{{ formatTime(tooltipData.time) }}</div>
      <div
        v-for="v in tooltipData.values"
        :key="v.metric"
        class="tooltip-metric"
      >
        <span class="tooltip-dot" :style="{ backgroundColor: v.color }"></span>
        <span>{{ v.metric }}</span>
        <span class="tooltip-value">{{ formatValue(v.value) }}{{ normalize ? '%' : '' }}</span>
      </div>
    </div>

    <div v-if="statsInfo" class="chart-status-bar">
      <span>原始点数: {{ statsInfo.totalPoints.toLocaleString() }}</span>
      <span>返回点数: {{ statsInfo.returnedPoints }}</span>
      <span v-if="statsInfo.downsampled" style="color: #f59e0b;">已降采样</span>
    </div>
  </div>
</template>
