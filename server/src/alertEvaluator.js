const { getActiveAlertRules, getOpenAlerts, queryPoints, createAlert, resolveAlert, db } = require('./database');

const EVALUATION_INTERVAL = 5000;
const WINDOW_FACTOR = 3;

function getRawPointsWithTags(metric, start, end, ruleTags) {
  let sql = `SELECT ts, value, tags FROM points WHERE metric = ? AND ts >= ? AND ts <= ?`;
  const params = [metric, start, end];

  if (ruleTags) {
    for (const [key, value] of Object.entries(ruleTags)) {
      sql += ` AND json_extract(tags, '$.${key}') = ?`;
      params.push(value);
    }
  }

  sql += ` ORDER BY ts ASC`;

  return db.prepare(sql).all(...params);
}

function evaluateGroup(rule, groupData, groupKey, groupTags) {
  const now = Date.now();

  const checkOperator = (value) => {
    switch (rule.operator) {
      case '>': return value > rule.threshold;
      case '<': return value < rule.threshold;
      case '>=': return value >= rule.threshold;
      case '<=': return value <= rule.threshold;
      case '==': return value === rule.threshold;
      case '!=': return value !== rule.threshold;
      default: return false;
    }
  };

  let consecutiveStart = null;
  let lastViolation = null;

  for (const point of groupData) {
    if (checkOperator(point.value)) {
      if (consecutiveStart === null) {
        consecutiveStart = point.ts;
      }
      lastViolation = point;

      const durationMs = point.ts - consecutiveStart;
      if (durationMs >= rule.duration) {
        createAlert(rule, point.value, consecutiveStart, groupKey, JSON.stringify(groupTags));
        break;
      }
    } else {
      consecutiveStart = null;
    }
  }

  const sql = `
    SELECT * FROM alerts WHERE rule_id = ? AND resolved = 0
    ${groupKey !== null ? 'AND group_key = ?' : 'AND group_key IS NULL'}
  `;
  const params = groupKey !== null ? [rule.id, groupKey] : [rule.id];
  const openAlerts = db.prepare(sql).all(...params);

  for (const alert of openAlerts) {
    const recentData = groupData.filter(d => d.ts >= alert.start_ts);
    const hasRecentViolation = recentData.some(d => checkOperator(d.value));

    if (!hasRecentViolation && lastViolation && (now - lastViolation.ts) > rule.duration) {
      resolveAlert(alert.id, lastViolation.ts);
    }
  }
}

function evaluateRule(rule) {
  const now = Date.now();
  const windowSize = rule.duration * WINDOW_FACTOR;
  const startTime = now - windowSize;
  const ruleTags = rule.tags ? JSON.parse(rule.tags) : null;
  const groupBy = rule.group_by ? JSON.parse(rule.group_by) : null;

  const data = getRawPointsWithTags(rule.metric, startTime, now, ruleTags);

  if (data.length === 0) return;

  if (groupBy && groupBy.length > 0) {
    const groups = new Map();

    for (const point of data) {
      const tags = point.tags ? JSON.parse(point.tags) : {};
      const groupValues = [];
      const groupTags = {};

      for (const key of groupBy) {
        const val = tags[key] !== undefined ? tags[key] : null;
        groupValues.push(val);
        groupTags[key] = val;
      }

      const groupKey = groupValues.join('|');

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { data: [], tags: groupTags });
      }
      groups.get(groupKey).data.push(point);
    }

    for (const [groupKey, group] of groups) {
      evaluateGroup(rule, group.data, groupKey, group.tags);
    }
  } else {
    const tags = ruleTags || {};
    evaluateGroup(rule, data, null, tags);
  }
}

function startAlertEvaluator() {
  console.log('Starting alert evaluator (interval: 5s)...');

  setInterval(() => {
    try {
      const rules = getActiveAlertRules();
      for (const rule of rules) {
        evaluateRule(rule);
      }
    } catch (err) {
      console.error('Alert evaluation error:', err);
    }
  }, EVALUATION_INTERVAL);
}

module.exports = {
  startAlertEvaluator,
  evaluateRule
};
