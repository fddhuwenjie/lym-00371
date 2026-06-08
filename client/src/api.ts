import axios from 'axios';
import type { Point, QueryParams, QueryResult, AlertRule, Alert, TagsInfo, ContinuousQuery, Silence, NotificationChannel, RetentionPolicy, PromQLResult } from './types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

export async function writePoints(points: Point | Point[]): Promise<{ count: number }> {
  const res = await api.post('/points', points);
  return res.data;
}

export async function queryData(params: QueryParams): Promise<QueryResult> {
  const res = await api.post('/query', params);
  return res.data;
}

export async function listMetrics(): Promise<string[]> {
  const res = await api.get('/metrics');
  return res.data;
}

export async function getMetricTags(metric: string): Promise<TagsInfo> {
  const res = await api.get(`/metrics/${metric}/tags`);
  return res.data;
}

export async function listAlertRules(): Promise<AlertRule[]> {
  const res = await api.get('/alerts/rules');
  return res.data;
}

export async function createAlertRule(rule: Omit<AlertRule, 'id' | 'enabled' | 'created_at'>): Promise<{ id: number }> {
  const res = await api.post('/alerts/rules', rule);
  return res.data;
}

export async function deleteAlertRule(id: number): Promise<void> {
  await api.delete(`/alerts/rules/${id}`);
}

export async function listAlerts(limit = 100): Promise<Alert[]> {
  const res = await api.get('/alerts', { params: { limit } });
  return res.data;
}

export async function getOpenAlerts(): Promise<Alert[]> {
  const res = await api.get('/alerts/open');
  return res.data;
}

export async function listCQs(): Promise<ContinuousQuery[]> {
  const res = await api.get('/cq');
  return res.data;
}

export async function createCQ(cq: Omit<ContinuousQuery, 'id' | 'last_processed_ts' | 'enabled' | 'created_at'>): Promise<{ id: number }> {
  const res = await api.post('/cq', cq);
  return res.data;
}

export async function deleteCQ(id: number): Promise<void> {
  await api.delete(`/cq/${id}`);
}

export async function toggleCQ(id: number, enabled: boolean): Promise<void> {
  await api.post(`/cq/${id}/toggle`, { enabled });
}

export async function importData(contentType: string, data: string | Blob): Promise<{ count: number; lines: number }> {
  const res = await api.post('/import', data, {
    headers: { 'Content-Type': contentType }
  });
  return res.data;
}

export async function exportData(metric: string, start: number, end: number, format: 'csv' | 'influx' | 'openmetrics'): Promise<Blob> {
  const res = await api.get('/export', {
    params: { metric, start, end, format },
    responseType: 'blob'
  });
  return res.data;
}

export async function listSilences(includeExpired = false): Promise<Silence[]> {
  const res = await api.get('/alerts/silences', { params: { include_expired: includeExpired } });
  return res.data;
}

export async function createSilence(silence: Omit<Silence, 'id' | 'created_at'>): Promise<{ id: number }> {
  const res = await api.post('/alerts/silences', silence);
  return res.data;
}

export async function deleteSilence(id: number): Promise<void> {
  await api.delete(`/alerts/silences/${id}`);
}

export async function listChannels(): Promise<NotificationChannel[]> {
  const res = await api.get('/alerts/channels');
  return res.data;
}

export async function createChannel(channel: Omit<NotificationChannel, 'id' | 'enabled' | 'created_at'>): Promise<{ id: number }> {
  const res = await api.post('/alerts/channels', channel);
  return res.data;
}

export async function deleteChannel(id: number): Promise<void> {
  await api.delete(`/alerts/channels/${id}`);
}

export async function queryPromQL(query: string, start: number, end: number, step: number): Promise<PromQLResult> {
  const res = await api.post('/promql', { query, start, end, step });
  return res.data;
}

export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  const res = await api.get('/retention');
  return res.data;
}

export async function createRetentionPolicy(policy: Omit<RetentionPolicy, 'id' | 'last_run' | 'enabled' | 'created_at'>): Promise<{ id: number }> {
  const res = await api.post('/retention', policy);
  return res.data;
}

export async function deleteRetentionPolicy(id: number): Promise<void> {
  await api.delete(`/retention/${id}`);
}

export async function toggleRetentionPolicy(id: number, enabled: boolean): Promise<void> {
  await api.post(`/retention/${id}/toggle`, { enabled });
}

export async function listArchives(): Promise<Record<string, string[]>> {
  const res = await api.get('/archives');
  return res.data;
}

export async function restoreArchive(file: string): Promise<{ count: number }> {
  const res = await api.post(`/archives/${file}/restore`);
  return res.data;
}
