<script setup lang="ts">
import { ref, onMounted, computed, watch, onBeforeUnmount } from 'vue'
import type { MetricConfig, AlertRule, Alert, TagsInfo } from './types'
import { listMetrics, getMetricTags, listAlertRules, listAlerts, getOpenAlerts, createAlertRule, deleteAlertRule, queryData, queryPromQL } from './api'
import MetricList from './components/MetricList.vue'
import TimeSeriesChart from './components/TimeSeriesChart.vue'
import AlertPanel from './components/AlertPanel.vue'
import AlertRuleModal from './components/AlertRuleModal.vue'
import CQPanel from './components/CQPanel.vue'
import ImportExportPanel from './components/ImportExportPanel.vue'
import AlertsEnhancedPanel from './components/AlertsEnhancedPanel.vue'
import RetentionPanel from './components/RetentionPanel.vue'

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

const activeMainTab = ref<'metrics' | 'cq' | 'importexport' | 'alerts' | 'retention'>('metrics')
const promqlMode = ref(false)
const promqlQuery = ref('')
const promqlStep = ref(15)
const promqlResults = ref<{ metric: string; tags: Record<string, string | number>; values: { timestamp: number; value: number }[] }[]>([])
const promqlLoading = ref(false)

const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316']

const timeRanges = [
  { label: '1小时', value: '1h', ms: 3600000 },
  { label: '6小时', value: '6h', ms: 21600000 },
  { label: '24小时', value: '24h', ms: 86400000 },
  { label: '7天', value: '7d', ms: 604800000 },
  { label: '30天', value: '30d', ms: 2592000000 },
  { label: '1年', value: '1y', ms: 31536000000 }
]

const mainTabs = [
  { label: 'Metrics', value: 'metrics' as const },
  { label: 'CQ', value: 'cq' as const },
  { label: 'Import-Export', value: 'importexport' as const },
  { label: 'Alerts', value: 'alerts' as const },
  { label: 'Retention', value: 'retention' as const }
]

const selectedMetrics = computed(() => {
  return Array.from(metricConfigs.value.values()).filter(c => c.visible)
})

const promqlChartConfigs = computed(() => {
  return promqlResults.value.map((r, i) => {
    const color = colors[i % colors.length]
    const name = r.tags && Object.keys(r.tags).length > 0
      ? `${r.metric}{${Object.entries(r.tags).map(([k, v]) => `${k}="${v}"`).join(',')}}`
      : r.metric
    return {
      name,
      color,
      yAxisIndex: 0,
      normalized: false,
      visible: true
    }
  })
})

const promqlQueryResults = computed(() => {
  const map = new Map<string, { points: { timestamp: number; value: number }[]; downsampled: boolean; originalCount: number }>()
  promqlResults.value.forEach((r, i) => {
    const config = promqlChartConfigs.value[i]
    if (config) {
      map.set(config.name, {
        points: r.values,
        downsampled: false,
        originalCount: r.values.length
      })
    }
  })
  return map
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
  if (promqlMode.value) return
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

async function executePromQL() {
  if (!promqlQuery.value.trim()) return
  promqlLoading.value = true
  try {
    const result = await queryPromQL(promqlQuery.value, startTime.value, endTime.value, promqlStep.value)
    promqlResults.value = result.result
  } catch (err: any) {
    alert('PromQL 执行错误: ' + err.message)
  } finally {
    promqlLoading.value = false
  }
}

function onZoom(newStart: number, newEnd: number) {
  startTime.value = newStart
  endTime.value = newEnd
  if (promqlMode.value) {
    executePromQL()
  } else {
    loadAllQueries()
  }
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
  if (promqlMode.value) {
    executePromQL()
  } else {
    loadAllQueries()
  }
}, { deep: true })

watch(metricConfigs, () => {
  if (!promqlMode.value) {
    loadAllQueries()
  }
}, { deep: true })

watch(promqlMode, () => {
  if (promqlMode.value && promqlQuery.value.trim()) {
    executePromQL()
  } else if (!promqlMode.value) {
    loadAllQueries()
  }
})

watch(activeMainTab, () => {
  if (activeMainTab.value === 'metrics') {
    loadMetrics()
  }
})

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
    if (activeMainTab.value === 'metrics') {
      if (promqlMode.value) {
        executePromQL()
      } else {
        loadAllQueries()
      }
      loadAlerts()
    }
  }, 5000)
})

onBeforeUnmount(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
  }
})
</script>

<template>
  <div class="app-container">
    <div class="app-header">
      <div class="main-tabs">
        <button
          v-for="tab in mainTabs"
          :key="tab.value"
          class="main-tab-btn"
          :class="{ active: activeMainTab === tab.value }"
          @click="activeMainTab = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="header-right">
        <div v-if="activeMainTab === 'metrics'" class="promql-toggle">
          <label class="toggle-label">
            <input type="checkbox" v-model="promqlMode" />
            <span>PromQL 模式</span>
          </label>
        </div>
      </div>
    </div>

    <div v-if="activeMainTab === 'metrics'" class="metrics-view">
      <MetricList
        v-if="!promqlMode"
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
        <div v-if="promqlMode" class="promql-bar">
          <input
            type="text"
            v-model="promqlQuery"
            class="promql-input"
            placeholder="PromQL 查询，例如: sum by (job) (rate(http_requests[5m]))"
            @keyup.enter="executePromQL"
          />
          <input
            type="number"
            v-model.number="promqlStep"
            class="promql-step"
            min="1"
            step="1"
            placeholder="Step (s)"
          />
          <button class="btn btn-primary" @click="executePromQL" :disabled="promqlLoading">
            {{ promqlLoading ? '执行中...' : '执行' }}
          </button>
        </div>

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
          :metricConfigs="promqlMode ? promqlChartConfigs : selectedMetrics"
          :queryResults="promqlMode ? promqlQueryResults : queryResults"
          :startTime="startTime"
          :endTime="endTime"
          :normalize="normalize"
          @zoom="onZoom"
        />

        <div v-if="!promqlMode" class="bottom-panel">
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
    </div>

    <div v-else-if="activeMainTab === 'cq'" class="tab-content">
      <CQPanel />
    </div>

    <div v-else-if="activeMainTab === 'importexport'" class="tab-content">
      <ImportExportPanel />
    </div>

    <div v-else-if="activeMainTab === 'alerts'" class="tab-content">
      <AlertsEnhancedPanel />
    </div>

    <div v-else-if="activeMainTab === 'retention'" class="tab-content">
      <RetentionPanel />
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
