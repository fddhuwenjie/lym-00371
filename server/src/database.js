const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'tsdb.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -65536');
db.pragma('temp_store = MEMORY');

function columnExists(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some(c => c.name === columnName);
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS points (
      metric TEXT NOT NULL,
      ts INTEGER NOT NULL,
      value REAL NOT NULL,
      tags JSON,
      PRIMARY KEY (metric, ts)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      duration INTEGER NOT NULL,
      tags JSON,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      group_by JSON,
      severity TEXT DEFAULT 'warning',
      notification_channels JSON
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      operator TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER,
      tags JSON,
      resolved INTEGER DEFAULT 0,
      group_key TEXT,
      severity TEXT DEFAULT 'warning',
      notified INTEGER DEFAULT 0,
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
    );

    CREATE TABLE IF NOT EXISTS silences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchers JSON NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      comment TEXT,
      created_by TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      config JSON NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS continuous_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_metric TEXT NOT NULL,
      target_metric TEXT NOT NULL,
      agg_func TEXT NOT NULL,
      bucket_seconds INTEGER NOT NULL,
      tags_keep JSON,
      last_processed_ts INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      UNIQUE(source_metric, target_metric, agg_func, bucket_seconds)
    );

    CREATE TABLE IF NOT EXISTS retention_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_pattern TEXT NOT NULL UNIQUE,
      retention_days INTEGER NOT NULL,
      archive INTEGER DEFAULT 0,
      last_run INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `);

  if (!columnExists('alert_rules', 'group_by')) {
    db.exec('ALTER TABLE alert_rules ADD COLUMN group_by JSON');
  }
  if (!columnExists('alert_rules', 'severity')) {
    db.exec("ALTER TABLE alert_rules ADD COLUMN severity TEXT DEFAULT 'warning'");
  }
  if (!columnExists('alert_rules', 'notification_channels')) {
    db.exec('ALTER TABLE alert_rules ADD COLUMN notification_channels JSON');
  }

  if (!columnExists('alerts', 'group_key')) {
    db.exec('ALTER TABLE alerts ADD COLUMN group_key TEXT');
  }
  if (!columnExists('alerts', 'severity')) {
    db.exec("ALTER TABLE alerts ADD COLUMN severity TEXT DEFAULT 'warning'");
  }
  if (!columnExists('alerts', 'notified')) {
    db.exec('ALTER TABLE alerts ADD COLUMN notified INTEGER DEFAULT 0');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_points_metric_ts ON points(metric, ts);
    CREATE INDEX IF NOT EXISTS idx_points_ts ON points(ts);
    CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(start_ts);
    CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
    CREATE INDEX IF NOT EXISTS idx_alerts_group ON alerts(group_key, resolved);
    CREATE INDEX IF NOT EXISTS idx_silences_time ON silences(starts_at, ends_at);
  `);
}

initTables();

const insertPointStmt = db.prepare(`
  INSERT OR REPLACE INTO points (metric, ts, value, tags)
  VALUES (?, ?, ?, ?)
`);

const insertBatchStmt = db.transaction((points) => {
  for (const p of points) {
    insertPointStmt.run(p.metric, p.timestamp, p.value, p.tags ? JSON.stringify(p.tags) : null);
  }
});

function insertPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { count: 0 };
  }
  if (points.length > 10000) {
    throw new Error('Batch size exceeds maximum of 10000');
  }
  insertBatchStmt(points);
  return { count: points.length };
}

function queryPoints(params) {
  const { metric, start, end, tags = {}, aggregation, bucketSeconds } = params;

  let sql = `SELECT `;
  const sqlParams = [];

  if (aggregation && bucketSeconds) {
    const bucketMs = bucketSeconds * 1000;
    const bucket = `(ts / ${bucketMs}) * ${bucketMs}`;
    const aggMap = {
      avg: 'AVG(value)',
      min: 'MIN(value)',
      max: 'MAX(value)',
      sum: 'SUM(value)',
      count: 'COUNT(*)'
    };
    sql += `${bucket} AS ts, ${aggMap[aggregation] || 'AVG(value)'} AS value `;
  } else {
    sql += `ts, value `;
  }

  sql += `FROM points WHERE metric = ? AND ts >= ? AND ts <= ? `;
  sqlParams.push(metric, start, end);

  for (const [key, value] of Object.entries(tags)) {
    sql += `AND json_extract(tags, '$.${key}') = ? `;
    sqlParams.push(value);
  }

  if (aggregation && bucketSeconds) {
    const bucketMs = bucketSeconds * 1000;
    sql += `GROUP BY (ts / ${bucketMs}) * ${bucketMs} `;
  }

  sql += `ORDER BY ts ASC`;

  const stmt = db.prepare(sql);
  const rows = stmt.all(...sqlParams);

  return rows.map(r => ({
    timestamp: r.ts,
    value: r.value
  }));
}

function listMetrics() {
  const rows = db.prepare(`
    SELECT DISTINCT metric FROM points ORDER BY metric
  `).all();
  return rows.map(r => r.metric);
}

function getTagsForMetric(metric) {
  const rows = db.prepare(`
    SELECT DISTINCT tags FROM points WHERE metric = ? AND tags IS NOT NULL
  `).all(metric);

  const tagKeys = new Set();
  const tagValues = {};

  for (const row of rows) {
    try {
      const tags = JSON.parse(row.tags);
      for (const [key, value] of Object.entries(tags)) {
        tagKeys.add(key);
        if (!tagValues[key]) tagValues[key] = new Set();
        tagValues[key].add(value);
      }
    } catch (e) {}
  }

  return {
    keys: Array.from(tagKeys),
    values: Object.fromEntries(
      Object.entries(tagValues).map(([k, v]) => [k, Array.from(v)])
    )
  };
}

function createAlertRule(rule) {
  const stmt = db.prepare(`
    INSERT INTO alert_rules (metric, operator, threshold, duration, tags, enabled, created_at, group_by, severity, notification_channels)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    rule.metric,
    rule.operator,
    rule.threshold,
    rule.duration,
    rule.tags ? JSON.stringify(rule.tags) : null,
    Date.now(),
    rule.group_by ? JSON.stringify(rule.group_by) : null,
    rule.severity || 'warning',
    rule.notification_channels ? JSON.stringify(rule.notification_channels) : null
  );
  return { id: result.lastInsertRowid };
}

function listAlertRules() {
  const rows = db.prepare(`SELECT * FROM alert_rules ORDER BY created_at DESC`).all();
  return rows.map(row => {
    try {
      if (row.tags) row.tags = JSON.parse(row.tags);
    } catch (e) {
      row.tags = {};
    }
    try {
      if (row.group_by) row.group_by = JSON.parse(row.group_by);
    } catch (e) {
      row.group_by = null;
    }
    try {
      if (row.notification_channels) row.notification_channels = JSON.parse(row.notification_channels);
    } catch (e) {
      row.notification_channels = null;
    }
    row.enabled = row.enabled === 1;
    return row;
  });
}

function deleteAlertRule(id) {
  db.prepare(`DELETE FROM alert_rules WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM alerts WHERE rule_id = ?`).run(id);
}

function getActiveAlertRules() {
  const rows = db.prepare(`SELECT * FROM alert_rules WHERE enabled = 1`).all();
  return rows.map(row => {
    try {
      if (row.tags) row.tags = JSON.parse(row.tags);
    } catch (e) {
      row.tags = {};
    }
    try {
      if (row.group_by) row.group_by = JSON.parse(row.group_by);
    } catch (e) {
      row.group_by = null;
    }
    try {
      if (row.notification_channels) row.notification_channels = JSON.parse(row.notification_channels);
    } catch (e) {
      row.notification_channels = null;
    }
    row.enabled = row.enabled === 1;
    return row;
  });
}

function getOpenAlerts() {
  const rows = db.prepare(`
    SELECT a.*, ar.tags as rule_tags
    FROM alerts a
    JOIN alert_rules ar ON a.rule_id = ar.id
    WHERE a.resolved = 0
    ORDER BY a.start_ts DESC
  `).all();
  return rows.map(row => {
    try {
      if (row.tags) row.tags = JSON.parse(row.tags);
    } catch (e) {
      row.tags = {};
    }
    try {
      if (row.rule_tags) row.rule_tags = JSON.parse(row.rule_tags);
    } catch (e) {
      row.rule_tags = {};
    }
    row.resolved = row.resolved === 1;
    row.notified = row.notified === 1;
    return row;
  });
}

function createAlert(rule, value, startTs, groupKey = null, tags = null) {
  const sql = `
    SELECT id FROM alerts WHERE rule_id = ? AND resolved = 0
    ${groupKey !== null ? 'AND group_key = ?' : 'AND group_key IS NULL'}
  `;
  const params = groupKey !== null ? [rule.id, groupKey] : [rule.id];
  const existing = db.prepare(sql).get(...params);

  if (existing) return null;

  const stmt = db.prepare(`
    INSERT INTO alerts (rule_id, metric, value, threshold, operator, start_ts, tags, resolved, group_key, severity, notified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)
  `);
  const result = stmt.run(
    rule.id,
    rule.metric,
    value,
    rule.threshold,
    rule.operator,
    startTs,
    tags !== null ? tags : rule.tags,
    groupKey,
    rule.severity || 'warning'
  );
  return { id: result.lastInsertRowid };
}

function resolveAlert(alertId, endTs) {
  db.prepare(`
    UPDATE alerts SET end_ts = ?, resolved = 1 WHERE id = ?
  `).run(endTs, alertId);
}

function listAlerts(limit = 100) {
  const rows = db.prepare(`
    SELECT * FROM alerts ORDER BY start_ts DESC LIMIT ?
  `).all(limit);
  return rows.map(row => {
    try {
      if (row.tags) row.tags = JSON.parse(row.tags);
    } catch (e) {
      row.tags = {};
    }
    row.resolved = row.resolved === 1;
    row.notified = row.notified === 1;
    return row;
  });
}

function createContinuousQuery(cq) {
  const stmt = db.prepare(`
    INSERT INTO continuous_queries (source_metric, target_metric, agg_func, bucket_seconds, tags_keep, last_processed_ts, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, ?)
  `);
  const result = stmt.run(
    cq.source_metric,
    cq.target_metric,
    cq.agg_func,
    cq.bucket_seconds,
    cq.tags_keep ? JSON.stringify(cq.tags_keep) : null,
    Date.now()
  );
  return { id: result.lastInsertRowid };
}

function listContinuousQueries() {
  const rows = db.prepare(`SELECT * FROM continuous_queries ORDER BY created_at DESC`).all();
  return rows.map(row => {
    try {
      if (row.tags_keep) row.tags_keep = JSON.parse(row.tags_keep);
    } catch (e) {
      row.tags_keep = [];
    }
    row.enabled = row.enabled === 1;
    return row;
  });
}

function deleteContinuousQuery(id) {
  db.prepare(`DELETE FROM continuous_queries WHERE id = ?`).run(id);
}

function toggleContinuousQuery(id, enabled) {
  db.prepare(`UPDATE continuous_queries SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

function getActiveContinuousQueries() {
  const rows = db.prepare(`SELECT * FROM continuous_queries WHERE enabled = 1`).all();
  return rows.map(row => {
    try {
      if (row.tags_keep) row.tags_keep = JSON.parse(row.tags_keep);
    } catch (e) {
      row.tags_keep = [];
    }
    row.enabled = row.enabled === 1;
    return row;
  });
}

function updateCQProgress(id, lastProcessedTs) {
  db.prepare(`UPDATE continuous_queries SET last_processed_ts = ? WHERE id = ?`).run(lastProcessedTs, id);
}

function executeCQ(cq) {
  const bucketMs = cq.bucket_seconds * 1000;
  const aggMap = { avg: 'AVG', min: 'MIN', max: 'MAX', sum: 'SUM', count: 'COUNT' };
  const aggFn = aggMap[cq.agg_func] || 'AVG';

  let tagsKeep = cq.tags_keep;
  if (tagsKeep && typeof tagsKeep === 'string') {
    try {
      tagsKeep = JSON.parse(tagsKeep);
    } catch (e) {
      tagsKeep = null;
    }
  }

  let selectTags = 'NULL';
  let groupByTags = '';
  if (tagsKeep && tagsKeep.length > 0) {
    const tagExtracts = tagsKeep.map(t => `json_extract(tags, '$.${t}')`).join(', ');
    selectTags = `json_object(${tagsKeep.map(t => `'${t}', json_extract(tags, '$.${t}')`).join(', ')})`;
    groupByTags = `, ${tagExtracts}`;
  }

  const sql = `
    INSERT OR REPLACE INTO points (metric, ts, value, tags)
    SELECT
      ? AS metric,
      (ts / ?) * ? AS ts,
      ${aggFn}(value) AS value,
      ${selectTags} AS tags
    FROM points
    WHERE metric = ? AND ts > ? AND ts <= ?
    GROUP BY (ts / ?) * ? ${groupByTags}
    ORDER BY ts ASC
  `;

  return db.prepare(sql);
}

function createNotificationChannel(channel) {
  const stmt = db.prepare(`
    INSERT INTO notification_channels (name, type, config, enabled, created_at)
    VALUES (?, ?, ?, 1, ?)
  `);
  const result = stmt.run(
    channel.name,
    channel.type,
    JSON.stringify(channel.config),
    Date.now()
  );
  return { id: result.lastInsertRowid };
}

function listNotificationChannels() {
  const rows = db.prepare(`SELECT * FROM notification_channels ORDER BY created_at DESC`).all();
  return rows.map(row => {
    try {
      row.config = JSON.parse(row.config);
    } catch (e) {
      row.config = {};
    }
    return row;
  });
}

function deleteNotificationChannel(id) {
  db.prepare(`DELETE FROM notification_channels WHERE id = ?`).run(id);
}

function createSilence(silence) {
  const stmt = db.prepare(`
    INSERT INTO silences (matchers, starts_at, ends_at, comment, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    JSON.stringify(silence.matchers),
    silence.starts_at,
    silence.ends_at,
    silence.comment || null,
    silence.created_by || null,
    Date.now()
  );
  return { id: result.lastInsertRowid };
}

function listSilences(includeExpired = false) {
  const now = Date.now();
  let rows;
  if (includeExpired) {
    rows = db.prepare(`SELECT * FROM silences ORDER BY created_at DESC`).all();
  } else {
    rows = db.prepare(`SELECT * FROM silences WHERE ends_at > ? ORDER BY created_at DESC`).all(now);
  }
  return rows.map(row => {
    try {
      row.matchers = JSON.parse(row.matchers);
    } catch (e) {
      row.matchers = [];
    }
    return row;
  });
}

function deleteSilence(id) {
  db.prepare(`DELETE FROM silences WHERE id = ?`).run(id);
}

function getActiveSilences() {
  const now = Date.now();
  return db.prepare(`SELECT * FROM silences WHERE starts_at <= ? AND ends_at > ?`).all(now, now);
}

function createRetentionPolicy(policy) {
  const stmt = db.prepare(`
    INSERT INTO retention_policies (metric_pattern, retention_days, archive, last_run, enabled, created_at)
    VALUES (?, ?, ?, 0, 1, ?)
  `);
  const result = stmt.run(
    policy.metric_pattern,
    policy.retention_days,
    policy.archive ? 1 : 0,
    Date.now()
  );
  return { id: result.lastInsertRowid };
}

function listRetentionPolicies() {
  const rows = db.prepare(`SELECT * FROM retention_policies ORDER BY created_at DESC`).all();
  return rows.map(row => {
    row.enabled = row.enabled === 1;
    row.archive = row.archive === 1;
    return row;
  });
}

function deleteRetentionPolicy(id) {
  db.prepare(`DELETE FROM retention_policies WHERE id = ?`).run(id);
}

function toggleRetentionPolicy(id, enabled) {
  db.prepare(`UPDATE retention_policies SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

function getActiveRetentionPolicies() {
  const rows = db.prepare(`SELECT * FROM retention_policies WHERE enabled = 1`).all();
  return rows.map(row => {
    row.enabled = row.enabled === 1;
    row.archive = row.archive === 1;
    return row;
  });
}

function updateRetentionPolicyLastRun(id, lastRun) {
  db.prepare(`UPDATE retention_policies SET last_run = ? WHERE id = ?`).run(lastRun, id);
}

function getUnnotifiedFiringAlerts() {
  return db.prepare(`
    SELECT a.*, ar.group_by, ar.notification_channels
    FROM alerts a
    JOIN alert_rules ar ON a.rule_id = ar.id
    WHERE a.resolved = 0 AND a.notified = 0
    ORDER BY a.group_key, a.start_ts
  `).all();
}

function markAlertNotified(alertId) {
  db.prepare(`UPDATE alerts SET notified = 1 WHERE id = ?`).run(alertId);
}

module.exports = {
  db,
  insertPoints,
  queryPoints,
  listMetrics,
  getTagsForMetric,
  createAlertRule,
  listAlertRules,
  deleteAlertRule,
  getActiveAlertRules,
  getOpenAlerts,
  createAlert,
  resolveAlert,
  listAlerts,
  createContinuousQuery,
  listContinuousQueries,
  deleteContinuousQuery,
  toggleContinuousQuery,
  getActiveContinuousQueries,
  updateCQProgress,
  executeCQ,
  createNotificationChannel,
  listNotificationChannels,
  deleteNotificationChannel,
  createSilence,
  listSilences,
  deleteSilence,
  getActiveSilences,
  createRetentionPolicy,
  listRetentionPolicies,
  deleteRetentionPolicy,
  toggleRetentionPolicy,
  getActiveRetentionPolicies,
  updateRetentionPolicyLastRun,
  getUnnotifiedFiringAlerts,
  markAlertNotified
};
