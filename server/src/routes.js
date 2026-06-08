const express = require('express');
const router = express.Router();

const {
  insertPoints,
  queryPoints,
  listMetrics,
  getTagsForMetric,
  createAlertRule,
  listAlertRules,
  deleteAlertRule,
  listAlerts,
  getOpenAlerts,
  createContinuousQuery,
  listContinuousQueries,
  deleteContinuousQuery,
  toggleContinuousQuery,
  createNotificationChannel,
  listNotificationChannels,
  deleteNotificationChannel,
  createSilence,
  listSilences,
  deleteSilence,
  createRetentionPolicy,
  listRetentionPolicies,
  deleteRetentionPolicy,
  toggleRetentionPolicy,
  db
} = require('./database');

const { autoDownsample } = require('./lttb');
const { importFromStream, exportToStream } = require('./importExport');
const { parsePromQL, PromQLEvaluator } = require('./promql');
const { restoreArchive, listArchives } = require('./retention');

const MAX_POINTS = 1000;
const evaluator = new PromQLEvaluator(db);

/**
 * @swagger
 * components:
 *   schemas:
 *     Point:
 *       type: object
 *       required:
 *         - metric
 *         - timestamp
 *         - value
 *       properties:
 *         metric:
 *           type: string
 *           description: Metric name
 *         timestamp:
 *           type: integer
 *           description: Unix timestamp in milliseconds
 *         value:
 *           type: number
 *           description: Metric value
 *         tags:
 *           type: object
 *           description: Key-value tags for filtering
 *     AlertRule:
 *       type: object
 *       required:
 *         - metric
 *         - operator
 *         - threshold
 *         - duration
 *       properties:
 *         id:
 *           type: integer
 *           description: Rule ID
 *         metric:
 *           type: string
 *           description: Metric to monitor
 *         operator:
 *           type: string
 *           enum: ['>', '<', '>=', '<=', '==', '!=']
 *           description: Comparison operator
 *         threshold:
 *           type: number
 *           description: Threshold value
 *         duration:
 *           type: integer
 *           description: Duration in milliseconds the condition must hold
 *         tags:
 *           type: object
 *           description: Tag filters
 *         enabled:
 *           type: boolean
 *           description: Whether the rule is enabled
 *         created_at:
 *           type: integer
 *           description: Creation timestamp
 *     Alert:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         rule_id:
 *           type: integer
 *         metric:
 *           type: string
 *         value:
 *           type: number
 *         threshold:
 *           type: number
 *         operator:
 *           type: string
 *         start_ts:
 *           type: integer
 *         end_ts:
 *           type: integer
 *         tags:
 *           type: object
 *         resolved:
 *           type: boolean
 */

/**
 * @swagger
 * /api/points:
 *   post:
 *     summary: Write one or more data points
 *     tags: [Data]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/Point'
 *               - type: array
 *                 items:
 *                   $ref: '#/components/schemas/Point'
 *                 maxItems: 10000
 *     responses:
 *       200:
 *         description: Points written successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                   description: Number of points written
 *       400:
 *         description: Invalid request
 */
router.post('/points', (req, res) => {
  try {
    let points = req.body;
    if (!Array.isArray(points)) {
      points = [points];
    }

    const result = insertPoints(points);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/query:
 *   post:
 *     summary: Query time series data with optional downsampling
 *     tags: [Data]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metric
 *               - start
 *               - end
 *             properties:
 *               metric:
 *                 type: string
 *               start:
 *                 type: integer
 *                 description: Start timestamp (ms)
 *               end:
 *                 type: integer
 *                 description: End timestamp (ms)
 *               tags:
 *                 type: object
 *                 description: Tag filters
 *               aggregation:
 *                 type: string
 *                 enum: [avg, min, max, sum, count]
 *                 description: Aggregation function
 *               bucketSeconds:
 *                 type: integer
 *                 description: Bucket size in seconds for aggregation
 *               maxPoints:
 *                 type: integer
 *                 default: 1000
 *                 description: Maximum number of points to return (downsampling)
 *     responses:
 *       200:
 *         description: Query result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 metric:
 *                   type: string
 *                 points:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: integer
 *                       value:
 *                         type: number
 *                 downsampled:
 *                   type: boolean
 *                 originalCount:
 *                   type: integer
 */
router.post('/query', (req, res) => {
  try {
    const { metric, start, end, tags, aggregation, bucketSeconds, maxPoints } = req.body;

    if (!metric || !start || !end) {
      return res.status(400).json({ error: 'metric, start, and end are required' });
    }

    const rawPoints = queryPoints({
      metric,
      start,
      end,
      tags: tags || {},
      aggregation,
      bucketSeconds
    });

    const threshold = maxPoints || MAX_POINTS;
    const needsDownsample = rawPoints.length > threshold;
    const points = needsDownsample ? autoDownsample(rawPoints, threshold) : rawPoints;

    res.json({
      metric,
      points,
      downsampled: needsDownsample,
      originalCount: rawPoints.length
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     summary: List all available metrics
 *     tags: [Metadata]
 *     responses:
 *       200:
 *         description: List of metric names
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 */
router.get('/metrics', (req, res) => {
  try {
    const metrics = listMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/metrics/{metric}/tags:
 *   get:
 *     summary: Get tags for a specific metric
 *     tags: [Metadata]
 *     parameters:
 *       - in: path
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tag keys and values
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 keys:
 *                   type: array
 *                   items:
 *                     type: string
 *                 values:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: string
 */
router.get('/metrics/:metric/tags', (req, res) => {
  try {
    const tags = getTagsForMetric(req.params.metric);
    res.json(tags);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/rules:
 *   get:
 *     summary: List all alert rules
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: List of alert rules
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/AlertRule'
 */
router.get('/alerts/rules', (req, res) => {
  try {
    const rules = listAlertRules();
    res.json(rules);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/rules:
 *   post:
 *     summary: Create a new alert rule
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AlertRule'
 *     responses:
 *       200:
 *         description: Rule created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 */
router.post('/alerts/rules', (req, res) => {
  try {
    const rule = createAlertRule(req.body);
    res.json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/rules/{id}:
 *   delete:
 *     summary: Delete an alert rule and its associated alerts
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rule deleted
 */
router.delete('/alerts/rules/:id', (req, res) => {
  try {
    deleteAlertRule(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts:
 *   get:
 *     summary: List recent alerts
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of alerts to return
 *     responses:
 *       200:
 *         description: List of alerts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Alert'
 */
router.get('/alerts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const alerts = listAlerts(limit);
    res.json(alerts);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/open:
 *   get:
 *     summary: Get currently open (unresolved) alerts
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: List of open alerts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Alert'
 */
router.get('/alerts/open', (req, res) => {
  try {
    const alerts = getOpenAlerts();
    res.json(alerts);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     ContinuousQuery:
 *       type: object
 *       required:
 *         - source_metric
 *         - target_metric
 *         - agg_func
 *         - bucket_seconds
 *       properties:
 *         id:
 *           type: integer
 *         source_metric:
 *           type: string
 *         target_metric:
 *           type: string
 *         agg_func:
 *           type: string
 *           enum: [avg, min, max, sum, count]
 *         bucket_seconds:
 *           type: integer
 *         tags_keep:
 *           type: array
 *           items:
 *             type: string
 *         last_processed_ts:
 *           type: integer
 *         enabled:
 *           type: boolean
 *         created_at:
 *           type: integer
 *     Silence:
 *       type: object
 *       required:
 *         - matchers
 *         - starts_at
 *         - ends_at
 *       properties:
 *         id:
 *           type: integer
 *         matchers:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               value:
 *                 type: string
 *               isRegex:
 *                 type: boolean
 *               isEqual:
 *                 type: boolean
 *         starts_at:
 *           type: integer
 *         ends_at:
 *           type: integer
 *         comment:
 *           type: string
 *         created_by:
 *           type: string
 *     NotificationChannel:
 *       type: object
 *       required:
 *         - name
 *         - type
 *         - config
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         type:
 *           type: string
 *           enum: [webhook, smtp]
 *         config:
 *           type: object
 *         enabled:
 *           type: boolean
 *     RetentionPolicy:
 *       type: object
 *       required:
 *         - metric_pattern
 *         - retention_days
 *       properties:
 *         id:
 *           type: integer
 *         metric_pattern:
 *           type: string
 *         retention_days:
 *           type: integer
 *         archive:
 *           type: boolean
 *         enabled:
 *           type: boolean
 */

/**
 * @swagger
 * /api/cq:
 *   get:
 *     summary: List all continuous queries
 *     tags: [Continuous Queries]
 *     responses:
 *       200:
 *         description: List of continuous queries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ContinuousQuery'
 */
router.get('/cq', (req, res) => {
  try {
    const cqs = listContinuousQueries();
    res.json(cqs);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/cq:
 *   post:
 *     summary: Create a new continuous query
 *     tags: [Continuous Queries]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ContinuousQuery'
 *     responses:
 *       200:
 *         description: Continuous query created
 */
router.post('/cq', (req, res) => {
  try {
    const result = createContinuousQuery(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/cq/{id}:
 *   delete:
 *     summary: Delete a continuous query
 *     tags: [Continuous Queries]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Continuous query deleted
 */
router.delete('/cq/:id', (req, res) => {
  try {
    deleteContinuousQuery(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/cq/{id}/toggle:
 *   post:
 *     summary: Toggle a continuous query enabled/disabled
 *     tags: [Continuous Queries]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Continuous query toggled
 */
router.post('/cq/:id/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    toggleContinuousQuery(parseInt(req.params.id), enabled);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/import:
 *   post:
 *     summary: Import data in various formats (streaming)
 *     tags: [Import/Export]
 *     requestBody:
 *       required: true
 *       content:
 *         text/csv:
 *           schema:
 *             type: string
 *         application/influxdb-line-protocol:
 *           schema:
 *             type: string
 *         application/openmetrics-text:
 *           schema:
 *             type: string
 *     responses:
 *       200:
 *         description: Import result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 lines:
 *                   type: integer
 */
router.post('/import', async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || 'application/json';
    const result = await importFromStream(req, contentType);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/export:
 *   get:
 *     summary: Export data in various formats (streaming)
 *     tags: [Import/Export]
 *     parameters:
 *       - in: query
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: start
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: end
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, influx, openmetrics]
 *           default: csv
 *     responses:
 *       200:
 *         description: Exported data
 */
router.get('/export', async (req, res) => {
  try {
    const { metric, start, end, format = 'csv' } = req.query;
    if (!metric || !start || !end) {
      return res.status(400).json({ error: 'metric, start, and end are required' });
    }
    await exportToStream(res, format, metric, parseInt(start), parseInt(end));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/silences:
 *   get:
 *     summary: List all active silences
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: include_expired
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: List of silences
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Silence'
 */
router.get('/alerts/silences', (req, res) => {
  try {
    const includeExpired = req.query.include_expired === 'true';
    const silences = listSilences(includeExpired);
    res.json(silences);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/silences:
 *   post:
 *     summary: Create a new silence
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Silence'
 *     responses:
 *       200:
 *         description: Silence created
 */
router.post('/alerts/silences', (req, res) => {
  try {
    const result = createSilence(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/silences/{id}:
 *   delete:
 *     summary: Delete a silence
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Silence deleted
 */
router.delete('/alerts/silences/:id', (req, res) => {
  try {
    deleteSilence(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/channels:
 *   get:
 *     summary: List all notification channels
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: List of notification channels
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/NotificationChannel'
 */
router.get('/alerts/channels', (req, res) => {
  try {
    const channels = listNotificationChannels();
    res.json(channels);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/channels:
 *   post:
 *     summary: Create a new notification channel
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationChannel'
 *     responses:
 *       200:
 *         description: Notification channel created
 */
router.post('/alerts/channels', (req, res) => {
  try {
    const result = createNotificationChannel(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/alerts/channels/{id}:
 *   delete:
 *     summary: Delete a notification channel
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Notification channel deleted
 */
router.delete('/alerts/channels/:id', (req, res) => {
  try {
    deleteNotificationChannel(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/promql:
 *   post:
 *     summary: Execute a PromQL query
 *     tags: [PromQL]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - query
 *               - start
 *               - end
 *               - step
 *             properties:
 *               query:
 *                 type: string
 *                 description: PromQL query string
 *               start:
 *                 type: integer
 *                 description: Start timestamp (ms)
 *               end:
 *                 type: integer
 *                 description: End timestamp (ms)
 *               step:
 *                 type: integer
 *                 description: Step interval in ms
 *     responses:
 *       200:
 *         description: Query result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       metric:
 *                         type: string
 *                       tags:
 *                         type: object
 *                       values:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             timestamp:
 *                               type: integer
 *                             value:
 *                               type: number
 */
router.post('/promql', (req, res) => {
  try {
    const { query, start, end, step } = req.body;
    if (!query || !start || !end || !step) {
      return res.status(400).json({ error: 'query, start, end, and step are required' });
    }

    const ast = parsePromQL(query);
    const result = evaluator.evaluate(ast, parseInt(start), parseInt(end), parseInt(step));
    res.json({ result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/retention:
 *   get:
 *     summary: List all retention policies
 *     tags: [Retention]
 *     responses:
 *       200:
 *         description: List of retention policies
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/RetentionPolicy'
 */
router.get('/retention', (req, res) => {
  try {
    const policies = listRetentionPolicies();
    res.json(policies);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/retention:
 *   post:
 *     summary: Create a new retention policy
 *     tags: [Retention]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RetentionPolicy'
 *     responses:
 *       200:
 *         description: Retention policy created
 */
router.post('/retention', (req, res) => {
  try {
    const result = createRetentionPolicy(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/retention/{id}:
 *   delete:
 *     summary: Delete a retention policy
 *     tags: [Retention]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Retention policy deleted
 */
router.delete('/retention/:id', (req, res) => {
  try {
    deleteRetentionPolicy(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/retention/{id}/toggle:
 *   post:
 *     summary: Toggle a retention policy enabled/disabled
 *     tags: [Retention]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Retention policy toggled
 */
router.post('/retention/:id/toggle', (req, res) => {
  try {
    const { enabled } = req.body;
    toggleRetentionPolicy(parseInt(req.params.id), enabled);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/archives:
 *   get:
 *     summary: List all archived data
 *     tags: [Retention]
 *     responses:
 *       200:
 *         description: Map of metrics to available archive months
 */
router.get('/archives', (req, res) => {
  try {
    const archives = listArchives();
    res.json(archives);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/archives/{file}/restore:
 *   post:
 *     summary: Restore an archived file back to points table
 *     tags: [Retention]
 *     parameters:
 *       - in: path
 *         name: file
 *         required: true
 *         schema:
 *           type: string
 *         description: Archive file identifier in format "metric/yyyymm"
 *     responses:
 *       200:
 *         description: Restore result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 */
router.post('/archives/:file/restore', async (req, res) => {
  try {
    const fileParts = req.params.file.split('/');
    if (fileParts.length !== 2) {
      return res.status(400).json({ error: 'Invalid file format. Use "metric/yyyymm"' });
    }
    const [metric, month] = fileParts;
    const result = await restoreArchive(metric, month);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
