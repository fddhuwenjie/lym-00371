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
  getOpenAlerts
} = require('./database');

const { autoDownsample } = require('./lttb');

const MAX_POINTS = 1000;

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
 * /points:
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
 * /query:
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
 * /metrics:
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
 * /metrics/{metric}/tags:
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
 * /alerts/rules:
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
 * /alerts/rules:
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
 * /alerts/rules/{id}:
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
 * /alerts:
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
 * /alerts/open:
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

module.exports = router;
