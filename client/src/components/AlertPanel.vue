<script setup lang="ts">
import type { AlertRule, Alert } from '../types'

const props = defineProps<{
  tab: 'alerts' | 'rules'
  alerts: Alert[]
  alertRules: AlertRule[]
}>()

const emit = defineEmits<{
  createRule: []
  deleteRule: [id: number]
}>()

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟`
  const hour = Math.floor(min / 60)
  return `${hour}小时`
}

function parseTags(tagsStr: string | null): Record<string, string | number> | null {
  if (!tagsStr) return null
  try {
    return JSON.parse(tagsStr)
  } catch {
    return null
  }
}
</script>

<template>
  <div class="panel-content">
    <div v-if="tab === 'alerts'">
      <div class="sidebar-header" style="padding: 0 0 12px 0; border: none; margin-bottom: 12px;">
        <h3 style="font-size: 14px;">告警历史</h3>
        <button class="btn btn-primary btn-sm" @click="emit('createRule')">
          + 新建规则
        </button>
      </div>

      <div v-if="alerts.length === 0" class="empty-state">
        暂无告警
      </div>

      <div
        v-for="alert in alerts"
        :key="alert.id"
        class="alert-item"
        :class="{ resolved: alert.resolved === 1 }"
      >
        <div class="alert-header">
          <span class="alert-metric">{{ alert.metric }}</span>
          <span
            class="alert-status"
            :class="alert.resolved === 1 ? 'resolved' : 'active'"
          >
            {{ alert.resolved === 1 ? '已恢复' : '告警中' }}
          </span>
        </div>
        <div class="alert-details">
          {{ alert.metric }} {{ alert.operator }} {{ alert.threshold }}
          (当前: {{ alert.value.toFixed(2) }})
        </div>
        <div class="alert-details" style="margin-top: 4px;">
          开始: {{ formatTime(alert.start_ts) }}
          <span v-if="alert.end_ts">→ 结束: {{ formatTime(alert.end_ts) }}</span>
        </div>
      </div>
    </div>

    <div v-else>
      <div class="sidebar-header" style="padding: 0 0 12px 0; border: none; margin-bottom: 12px;">
        <h3 style="font-size: 14px;">告警规则</h3>
        <button class="btn btn-primary btn-sm" @click="emit('createRule')">
          + 新建规则
        </button>
      </div>

      <div v-if="alertRules.length === 0" class="empty-state">
        暂无告警规则
      </div>

      <div
        v-for="rule in alertRules"
        :key="rule.id"
        class="alert-rule-item"
      >
        <div class="rule-info">
          <div class="rule-metric">{{ rule.metric }}</div>
          <div class="rule-condition">
            {{ rule.metric }} {{ rule.operator }} {{ rule.threshold }}
            持续 {{ formatDuration(rule.duration) }}
            <span v-if="parseTags(rule.tags as any)">
              (tags: {{ JSON.stringify(parseTags(rule.tags as any)) }})
            </span>
          </div>
        </div>
        <button
          class="btn btn-danger btn-sm"
          @click="emit('deleteRule', rule.id)"
        >
          删除
        </button>
      </div>
    </div>
  </div>
</template>
