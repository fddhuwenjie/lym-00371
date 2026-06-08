import axios from 'axios';
import type { Point, QueryParams, QueryResult, AlertRule, Alert, TagsInfo } from './types';

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
