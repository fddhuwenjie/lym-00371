const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parse } = require('csv-parse');
const { stringify } = require('csv-stringify');
const { minimatch } = require('minimatch');
const { db, getActiveRetentionPolicies, updateRetentionPolicyLastRun, insertPoints, listMetrics } = require('./database');

const ARCHIVE_DIR = path.join(__dirname, '..', 'archives');
const BATCH_SIZE = 10000;

function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
}

function getMatchingMetrics(pattern) {
  const allMetrics = listMetrics();
  return allMetrics.filter(metric => minimatch(metric, pattern));
}

async function archiveMetricData(metric, cutoffTs) {
  ensureArchiveDir();

  const metricDir = path.join(ARCHIVE_DIR, metric);
  if (!fs.existsSync(metricDir)) {
    fs.mkdirSync(metricDir, { recursive: true });
  }

  const minMaxRow = db.prepare(`
    SELECT MIN(ts) as minTs, MAX(ts) as maxTs FROM points
    WHERE metric = ? AND ts < ?
  `).get(metric, cutoffTs);

  if (!minMaxRow || minMaxRow.minTs === null) {
    return 0;
  }

  const minDate = new Date(minMaxRow.minTs);
  const maxDate = new Date(Math.min(minMaxRow.maxTs, cutoffTs - 1));

  const months = [];
  let current = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);

  while (current < end) {
    months.push(current);
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  let monthsArchived = 0;

  for (const monthDate of months) {
    const yyyymm = `${monthDate.getFullYear()}${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = monthDate.getTime();
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime() - 1;

    const archivePath = path.join(metricDir, `${yyyymm}.csv.gz`);

    const rows = db.prepare(`
      SELECT metric, ts, value, tags FROM points
      WHERE metric = ? AND ts >= ? AND ts <= ? AND ts < ?
      ORDER BY ts ASC
    `).all(metric, monthStart, monthEnd, cutoffTs);

    if (rows.length === 0) {
      continue;
    }

    await new Promise((resolve, reject) => {
      const gzip = zlib.createGzip();
      const writeStream = fs.createWriteStream(archivePath);
      const stringifier = stringify({
        header: true,
        columns: ['metric', 'timestamp', 'value', 'tags']
      });

      stringifier.pipe(gzip).pipe(writeStream);

      stringifier.on('error', reject);
      gzip.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);

      for (const row of rows) {
        stringifier.write([row.metric, row.ts, row.value, row.tags]);
      }

      stringifier.end();
    });

    monthsArchived++;
  }

  return monthsArchived;
}

async function processRetentionPolicies() {
  const now = Date.now();
  const nowDate = new Date(now);
  const policies = getActiveRetentionPolicies();

  for (const policy of policies) {
    try {
      const lastRunDate = new Date(policy.last_run || 0);
      const isToday = lastRunDate.toDateString() === nowDate.toDateString();
      const isAfter3AM = nowDate.getHours() >= 3;

      if (isToday || !isAfter3AM) {
        continue;
      }

      const cutoffTs = now - policy.retention_days * 86400000;
      const matchingMetrics = getMatchingMetrics(policy.metric_pattern);

      for (const metric of matchingMetrics) {
        try {
          if (policy.archive) {
            await archiveMetricData(metric, cutoffTs);
          }

          const result = db.prepare(`
            DELETE FROM points WHERE metric = ? AND ts < ?
          `).run(metric, cutoffTs);

          console.log(`[Retention] Deleted ${result.changes} points for metric "${metric}" (policy: ${policy.metric_pattern})`);
        } catch (err) {
          console.error(`[Retention] Error processing metric "${metric}":`, err.message);
        }
      }

      updateRetentionPolicyLastRun(policy.id, now);
    } catch (err) {
      console.error(`[Retention] Error processing policy "${policy.metric_pattern}":`, err.message);
    }
  }
}

async function restoreArchive(metric, month) {
  const archivePath = path.join(ARCHIVE_DIR, metric, `${month}.csv.gz`);

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}`);
  }

  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(archivePath);
    const gunzip = zlib.createGunzip();
    const parser = parse({
      columns: true,
      cast: (value, context) => {
        if (context.column === 'timestamp') return parseInt(value, 10);
        if (context.column === 'value') return parseFloat(value);
        return value;
      }
    });

    const batch = [];
    let totalRestored = 0;

    readStream.pipe(gunzip).pipe(parser);

    parser.on('data', (row) => {
      batch.push({
        metric: row.metric,
        timestamp: row.timestamp,
        value: row.value,
        tags: row.tags || null
      });

      if (batch.length >= BATCH_SIZE) {
        try {
          const result = insertPoints([...batch]);
          totalRestored += result.count;
          batch.length = 0;
        } catch (err) {
          reject(err);
        }
      }
    });

    parser.on('end', () => {
      try {
        if (batch.length > 0) {
          const result = insertPoints(batch);
          totalRestored += result.count;
        }
        resolve({ count: totalRestored });
      } catch (err) {
        reject(err);
      }
    });

    readStream.on('error', reject);
    gunzip.on('error', reject);
    parser.on('error', reject);
  });
}

function listArchives() {
  const result = {};

  if (!fs.existsSync(ARCHIVE_DIR)) {
    return result;
  }

  const metricDirs = fs.readdirSync(ARCHIVE_DIR).filter(entry => {
    const fullPath = path.join(ARCHIVE_DIR, entry);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const metricDir of metricDirs) {
    const metricPath = path.join(ARCHIVE_DIR, metricDir);
    const files = fs.readdirSync(metricPath).filter(file => file.endsWith('.csv.gz'));
    result[metricDir] = files.map(file => file.replace('.csv.gz', '')).sort();
  }

  return result;
}

module.exports = {
  ARCHIVE_DIR,
  BATCH_SIZE,
  ensureArchiveDir,
  getMatchingMetrics,
  archiveMetricData,
  processRetentionPolicies,
  restoreArchive,
  listArchives
};
