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
