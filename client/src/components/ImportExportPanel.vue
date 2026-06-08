<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { listMetrics, importData, exportData } from '../api'

const activeTab = ref<'import' | 'export'>('import')
const importFormat = ref<'csv' | 'influx' | 'openmetrics'>('csv')
const importText = ref('')
const importFile = ref<File | null>(null)
const importResult = ref<{ count: number; lines: number } | null>(null)
const importLoading = ref(false)
const importError = ref<string | null>(null)
const exportMetric = ref('')
const exportFormat = ref<'csv' | 'influx' | 'openmetrics'>('csv')
const exportStart = ref(Date.now() - 3600000)
const exportEnd = ref(Date.now())
const exportLoading = ref(false)
const exportError = ref<string | null>(null)
const metrics = ref<string[]>([])

async function loadMetrics() {
  try {
    metrics.value = await listMetrics()
    if (metrics.value.length > 0 && !exportMetric.value) {
      exportMetric.value = metrics.value[0]
    }
  } catch (e: any) {
    console.error('Failed to load metrics:', e)
  }
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

async function handleImport() {
  importLoading.value = true
  importError.value = null
  importResult.value = null

  try {
    let data: string
    if (importFile.value) {
      data = await readFileAsText(importFile.value)
    } else {
      data = importText.value
    }

    if (!data.trim()) {
      throw new Error('No data to import')
    }

    let contentType: string
    switch (importFormat.value) {
      case 'csv':
        contentType = 'text/csv'
        break
      case 'influx':
        contentType = 'application/influxdb-line-protocol'
        break
      case 'openmetrics':
        contentType = 'application/openmetrics-text'
        break
    }

    importResult.value = await importData(contentType, data)
    importText.value = ''
    importFile.value = null
  } catch (e: any) {
    importError.value = e.message || 'Import failed'
  } finally {
    importLoading.value = false
  }
}

function setTimeRange(hours: number) {
  const now = Date.now()
  exportEnd.value = now
  exportStart.value = now - hours * 3600000
}

function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function parseDateTimeLocal(str: string): number {
  return new Date(str).getTime()
}

async function handleExport() {
  exportLoading.value = true
  exportError.value = null

  try {
    if (!exportMetric.value) {
      throw new Error('Please select a metric')
    }
    if (exportStart.value >= exportEnd.value) {
      throw new Error('Start time must be before end time')
    }

    const blob = await exportData(exportMetric.value, exportStart.value, exportEnd.value, exportFormat.value)

    let extension: string
    switch (exportFormat.value) {
      case 'csv':
        extension = 'csv'
        break
      case 'influx':
        extension = 'txt'
        break
      case 'openmetrics':
        extension = 'txt'
        break
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${exportMetric.value}_${new Date(exportStart.value).toISOString().slice(0, 10)}_${new Date(exportEnd.value).toISOString().slice(0, 10)}.${extension}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (e: any) {
    exportError.value = e.message || 'Export failed'
  } finally {
    exportLoading.value = false
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files[0]) {
    importFile.value = target.files[0]
    importText.value = ''
  }
}

function clearFile() {
  importFile.value = null
}

onMounted(() => {
  loadMetrics()
})
</script>

<template>
  <div class="import-export-panel">
    <div class="tabs">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'import' }"
        @click="activeTab = 'import'"
      >
        导入
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'export' }"
        @click="activeTab = 'export'"
      >
        导出
      </button>
    </div>

    <div v-if="activeTab === 'import'" class="tab-content">
      <div class="form-group">
        <label>格式</label>
        <select v-model="importFormat">
          <option value="csv">CSV</option>
          <option value="influx">InfluxDB Line Protocol</option>
          <option value="openmetrics">OpenMetrics</option>
        </select>
      </div>

      <div class="form-group">
        <label>选择文件</label>
        <input
          type="file"
          class="file-input"
          @change="handleFileSelect"
          :disabled="importLoading"
        />
        <div v-if="importFile" class="file-info">
          <span>{{ importFile.name }}</span>
          <button class="icon-btn" @click="clearFile" title="Clear">×</button>
        </div>
      </div>

      <div class="form-group">
        <label>或粘贴数据</label>
        <textarea
          v-model="importText"
          class="textarea"
          placeholder="Paste your data here..."
          rows="6"
          :disabled="importLoading || importFile !== null"
        />
      </div>

      <button
        class="btn btn-primary"
        @click="handleImport"
        :disabled="importLoading || (!importFile && !importText.trim())"
      >
        <span v-if="importLoading">导入中...</span>
        <span v-else>导入</span>
      </button>

      <div v-if="importError" class="error-message">
        {{ importError }}
      </div>

      <div v-if="importResult" class="success-message">
        导入成功: {{ importResult.count }} 个点, {{ importResult.lines }} 行
      </div>
    </div>

    <div v-else class="tab-content">
      <div class="form-group">
        <label>指标</label>
        <select v-model="exportMetric">
          <option v-for="m in metrics" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <div class="form-group">
        <label>格式</label>
        <select v-model="exportFormat">
          <option value="csv">CSV</option>
          <option value="influx">InfluxDB Line Protocol</option>
          <option value="openmetrics">OpenMetrics</option>
        </select>
      </div>

      <div class="form-group">
        <label>时间范围</label>
        <div class="time-buttons">
          <button
            class="time-btn"
            @click="setTimeRange(1)"
            :disabled="exportLoading"
          >
            1h
          </button>
          <button
            class="time-btn"
            @click="setTimeRange(6)"
            :disabled="exportLoading"
          >
            6h
          </button>
          <button
            class="time-btn"
            @click="setTimeRange(24)"
            :disabled="exportLoading"
          >
            24h
          </button>
          <button
            class="time-btn"
            @click="setTimeRange(168)"
            :disabled="exportLoading"
          >
            7d
          </button>
        </div>
      </div>

      <div class="form-group">
        <label>开始时间</label>
        <input
          type="datetime-local"
          :value="formatDateTime(exportStart)"
          @change="exportStart = parseDateTimeLocal(($event.target as HTMLInputElement).value)"
          :disabled="exportLoading"
        />
      </div>

      <div class="form-group">
        <label>结束时间</label>
        <input
          type="datetime-local"
          :value="formatDateTime(exportEnd)"
          @change="exportEnd = parseDateTimeLocal(($event.target as HTMLInputElement).value)"
          :disabled="exportLoading"
        />
      </div>

      <button
        class="btn btn-primary"
        @click="handleExport"
        :disabled="exportLoading || !exportMetric"
      >
        <span v-if="exportLoading">导出中...</span>
        <span v-else>导出</span>
      </button>

      <div v-if="exportError" class="error-message">
        {{ exportError }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.import-export-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  border-bottom: 1px solid #334155;
  margin-bottom: 16px;
}

.tab-btn {
  padding: 12px 20px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab-btn:hover {
  color: #e2e8f0;
}

.tab-btn.active {
  color: #f8fafc;
  border-bottom-color: #3b82f6;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
}

.textarea {
  width: 100%;
  padding: 8px 10px;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 4px;
  color: #e2e8f0;
  font-size: 13px;
  font-family: monospace;
  resize: vertical;
}

.textarea:focus {
  outline: none;
  border-color: #3b82f6;
}

.textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-input {
  width: 100%;
  padding: 8px;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 4px;
  color: #e2e8f0;
  font-size: 12px;
}

.file-input::file-selector-button {
  padding: 4px 12px;
  background: #334155;
  border: 1px solid #475569;
  color: #e2e8f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  margin-right: 8px;
}

.file-input::file-selector-button:hover {
  background: #475569;
}

.file-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding: 8px 10px;
  background: #1e3a5f;
  border: 1px solid #3b82f6;
  border-radius: 4px;
  font-size: 12px;
  color: #93c5fd;
}

.time-buttons {
  display: flex;
  gap: 8px;
}

.time-btn {
  padding: 6px 12px;
  background: #334155;
  border: 1px solid #475569;
  color: #cbd5e1;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.time-btn:hover {
  background: #475569;
}

.error-message {
  margin-top: 12px;
  padding: 10px 12px;
  background: #7f1d1d;
  border: 1px solid #ef4444;
  border-radius: 4px;
  color: #fca5a5;
  font-size: 12px;
}

.success-message {
  margin-top: 12px;
  padding: 10px 12px;
  background: #14532d;
  border: 1px solid #22c55e;
  border-radius: 4px;
  color: #86efac;
  font-size: 12px;
}
</style>
