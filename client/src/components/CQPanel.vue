<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { ContinuousQuery } from '../types'
import { listCQs, createCQ, deleteCQ, toggleCQ } from '../api'

const cqs = ref<ContinuousQuery[]>([])
const showModal = ref(false)
const loading = ref(false)

const form = ref({
  source_metric: '',
  target_metric: '',
  agg_func: 'avg' as const,
  bucket_seconds: 60,
  tags_keep: ''
})

const aggOptions = [
  { value: 'avg', label: '平均值 (avg)' },
  { value: 'min', label: '最小值 (min)' },
  { value: 'max', label: '最大值 (max)' },
  { value: 'sum', label: '总和 (sum)' },
  { value: 'count', label: '计数 (count)' }
]

async function loadCQs() {
  loading.value = true
  try {
    cqs.value = await listCQs()
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!form.value.source_metric.trim()) {
    alert('请输入源指标')
    return
  }
  if (!form.value.target_metric.trim()) {
    alert('请输入目标指标')
    return
  }
  if (form.value.bucket_seconds <= 0) {
    alert('桶时间必须大于 0')
    return
  }

  const tags_keep_str = form.value.tags_keep.trim()
  await createCQ({
    source_metric: form.value.source_metric.trim(),
    target_metric: form.value.target_metric.trim(),
    agg_func: form.value.agg_func,
    bucket_seconds: form.value.bucket_seconds,
    tags_keep: tags_keep_str ? tags_keep_str.split(',').map(s => s.trim()) : undefined
  })

  form.value = {
    source_metric: '',
    target_metric: '',
    agg_func: 'avg',
    bucket_seconds: 60,
    tags_keep: ''
  }
  showModal.value = false
  loadCQs()
}

async function handleDelete(id: number) {
  if (!confirm('确定要删除这个连续聚合任务吗？')) {
    return
  }
  await deleteCQ(id)
  loadCQs()
}

async function handleToggle(id: number, enabled: boolean) {
  await toggleCQ(id, enabled)
  loadCQs()
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

onMounted(() => {
  loadCQs()
})
</script>

<template>
  <div class="cq-panel">
    <div class="sidebar-header" style="padding: 0 0 12px 0; border: none; margin-bottom: 12px;">
      <h3 style="font-size: 14px;">连续聚合任务</h3>
      <button class="btn btn-primary btn-sm" @click="showModal = true">
        + 新建任务
      </button>
    </div>

    <div v-if="loading" class="empty-state">
      加载中...
    </div>

    <div v-else-if="cqs.length === 0" class="empty-state">
      暂无连续聚合任务
    </div>

    <div v-else>
      <div
        v-for="cq in cqs"
        :key="cq.id"
        class="cq-card"
      >
        <div class="cq-header">
          <div class="cq-metrics">
            <span class="cq-metric">{{ cq.source_metric }}</span>
            <span class="cq-arrow">→</span>
            <span class="cq-metric target">{{ cq.target_metric }}</span>
          </div>
          <span
            class="cq-status"
            :class="cq.enabled === 1 ? 'active' : 'inactive'"
          >
            {{ cq.enabled === 1 ? '运行中' : '已停用' }}
          </span>
        </div>

        <div class="cq-details">
          <span class="stats-badge">{{ cq.agg_func }}</span>
          <span class="stats-badge">{{ cq.bucket_seconds }}s</span>
          <span v-if="cq.tags_keep && cq.tags_keep.length > 0" class="stats-badge">
            tags: {{ cq.tags_keep.join(', ') }}
          </span>
        </div>

        <div class="cq-footer">
          <span class="cq-time">最后处理: {{ formatTime(cq.last_processed_ts) }}</span>
          <div class="cq-actions">
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="cq.enabled === 1"
                @change="handleToggle(cq.id, cq.enabled !== 1)"
              />
              <span class="toggle-slider"></span>
            </label>
            <button
              class="btn btn-danger btn-sm"
              @click="handleDelete(cq.id)"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>创建连续聚合任务</h3>
          <button class="icon-btn" @click="showModal = false">✕</button>
        </div>

        <div class="form-group">
          <label>源指标</label>
          <input
            type="text"
            v-model="form.source_metric"
            placeholder="例如: cpu_usage"
          />
        </div>

        <div class="form-group">
          <label>目标指标</label>
          <input
            type="text"
            v-model="form.target_metric"
            placeholder="例如: cpu_usage.1m.avg"
          />
        </div>

        <div class="form-group">
          <label>聚合函数</label>
          <select v-model="form.agg_func">
            <option v-for="opt in aggOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="form-group">
          <label>桶时间 (秒)</label>
          <input
            type="number"
            v-model.number="form.bucket_seconds"
            min="1"
            placeholder="例如: 60"
          />
        </div>

        <div class="form-group">
          <label>保留标签 (逗号分隔, 可选)</label>
          <input
            type="text"
            v-model="form.tags_keep"
            placeholder="例如: host, region"
          />
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showModal = false">取消</button>
          <button class="btn btn-primary" @click="handleCreate">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cq-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.cq-card {
  padding: 12px;
  background: #0f172a;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #334155;
}

.cq-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.cq-metrics {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.cq-metric {
  font-weight: 600;
  color: #e2e8f0;
}

.cq-metric.target {
  color: #3b82f6;
}

.cq-arrow {
  color: #64748b;
}

.cq-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
}

.cq-status.active {
  background: #14532d;
  color: #86efac;
}

.cq-status.inactive {
  background: #1e293b;
  color: #64748b;
}

.cq-details {
  margin-bottom: 8px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.cq-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid #334155;
}

.cq-time {
  font-size: 11px;
  color: #64748b;
  font-family: monospace;
}

.cq-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #334155;
  transition: 0.2s;
  border-radius: 20px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: #94a3b8;
  transition: 0.2s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: #3b82f6;
}

input:checked + .toggle-slider:before {
  transform: translateX(16px);
  background-color: white;
}
</style>
