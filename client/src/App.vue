<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import type { MetricConfig, AlertRule, Alert, TagsInfo } from './types'
import { listMetrics, getMetricTags, listAlertRules, listAlerts, getOpenAlerts, createAlertRule, deleteAlertRule, queryData } from './api'
import MetricList from './components/MetricList.vue'
import TimeSeriesChart from './components/TimeSeriesChart.vue'
import AlertPanel from './components/AlertPanel.vue'
import AlertRuleModal from './components/AlertRuleModal.vue'
import { use } from 'echarts/core'

const metrics = ref<string[]>([])
const metricConfigs = ref<Map<string, MetricConfig>>(new Map())
const timeRange = ref<string>('1h')
const startTime = ref<number>(Date.now() - 3600000)
const endTime = ref<number>(Date.now())
const activeTab = ref<'alerts' | 'rules'>('alerts')
const alertRules = ref<AlertRule[]>([])
const alerts = ref<Alert[]>([])
const showRuleModal = ref(false)
const selectedMetricForRule = ref<string>('')
const normalize = ref(false)
const refreshInterval = ref<number | null>(null)
const metricTags = ref<Map<string, TagsInfo>>(new Map())
const selectedTags = ref<Map<string, Record<string, string | number>>>(new Map())
const queryResults = ref<Map<string, { points: { timestamp: number; value: number }[]; downsampled: boolean; originalCount: number }>>(new Map())

const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

const timeRanges = [
  { label: '1小时', value: '1h', ms: 3600000 },
  { label: '6小时', value: '6h', ms: 21600000 },
  { label: '24小时', value: '24h', ms: 86400000 },
  { label: '7天', value: '7d', ms: 604800000 },
  { label: '30天', value: '30d', ms: 2592000000 },
  { label: '1年', value: '1y', ms: 31536000000 }
]

const selectedMetrics = computed(() => {
  return Array.from(metricConfigs.value.values()).filter(c => c.visible)
})

function setTimeRange(range: string) {
  timeRange.value = range
  const tr = timeRanges.find(t => t.value === range)
  if (tr) {
    endTime.value = Date.now()
    startTime.value = endTime.value - tr.ms
  }
}

function toggleMetric(metric: string) {
  if (metricConfigs.value.has(metric)) {
    const config = metricConfigs.value.get(metric)!
    config.visible = !config.visible
    metricConfigs.value.set(metric, { ...config })
  } else {
    const colorIndex = metricConfigs.value.size % colors.length
    metricConfigs.value.set(metric, {
      name: metric,
      color: colors[colorIndex],
      yAxisIndex: 0,
      normalized: false,
      visible: true
    })
  }
}

function removeMetric(metric: string) {
  metricConfigs.value.delete(metric)
  selectedTags.value.delete(metric)
  queryResults.value.delete(metric)
}

function setYAxis(metric: string, index: number) {
  const config = metricConfigs.value.get(metric)
  if (config) {
    config.yAxisIndex = index
    metricConfigs.value.set(metric, { ...config })
  }
}

async function loadMetrics() {
  metrics.value = await listMetrics()
  for (const metric of metrics.value) {
    if (!metricTags.value.has(metric)) {
      metricTags.value.set(metric, await getMetricTags(metric))
    }
  }
}

async function loadAlertRules() {
  alertRules.value = await listAlertRules()
}

async function loadAlerts() {
  alerts.value = await listAlerts(100)
}

async function loadAllQueries() {
  const visibleConfigs = selectedMetrics.value
  for (const config of visibleConfigs) {
    const tags = selectedTags.value.get(config.name) || {}
    const result = await queryData({
      metric: config.name,
      start: startTime.value,
      end: endTime.value,
      tags,
      maxPoints: 1000
    })
    queryResults.value.set(config.name, {
      points: result.points,
      downsampled: result.downsampled,
      originalCount: result.originalCount
    })
  }
}

function onZoom(newStart: number, newEnd: number) {
  startTime.value = newStart
  endTime.value = newEnd
  loadAllQueries()
}

function openRuleModal(metric: string) {
  selectedMetricForRule.value = metric
  showRuleModal.value = true
}

async function handleCreateRule(rule: Omit<AlertRule, 'id' | 'enabled' | 'created_at'>) {
  await createAlertRule(rule)
  showRuleModal.value = false
  loadAlertRules()
}

async function handleDeleteRule(id: number) {
  await deleteAlertRule(id)
  loadAlertRules()
}

function setTagFilter(metric: string, key: string, value: string | number | null) {
  const current = selectedTags.value.get(metric) || {}
  if (value === null || value === '') {
    delete current[key]
  } else {
    current[key] = value
  }
  selectedTags.value.set(metric, { ...current })
}

watch([startTime, endTime, normalize], () => {
  loadAllQueries()
}, { deep: true })

watch(metricConfigs, () => {
  loadAllQueries()
}, { deep: true })

onMounted(async () => {
  await loadMetrics()
  await loadAlertRules()
  await loadAlerts()
  setTimeRange('1h')

  refreshInterval.value = window.setInterval(() => {
    if (timeRange.value === '1h' || timeRange.value === '6h' || timeRange.value === '24h') {
      endTime.value = Date.now()
      const tr = timeRanges.find(t => t.value === timeRange.value)
      if (tr) {
        startTime.value = endTime.value - tr.ms
      }
    }
    loadAllQueries()
    loadAlerts()
  }, 5000)
})
</script>

<template>
  <div class="app-container">
    <MetricList
      :metrics="metrics"
      :metricConfigs="metricConfigs"
      :metricTags="metricTags"
      :selectedTags="selectedTags"
      @toggle="toggleMetric"
      @remove="removeMetric"
      @setYAxis="setYAxis"
      @createAlert="openRuleModal"
      @setTagFilter="setTagFilter"
    />

    <div class="main-content">
      <div class="topbar">
        <div class="time-range-selector">
          <button
            v-for="tr in timeRanges"
            :key="tr.value"
            class="time-btn"
            :class="{ active: timeRange === tr.value }"
            @click="setTimeRange(tr.value)"
          >
            {{ tr.label }}
          </button>
        </div>
        <div class="chart-controls" style="position: static;">
          <button
            class="control-btn"
            :class="{ active: normalize }"
            @click="normalize = !normalize"
          >
            归一化
          </button>
        </div>
      </div>

      <TimeSeriesChart
        :metricConfigs="selectedMetrics"
        :queryResults="queryResults"
        :startTime="startTime"
        :endTime="endTime"
        :normalize="normalize"
        @zoom="onZoom"
      />

      <div class="bottom-panel">
        <div class="panel-tabs">
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'alerts' }"
            @click="activeTab = 'alerts'"
          >
            告警历史
          </button>
          <button
            class="tab-btn"
            :class="{ active: activeTab === 'rules' }"
            @click="activeTab = 'rules'"
          >
            告警规则
          </button>
        </div>
        <AlertPanel
          :tab="activeTab"
          :alerts="alerts"
          :alertRules="alertRules"
          @createRule="showRuleModal = true; selectedMetricForRule = ''"
          @deleteRule="handleDeleteRule"
        />
      </div>
    </div>

    <AlertRuleModal
      v-if="showRuleModal"
      :metrics="metrics"
      :preselectedMetric="selectedMetricForRule"
      @close="showRuleModal = false"
      @create="handleCreateRule"
    />
  </div>
</template>
