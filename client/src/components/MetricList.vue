<script setup lang="ts">
import { ref } from 'vue'
import type { MetricConfig, TagsInfo } from '../types'

const props = defineProps<{
  metrics: string[]
  metricConfigs: Map<string, MetricConfig>
  metricTags: Map<string, TagsInfo>
  selectedTags: Map<string, Record<string, string | number>>
}>()

const emit = defineEmits<{
  toggle: [metric: string]
  remove: [metric: string]
  setYAxis: [metric: string, index: number]
  createAlert: [metric: string]
  setTagFilter: [metric: string, key: string, value: string | number | null]
}>()

const expandedMetric = ref<string | null>(null)

function toggleExpand(metric: string, e: Event) {
  e.stopPropagation()
  expandedMetric.value = expandedMetric.value === metric ? null : metric
}

function formatTagValue(val: string | number | null): string {
  if (val === null || val === undefined || val === '') return '全部'
  return String(val)
}
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-header">
      <h2>指标列表</h2>
      <span class="stats-badge">{{ metrics.length }}</span>
    </div>
    <div class="sidebar-content">
      <div v-if="metrics.length === 0" class="empty-state">
        暂无指标，请先写入数据
      </div>
      <div v-for="metric in metrics" :key="metric">
        <div
          class="metric-item"
          :class="{ selected: metricConfigs.get(metric)?.visible }"
          @click="emit('toggle', metric)"
        >
          <div
            class="metric-color"
            :style="{ backgroundColor: metricConfigs.get(metric)?.color || '#64748b' }"
          ></div>
          <span class="metric-name" :title="metric">{{ metric }}</span>
          <div class="metric-actions" @click.stop>
            <button
              class="icon-btn"
              title="展开标签过滤"
              @click="toggleExpand(metric, $event)"
            >
              {{ expandedMetric === metric ? '▲' : '▼' }}
            </button>
            <button
              class="icon-btn"
              title="创建告警规则"
              @click="emit('createAlert', metric)"
            >
              ⚡
            </button>
            <button
              v-if="metricConfigs.get(metric)?.visible"
              class="icon-btn"
              title="Y轴"
              @click="emit('setYAxis', metric, metricConfigs.get(metric)!.yAxisIndex === 0 ? 1 : 0)"
            >
              Y{{ metricConfigs.get(metric)?.yAxisIndex === 0 ? '1' : '2' }}
            </button>
            <button
              v-if="metricConfigs.get(metric)?.visible"
              class="icon-btn"
              title="移除"
              @click="emit('remove', metric)"
            >
              ✕
            </button>
          </div>
        </div>

        <div
          v-if="expandedMetric === metric && metricTags.get(metric)"
          class="tag-filter"
          @click.stop
        >
          <div
            v-for="key in metricTags.get(metric)!.keys"
            :key="key"
            class="tag-filter-row"
          >
            <select
              :value="selectedTags.get(metric)?.[key] ?? ''"
              @change="emit('setTagFilter', metric, key, ($event.target as HTMLSelectElement).value || null)"
            >
              <option value="">{{ key }}: 全部</option>
              <option
                v-for="val in metricTags.get(metric)!.values[key]"
                :key="val"
                :value="val"
              >
                {{ formatTagValue(val) }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
