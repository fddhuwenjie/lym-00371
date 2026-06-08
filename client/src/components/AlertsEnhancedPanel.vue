<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Silence, SilenceMatcher, NotificationChannel } from '../types'
import {
  listSilences,
  createSilence,
  deleteSilence,
  listChannels,
  createChannel,
  deleteChannel
} from '../api'

const activeTab = ref<'silences' | 'channels'>('silences')
const silences = ref<Silence[]>([])
const channels = ref<NotificationChannel[]>([])
const showSilenceModal = ref(false)
const showChannelModal = ref(false)
const includeExpired = ref(false)

const silenceForm = ref({
  matchers: [{ name: '', value: '', isRegex: false, isEqual: true }],
  starts_at: Date.now(),
  ends_at: Date.now() + 3600000,
  comment: '',
  created_by: ''
})

const channelForm = ref({
  name: '',
  type: 'webhook' as const,
  config: {} as any
})

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

function formatDateInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function loadSilences() {
  silences.value = await listSilences(includeExpired.value)
}

async function loadChannels() {
  channels.value = await listChannels()
}

function addMatcher() {
  silenceForm.value.matchers.push({ name: '', value: '', isRegex: false, isEqual: true })
}

function removeMatcher(index: number) {
  silenceForm.value.matchers.splice(index, 1)
}

async function handleCreateSilence() {
  const validMatchers = silenceForm.value.matchers.filter(m => m.name && m.value)
  if (validMatchers.length === 0) {
    alert('请至少填写一个匹配条件')
    return
  }
  if (!silenceForm.value.created_by.trim()) {
    alert('请填写创建人')
    return
  }
  if (silenceForm.value.ends_at <= silenceForm.value.starts_at) {
    alert('结束时间必须大于开始时间')
    return
  }

  await createSilence({
    matchers: validMatchers,
    starts_at: silenceForm.value.starts_at,
    ends_at: silenceForm.value.ends_at,
    comment: silenceForm.value.comment || undefined,
    created_by: silenceForm.value.created_by || undefined
  })

  resetSilenceForm()
  showSilenceModal.value = false
  await loadSilences()
}

async function handleDeleteSilence(id: number) {
  if (!confirm('确定要删除这条静默规则吗？')) return
  await deleteSilence(id)
  await loadSilences()
}

function resetSilenceForm() {
  silenceForm.value = {
    matchers: [{ name: '', value: '', isRegex: false, isEqual: true }],
    starts_at: Date.now(),
    ends_at: Date.now() + 3600000,
    comment: '',
    created_by: ''
  }
}

function resetChannelForm() {
  channelForm.value = {
    name: '',
    type: 'webhook',
    config: {}
  }
}

async function handleCreateChannel() {
  if (!channelForm.value.name.trim()) {
    alert('请填写渠道名称')
    return
  }

  const config: Record<string, any> = {}

  if (channelForm.value.type === 'webhook') {
    if (!channelForm.value.config.url?.trim()) {
      alert('请填写 Webhook URL')
      return
    }
    config.url = channelForm.value.config.url
    if (channelForm.value.config.headers?.trim()) {
      try {
        config.headers = JSON.parse(channelForm.value.config.headers)
      } catch (e) {
        alert('Headers 必须是有效的 JSON 格式')
        return
      }
    }
  } else if (channelForm.value.type === 'smtp') {
    if (!channelForm.value.config.host?.trim()) {
      alert('请填写 SMTP 主机地址')
      return
    }
    if (!channelForm.value.config.from?.trim()) {
      alert('请填写发件人地址')
      return
    }
    if (!channelForm.value.config.to?.trim()) {
      alert('请填写收件人地址')
      return
    }

    config.smtp = {
      host: channelForm.value.config.host,
      port: Number(channelForm.value.config.port) || 587,
      secure: channelForm.value.config.secure || false,
      auth: {
        user: channelForm.value.config.user || '',
        pass: channelForm.value.config.pass || ''
      }
    }
    config.from = channelForm.value.config.from
    config.to = channelForm.value.config.to
  }

  await createChannel({
    name: channelForm.value.name,
    type: channelForm.value.type,
    config
  })

  resetChannelForm()
  showChannelModal.value = false
  await loadChannels()
}

async function handleDeleteChannel(id: number) {
  if (!confirm('确定要删除这个通知渠道吗？')) return
  await deleteChannel(id)
  await loadChannels()
}

function formatMatcher(m: SilenceMatcher): string {
  const op = m.isEqual ? '=' : '!='
  const val = m.isRegex ? '~' : ''
  return `${m.name} ${op}${val} ${m.value}`
}

function formatChannelConfig(channel: NotificationChannel): string {
  if (channel.type === 'webhook') {
    return `URL: ${channel.config.url || '未配置'}`
  } else if (channel.type === 'smtp') {
    const smtp = channel.config.smtp || {}
    return `${smtp.host || '未配置'} → ${channel.config.to || '未配置'}`
  }
  return '未知配置'
}

function isExpired(silence: Silence): boolean {
  return silence.ends_at < Date.now()
}

onMounted(() => {
  loadSilences()
  loadChannels()
})
</script>

<template>
  <div class="enhanced-panel">
    <div class="panel-tabs-horizontal">
      <button
        class="tab-btn-horizontal"
        :class="{ active: activeTab === 'silences' }"
        @click="activeTab = 'silences'"
      >
        静默规则
      </button>
      <button
        class="tab-btn-horizontal"
        :class="{ active: activeTab === 'channels' }"
        @click="activeTab = 'channels'"
      >
        通知渠道
      </button>
    </div>

    <div class="panel-content">
      <div v-if="activeTab === 'silences'">
        <div class="panel-header">
          <div class="panel-header-left">
            <h3>静默规则</h3>
            <label class="toggle-label">
              <input type="checkbox" v-model="includeExpired" @change="loadSilences" />
              包含已过期
            </label>
          </div>
          <button class="btn btn-primary btn-sm" @click="showSilenceModal = true">
            + 新建静默
          </button>
        </div>

        <div v-if="silences.length === 0" class="empty-state">
          暂无静默规则
        </div>

        <div
          v-for="silence in silences"
          :key="silence.id"
          class="silence-card"
          :class="{ expired: isExpired(silence) }"
        >
          <div class="silence-header">
            <div class="silence-matchers">
              <span
                v-for="(m, idx) in silence.matchers"
                :key="idx"
                class="matcher-badge"
              >
                {{ formatMatcher(m) }}
              </span>
            </div>
            <span v-if="isExpired(silence)" class="expired-badge">已过期</span>
          </div>
          <div class="silence-details">
            <div class="silence-time">
              <span class="detail-label">时间:</span>
              {{ formatTime(silence.starts_at) }} → {{ formatTime(silence.ends_at) }}
            </div>
            <div v-if="silence.comment" class="silence-comment">
              <span class="detail-label">备注:</span>
              {{ silence.comment }}
            </div>
            <div class="silence-creator">
              <span class="detail-label">创建人:</span>
              {{ silence.created_by || '未知' }}
            </div>
          </div>
          <div class="silence-actions">
            <button class="btn btn-danger btn-sm" @click="handleDeleteSilence(silence.id)">
              删除
            </button>
          </div>
        </div>
      </div>

      <div v-else>
        <div class="panel-header">
          <h3>通知渠道</h3>
          <button class="btn btn-primary btn-sm" @click="showChannelModal = true">
            + 新建渠道
          </button>
        </div>

        <div v-if="channels.length === 0" class="empty-state">
          暂无通知渠道
        </div>

        <div
          v-for="channel in channels"
          :key="channel.id"
          class="channel-card"
        >
          <div class="channel-header">
          <div class="channel-info">
            <div class="channel-name">{{ channel.name }}</div>
            <div class="channel-type">
              <span class="type-badge" :class="channel.type">
                {{ channel.type === 'webhook' ? 'Webhook' : 'SMTP' }}
              </span>
            </div>
          </div>
          <div class="channel-config">
            {{ formatChannelConfig(channel) }}
          </div>
        </div>
          <div class="channel-actions">
            <button class="btn btn-danger btn-sm" @click="handleDeleteChannel(channel.id)">
              删除
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showSilenceModal" class="modal-overlay" @click.self="showSilenceModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>创建静默规则</h3>
          <button class="icon-btn" @click="showSilenceModal = false">✕</button>
        </div>

        <div class="form-group">
          <label>匹配条件</label>
          <div v-for="(matcher, index) in silenceForm.matchers" :key="index" class="matcher-row">
            <input
              type="text"
              v-model="matcher.name"
              placeholder="标签名"
              class="matcher-input"
            />
            <button
              class="matcher-toggle"
              :class="{ active: matcher.isEqual }"
              @click="matcher.isEqual = !matcher.isEqual"
            >
              {{ matcher.isEqual ? '=' : '!=' }}
            </button>
            <button
              class="matcher-toggle"
              :class="{ active: matcher.isRegex }"
              @click="matcher.isRegex = !matcher.isRegex"
              title="正则匹配"
            >
              ~
            </button>
            <input
              type="text"
              v-model="matcher.value"
              placeholder="标签值"
              class="matcher-input"
            />
            <button
              v-if="silenceForm.matchers.length > 1"
              class="matcher-remove"
              @click="removeMatcher(index)"
            >
              ✕
            </button>
          </div>
          <button class="btn btn-secondary btn-sm mt-8" @click="addMatcher">
            + 添加匹配条件
          </button>
        </div>

        <div class="form-group">
          <label>开始时间</label>
          <input
            type="datetime-local"
            :value="formatDateInput(silenceForm.starts_at)"
            @input="silenceForm.starts_at = new Date(($event.target as HTMLInputElement).value).getTime()"
          />
        </div>

        <div class="form-group">
          <label>结束时间</label>
          <input
            type="datetime-local"
            :value="formatDateInput(silenceForm.ends_at)"
            @input="silenceForm.ends_at = new Date(($event.target as HTMLInputElement).value).getTime()"
          />
        </div>

        <div class="form-group">
          <label>备注 (可选)</label>
          <input
            type="text"
            v-model="silenceForm.comment"
            placeholder="静默原因"
          />
        </div>

        <div class="form-group">
          <label>创建人</label>
          <input
            type="text"
            v-model="silenceForm.created_by"
            placeholder="您的名字"
          />
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showSilenceModal = false">取消</button>
          <button class="btn btn-primary" @click="handleCreateSilence">创建</button>
        </div>
      </div>
    </div>

    <div v-if="showChannelModal" class="modal-overlay" @click.self="showChannelModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>创建通知渠道</h3>
          <button class="icon-btn" @click="showChannelModal = false">✕</button>
        </div>

        <div class="form-group">
          <label>渠道名称</label>
          <input
            type="text"
            v-model="channelForm.name"
            placeholder="例如: 团队告警"
          />
        </div>

        <div class="form-group">
          <label>类型</label>
          <select v-model="channelForm.type">
            <option value="webhook">Webhook</option>
            <option value="smtp">SMTP 邮件</option>
          </select>
        </div>

        <div v-if="channelForm.type === 'webhook'">
          <div class="form-group">
            <label>Webhook URL</label>
            <input
              type="text"
              v-model="channelForm.config.url"
              placeholder="https://..."
            />
          </div>
          <div class="form-group">
            <label>请求头 Headers (JSON, 可选)</label>
            <input
              type="text"
              v-model="channelForm.config.headers"
              placeholder='{"Authorization": "Bearer xxx"}'
            />
          </div>
        </div>

        <div v-else-if="channelForm.type === 'smtp'">
          <div class="form-row">
            <div class="form-group" style="flex: 2;">
              <label>SMTP 主机</label>
              <input
                type="text"
                v-model="channelForm.config.host"
                placeholder="smtp.example.com"
              />
            </div>
            <div class="form-group" style="flex: 1;">
              <label>端口</label>
              <input
                type="number"
                v-model.number="channelForm.config.port"
                placeholder="587"
              />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>用户名</label>
              <input
                type="text"
                v-model="channelForm.config.user"
                placeholder="user@example.com"
              />
            </div>
            <div class="form-group">
              <label>密码</label>
              <input
                type="password"
                v-model="channelForm.config.pass"
                placeholder="密码"
              />
            </div>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="channelForm.config.secure" />
              使用 SSL/TLS
            </label>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>发件人</label>
              <input
                type="text"
                v-model="channelForm.config.from"
                placeholder="alerts@example.com"
              />
            </div>
            <div class="form-group">
              <label>收件人</label>
              <input
                type="text"
                v-model="channelForm.config.to"
                placeholder="admin@example.com"
              />
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" @click="showChannelModal = false">取消</button>
          <button class="btn btn-primary" @click="handleCreateChannel">创建</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.enhanced-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-tabs-horizontal {
  display: flex;
  border-bottom: 1px solid #334155;
  background: #1e293b;
}

.tab-btn-horizontal {
  flex: 1;
  padding: 12px 16px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  border-bottom: 2px solid transparent;
}

.tab-btn-horizontal:hover {
  background: #334155;
  color: #e2e8f0;
}

.tab-btn-horizontal.active {
  color: #f8fafc;
  border-bottom-color: #3b82f6;
  background: #334155;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.panel-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.panel-header h3 {
  font-size: 14px;
  font-weight: 600;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
}

.toggle-label input {
  cursor: pointer;
}

.silence-card {
  padding: 12px;
  background: #0f172a;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #334155;
}

.silence-card.expired {
  opacity: 0.6;
}

.silence-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.silence-matchers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.matcher-badge {
  display: inline-block;
  padding: 2px 8px;
  background: #1e3a5f;
  border: 1px solid #3b82f6;
  border-radius: 4px;
  font-size: 11px;
  font-family: monospace;
  color: #93c5fd;
}

.expired-badge {
  padding: 2px 8px;
  background: #7f1d1d;
  border-radius: 10px;
  font-size: 10px;
  color: #fca5a5;
  flex-shrink: 0;
  margin-left: 8px;
}

.silence-details {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 8px;
}

.silence-time,
.silence-comment,
.silence-creator {
  margin-bottom: 4px;
  font-family: monospace;
}

.detail-label {
  color: #64748b;
  margin-right: 4px;
}

.silence-actions {
  display: flex;
  justify-content: flex-end;
}

.channel-card {
  padding: 12px;
  background: #0f172a;
  border-radius: 6px;
  margin-bottom: 8px;
  border: 1px solid #334155;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.channel-info {
  flex: 1;
}

.channel-header {
  margin-bottom: 4px;
}

.channel-name {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 2px;
}

.channel-type {
  margin-bottom: 4px;
}

.type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 500;
}

.type-badge.webhook {
  background: #1e3a5f;
  color: #93c5fd;
}

.type-badge.smtp {
  background: #14532d;
  color: #86efac;
}

.channel-config {
  font-size: 12px;
  color: #94a3b8;
  font-family: monospace;
}

.channel-actions {
  flex-shrink: 0;
  margin-left: 12px;
}

.matcher-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.matcher-input {
  flex: 1;
  padding: 8px 10px;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 4px;
  color: #e2e8f0;
  font-size: 13px;
}

.matcher-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.matcher-toggle {
  width: 36px;
  height: 36px;
  background: #334155;
  border: 1px solid #475569;
  border-radius: 4px;
  color: #94a3b8;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}

.matcher-toggle:hover {
  background: #475569;
}

.matcher-toggle.active {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
}

.matcher-remove {
  width: 36px;
  height: 36px;
  background: transparent;
  border: 1px solid #7f1d1d;
  border-radius: 4px;
  color: #ef4444;
  cursor: pointer;
  font-size: 12px;
}

.matcher-remove:hover {
  background: #7f1d1d;
}

.mt-8 {
  margin-top: 8px;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-group {
  flex: 1;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: #94a3b8;
}

.checkbox-label input {
  cursor: pointer;
}

.empty-state {
  text-align: center;
  color: #64748b;
  padding: 40px 20px;
  font-size: 13px;
}
</style>
