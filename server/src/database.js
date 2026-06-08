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

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS points (
      metric TEXT NOT NULL,
      ts INTEGER NOT NULL,
      value REAL NOT NULL,
      tags JSON,
      PRIMARY KEY (metric, ts)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_points_metric_ts ON points(metric, ts);
    CREATE INDEX IF NOT EXISTS idx_points_ts ON points(ts);

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      duration INTEGER NOT NULL,
      tags JSON,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
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
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(start_ts);
    CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved);
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
    INSERT INTO alert_rules (metric, operator, threshold, duration, tags, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const result = stmt.run(
    rule.metric,
    rule.operator,
    rule.threshold,
    rule.duration,
    rule.tags ? JSON.stringify(rule.tags) : null,
    Date.now()
  );
  return { id: result.lastInsertRowid };
}

function listAlertRules() {
  return db.prepare(`SELECT * FROM alert_rules ORDER BY created_at DESC`).all();
}

function deleteAlertRule(id) {
  db.prepare(`DELETE FROM alert_rules WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM alerts WHERE rule_id = ?`).run(id);
}

function getActiveAlertRules() {
  return db.prepare(`SELECT * FROM alert_rules WHERE enabled = 1`).all();
}

function getOpenAlerts() {
  return db.prepare(`
    SELECT a.*, ar.tags as rule_tags
    FROM alerts a
    JOIN alert_rules ar ON a.rule_id = ar.id
    WHERE a.resolved = 0
    ORDER BY a.start_ts DESC
  `).all();
}

function createAlert(rule, value, startTs) {
  const existing = db.prepare(`
    SELECT id FROM alerts WHERE rule_id = ? AND resolved = 0
  `).get(rule.id);

  if (existing) return null;

  const stmt = db.prepare(`
    INSERT INTO alerts (rule_id, metric, value, threshold, operator, start_ts, tags, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const result = stmt.run(
    rule.id,
    rule.metric,
    value,
    rule.threshold,
    rule.operator,
    startTs,
    rule.tags
  );
  return { id: result.lastInsertRowid };
}

function resolveAlert(alertId, endTs) {
  db.prepare(`
    UPDATE alerts SET end_ts = ?, resolved = 1 WHERE id = ?
  `).run(endTs, alertId);
}

function listAlerts(limit = 100) {
  return db.prepare(`
    SELECT * FROM alerts ORDER BY start_ts DESC LIMIT ?
  `).all(limit);
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
  listAlerts
};
