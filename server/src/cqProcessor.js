const { getActiveContinuousQueries, updateCQProgress, executeCQ } = require('./database');

async function processAllCQs() {
  const cqs = getActiveContinuousQueries();

  for (const cq of cqs) {
    try {
      const bucketMs = cq.bucket_seconds * 1000;
      const endTs = Math.floor(Date.now() / bucketMs) * bucketMs;

      if (endTs <= cq.last_processed_ts) {
        continue;
      }

      const startTs = cq.last_processed_ts;
      const stmt = executeCQ(cq);
      const result = stmt.run(
        cq.target_metric,
        bucketMs,
        bucketMs,
        cq.source_metric,
        startTs,
        endTs,
        bucketMs,
        bucketMs
      );

      updateCQProgress(cq.id, endTs);

      if (result.changes > 0) {
        console.log(`CQ ${cq.id}: processed ${result.changes} changes for ${cq.target_metric}`);
      }
    } catch (err) {
      console.error(`Error processing CQ ${cq.id}:`, err);
    }
  }
}

module.exports = { processAllCQs };
