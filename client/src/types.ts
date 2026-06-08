export interface Point {
  metric: string;
  timestamp: number;
  value: number;
  tags?: Record<string, string | number>;
}

export interface QueryParams {
  metric: string;
  start: number;
  end: number;
  tags?: Record<string, string | number>;
  aggregation?: 'avg' | 'min' | 'max' | 'sum' | 'count';
  bucketSeconds?: number;
  maxPoints?: number;
}

export interface QueryResult {
  metric: string;
  points: { timestamp: number; value: number }[];
  downsampled: boolean;
  originalCount: number;
}

export interface AlertRule {
  id: number;
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
  duration: number;
  tags?: Record<string, string | number>;
  enabled: number;
  created_at: number;
  group_by?: string[];
  severity?: 'critical' | 'warning' | 'info';
  notification_channels?: string[];
}

export interface Alert {
  id: number;
  rule_id: number;
  metric: string;
  value: number;
  threshold: number;
  operator: string;
  start_ts: number;
  end_ts?: number;
  tags?: Record<string, string | number>;
  resolved: number;
  group_key?: string;
  severity?: string;
  notified?: number;
}

export interface MetricConfig {
  name: string;
  color: string;
  yAxisIndex: number;
  normalized: boolean;
  visible: boolean;
}

export interface TagsInfo {
  keys: string[];
  values: Record<string, (string | number)[]>;
}

export interface ContinuousQuery {
  id: number;
  source_metric: string;
  target_metric: string;
  agg_func: 'avg' | 'min' | 'max' | 'sum' | 'count';
  bucket_seconds: number;
  tags_keep?: string[];
  last_processed_ts: number;
  enabled: number;
  created_at: number;
}

export interface SilenceMatcher {
  name: string;
  value: string;
  isRegex: boolean;
  isEqual: boolean;
}

export interface Silence {
  id: number;
  matchers: SilenceMatcher[];
  starts_at: number;
  ends_at: number;
  comment?: string;
  created_by?: string;
  created_at: number;
}

export interface NotificationChannel {
  id: number;
  name: string;
  type: 'webhook' | 'smtp';
  config: Record<string, any>;
  enabled: number;
  created_at: number;
}

export interface RetentionPolicy {
  id: number;
  metric_pattern: string;
  retention_days: number;
  archive: number;
  last_run: number;
  enabled: number;
  created_at: number;
}

export interface PromQLResult {
  result: {
    metric: string;
    tags: Record<string, string | number>;
    values: { timestamp: number; value: number }[];
  }[];
}
