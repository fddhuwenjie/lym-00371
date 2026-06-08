<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { RetentionPolicy } from '../types'
import {
  listRetentionPolicies,
  createRetentionPolicy,
  deleteRetentionPolicy,
  toggleRetentionPolicy,
  listArchives,
  restoreArchive
} from '../api'

const activeTab = ref<'policies' | 'archives'>('policies')
const policies = ref<RetentionPolicy[]>([])
const archives = ref<Record<string, string[]>>({})
const showPolicyModal = ref(false)
const policyForm = ref({
  metric_pattern: '',
  retention_days: 30,
  archive: false
})
const restoreLoading = ref<string | null>(null)
const restoreResult = ref<string | null>(null)

async function loadPolicies() {
  try {
    policies.value = await listRetentionPolicies()
  } catch (e) {
    console.error('Failed to load policies:', e)
  }
}

async function loadArchives() {
  try {
    archives.value = await listArchives()
  } catch (e) {
    console.error('Failed to load archives:', e)
  }
}

async function handleCreatePolicy() {
  if (!policyForm.value.metric_pattern.trim()) {
    alert('请输入指标模式')
    return
  }
  if (policyForm.value.retention_days <= 0) {
    alert('保留天数必须大于 0')
    return
  }

  try {
    await createRetentionPolicy({
      metric_pattern: policyForm.value.metric_pattern,
      retention_days: policyForm.value.retention_days,
      archive: policyForm.value.archive ? 1 : 0
    })
    await loadPolicies()
    showPolicyModal.value = false
    policyForm.value = {
      metric_pattern: '',
      retention_days: 30,
      archive: false
    }
  } catch (e) {
    console.error('Failed to create policy:', e)
    alert('创建策略失败')
  }
}

async function handleDeletePolicy(id: number) {
  if (!confirm('确定要删除这个保留策略吗？')) {
    return
  }

  try {
    await deleteRetentionPolicy(id)
    await loadPolicies()
  } catch (e) {
    console.error('Failed to delete policy:', e)
    alert('删除策略失败')
  }
}

async function handleTogglePolicy(id: number, enabled: number) {
  try {
    await toggleRetentionPolicy(id, enabled === 0)
    await loadPolicies()
  } catch (e) {
    console.error('Failed to toggle policy:', e)
    alert('切换策略状态失败')
  }
}

async function handleRestore(metric: string, month: string) {
  const key = `${metric}/${month}`
  restoreLoading.value = key
  restoreResult.value = null

  try {
    const result = await restoreArchive(key)
    restoreResult.value = `成功恢复 ${result.count} 个数据点`
    await loadArchives()
  } catch (e) {
    console.error('Failed to restore archive:', e)
    restoreResult.value = '恢复归档失败'
  } finally {
    restoreLoading.value = null
  }
}

function formatTime(ts: number): string {
  if (!ts) return '从未运行'
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
  loadPolicies()
  loadArchives()
})
</script>

<template>
  <div class="panel-content">
    <div class="sidebar-header" style="padding: 0 0 12px 0; border: none; margin-bottom: 12px;">
      <div style="display: flex; gap: 8px;">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'policies' }"
          style="padding: 8px 16px; border-radius: 4px; border: 1px solid #334155;"
          @click="activeTab = 'policies'"
        >
          保留策略
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'archives' }"
          style="padding: 8px 16px; border-radius: 4px; border: 1px solid #334155;"
          @click="activeTab = 'archives'"
        >
          归档管理
        </button>
      </div>
      <button
        v-if="activeTab === 'policies'"
        class="btn btn-primary btn-sm"
        @click="showPolicyModal = true"
      >
        + 新建策略
      </button>
    </div>

    <div v-if="activeTab === 'policies'">
      <div v-if="policies.length === 0" class="empty-state">
        暂无保留策略
      </div>

      <div
        v-for="policy in policies"
        :key="policy.id"
        class="alert-rule-item"
      >
        <div class="rule-info">
          <div class="rule-metric">
            {{ policy.metric_pattern }}
            <span class="stats-badge">{{ policy.retention_days }} 天</span>
            <span v-if="policy.archive === 1" class="stats-badge" style="background: #1e3a5f; color: #60a5fa;">归档</span>
            <span
              class="stats-badge"
              :style="policy.enabled === 1 ? 'background: #14532d; color: #86efac;' : 'background: #3f3f46; color: #a1a1aa;'"
            >
              {{ policy.enabled === 1 ? '已启用' : '已禁用' }}
            </span>
          </div>
          <div class="rule-condition">
            上次运行: {{ formatTime(policy.last_run) }}
          </div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button
            class="btn btn-sm"
            :class="policy.enabled === 1 ? 'btn-secondary' : 'btn-primary'"
            @click="handleTogglePolicy(policy.id, policy.enabled)"
          >
            {{ policy.enabled === 1 ? '禁用' : '启用' }}
          </button>
          <button
            class="btn btn-danger btn-sm"
            @click="handleDeletePolicy(policy.id)"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <div v-else>
      <div v-if="restoreResult" style="padding: 10px 12px; background: #14532d; border-radius: 6px; margin-bottom: 12px; font-size: 13px; color: #86efac;">
        {{ restoreResult }}
      </div>

      <div v-if="Object.keys(archives).length === 0" class="empty-state">
        暂无归档数据
      </div>

      <div
        v-for="(months, metric) in archives"
        :key="metric"
        style="margin-bottom: 16px;"
      >
        <div class="rule-metric" style="margin-bottom: 8px;">{{ metric }}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          <div
            v-for="month in months"
            :key="month"
            class="alert-rule-item"
            style="padding: 8px 12px; margin-bottom: 0; min-width: 180px;"
          >
            <div class="rule-info">
              <div class="rule-condition" style="font-family: monospace;">{{ month }}</div>
            </div>
            <button
              class="btn btn-primary btn-sm"
              :disabled="restoreLoading === `${metric}/${month}`"
              @click="handleRestore(metric, month)"
            >
              <span v-if="restoreLoading === `${metric}/${month}`">恢复中...</span>
              <span v-else>恢复</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showPolicyModal" class="modal-overlay" @click.self="showPolicyModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>创建保留策略</h3>
          <button class="icon-btn" @click="showPolicyModal = false">✕</button>
        </div>

        <div class="form-group">
          <label>指标模式 (Glob 模式, 例如 cpu.*)</label>
          <input
            type="text"
            v-model="policyForm.metric_pattern"
            placeholder="例如: cpu.*, memory.*"
          />
        </div>

        <div class="form-group">
          <label>保留天数</label>
          <input
            type="number"
            v-model.number="policyForm.retention_days"
            min="1"
            placeholder="30"
          />
        </div>

        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input
              type="checkbox"
              v-model="policyForm.archive"
              style="width: auto; margin: 0;"
            />
            删除前归档
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showPolicyModal = false">取消</button>
          <button class="btn btn-primary" @click="handleCreatePolicy">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>
