<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AlertRule } from '../types'

const props = defineProps<{
  metrics: string[]
  preselectedMetric: string
}>()

const emit = defineEmits<{
  close: []
  create: [rule: Omit<AlertRule, 'id' | 'enabled' | 'created_at'>]
}>()

const form = ref({
  metric: '',
  operator: '>' as AlertRule['operator'],
  threshold: 0,
  duration: 60000,
  tags: ''
})

const operators = [
  { value: '>', label: '大于 (>)' },
  { value: '<', label: '小于 (<)' },
  { value: '>=', label: '大于等于 (>=)' },
  { value: '<=', label: '小于等于 (<=)' },
  { value: '==', label: '等于 (==)' },
  { value: '!=', label: '不等于 (!=)' }
]

const durationOptions = [
  { value: 1000, label: '1秒' },
  { value: 5000, label: '5秒' },
  { value: 10000, label: '10秒' },
  { value: 30000, label: '30秒' },
  { value: 60000, label: '1分钟' },
  { value: 300000, label: '5分钟' },
  { value: 900000, label: '15分钟' }
]

watch(() => props.preselectedMetric, (val) => {
  if (val) {
    form.value.metric = val
  }
}, { immediate: true })

function handleSubmit() {
  if (!form.value.metric) {
    alert('请选择指标')
    return
  }

  let tags: Record<string, string | number> | undefined
  if (form.value.tags.trim()) {
    try {
      tags = JSON.parse(form.value.tags)
    } catch (e) {
      alert('Tags 必须是有效的 JSON 格式')
      return
    }
  }

  emit('create', {
    metric: form.value.metric,
    operator: form.value.operator,
    threshold: form.value.threshold,
    duration: form.value.duration,
    tags
  })
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>创建告警规则</h3>
        <button class="icon-btn" @click="emit('close')">✕</button>
      </div>

      <div class="form-group">
        <label>指标</label>
        <select v-model="form.metric">
          <option value="">请选择指标</option>
          <option v-for="m in metrics" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>条件</label>
        <div style="display: flex; gap: 8px;">
          <select v-model="form.operator" style="flex: 1;">
            <option v-for="op in operators" :key="op.value" :value="op.value">
              {{ op.label }}
            </option>
          </select>
          <input
            type="number"
            v-model.number="form.threshold"
            step="any"
            placeholder="阈值"
            style="flex: 1;"
          />
        </div>
      </div>

      <div class="form-group">
        <label>持续时间</label>
        <select v-model.number="form.duration">
          <option v-for="d in durationOptions" :key="d.value" :value="d.value">
            {{ d.label }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label>标签过滤 (JSON, 可选)</label>
        <input
          type="text"
          v-model="form.tags"
          placeholder='例如: {"host": "server1"}'
        />
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" @click="emit('close')">取消</button>
        <button class="btn btn-primary" @click="handleSubmit">创建</button>
      </div>
    </div>
  </div>
</template>
