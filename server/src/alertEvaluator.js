const { getActiveAlertRules, getOpenAlerts, queryPoints, createAlert, resolveAlert } = require('./database');

const EVALUATION_INTERVAL = 5000;
const WINDOW_FACTOR = 3;

function evaluateRule(rule) {
  const now = Date.now();
  const windowSize = rule.duration * WINDOW_FACTOR;
  const startTime = now - windowSize;

  const data = queryPoints({
    metric: rule.metric,
    start: startTime,
    end: now,
    tags: rule.tags ? JSON.parse(rule.tags) : {}
  });

  if (data.length === 0) return;

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

  for (const point of data) {
    if (checkOperator(point.value)) {
      if (consecutiveStart === null) {
        consecutiveStart = point.timestamp;
      }
      lastViolation = point;

      const durationMs = point.timestamp - consecutiveStart;
      if (durationMs >= rule.duration) {
        createAlert(rule, point.value, consecutiveStart);
        break;
      }
    } else {
      consecutiveStart = null;
    }
  }

  const openAlerts = getOpenAlerts().filter(a => a.rule_id === rule.id);

  for (const alert of openAlerts) {
    const recentData = data.filter(d => d.timestamp >= alert.start_ts);
    const hasRecentViolation = recentData.some(d => checkOperator(d.value));

    if (!hasRecentViolation && lastViolation && (now - lastViolation.timestamp) > rule.duration) {
      resolveAlert(alert.id, lastViolation.timestamp);
    }
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
  startAlertEvaluator
};
