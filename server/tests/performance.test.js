const http = require('http');

const API_BASE = 'http://localhost:3000/api';

function request(path, method, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

function generatePoints(metric, count, startTime, interval) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      metric,
      timestamp: startTime + i * interval,
      value: Math.sin(i / 100) * 50 + 50 + Math.random() * 10,
      tags: { host: `host${i % 10}`, region: 'us-east-1' }
    });
  }
  return points;
}

async function testBatchWrite() {
  console.log('\n=== Test 1: Batch Write Performance ===');
  const totalPoints = 100000;
  const batchSize = 10000;
  const batches = totalPoints / batchSize;
  const startTime = Date.now() - 86400000 * 365;

  let totalWriteTime = 0;

  for (let i = 0; i < batches; i++) {
    const points = generatePoints('cpu.usage', batchSize, startTime + i * batchSize * 1000, 1000);
    const t0 = Date.now();
    const result = await request('/points', 'POST', points);
    const t1 = Date.now();
    totalWriteTime += (t1 - t0);
    console.log(`  Batch ${i + 1}/${batches}: ${result.data.count} points in ${t1 - t0}ms`);
  }

  console.log(`  Total: ${totalPoints} points in ${totalWriteTime}ms (< 2000ms required)`);
  console.log(`  PASS: ${totalWriteTime < 2000}`);
}

async function testOneYearQuery() {
  console.log('\n=== Test 2: One Year Range Query with Downsampling ===');
  const end = Date.now();
  const start = end - 86400000 * 365;

  const t0 = Date.now();
  const result = await request('/query', 'POST', {
    metric: 'cpu.usage',
    start,
    end,
    maxPoints: 1000
  });
  const t1 = Date.now();

  console.log(`  Original points: ${result.data.originalCount}`);
  console.log(`  Returned points: ${result.data.points.length} (≤ 1000 required)`);
  console.log(`  Downsampled: ${result.data.downsampled}`);
  console.log(`  Query time: ${t1 - t0}ms`);
  console.log(`  PASS: ${result.data.points.length <= 1000}`);
}

async function testAlert() {
  console.log('\n=== Test 3: Alert Threshold Trigger ===');

  const ruleResult = await request('/alerts/rules', 'POST', {
    metric: 'test.alert',
    operator: '>',
    threshold: 80,
    duration: 1000
  });
  console.log(`  Created rule ID: ${ruleResult.data.id}`);

  const now = Date.now();
  const points = [];
  for (let i = 0; i < 10; i++) {
    points.push({
      metric: 'test.alert',
      timestamp: now + i * 200,
      value: 85 + Math.random() * 10
    });
  }
  await request('/points', 'POST', points);
  console.log(`  Injected ${points.length} points above threshold`);

  console.log('  Waiting 7 seconds for alert evaluator...');
  await new Promise(r => setTimeout(r, 7000));

  const alerts = await request('/alerts/open', 'GET');
  const matchingAlerts = alerts.data.filter(a => a.rule_id === ruleResult.data.id);

  console.log(`  Open alerts for rule: ${matchingAlerts.length}`);
  console.log(`  PASS: ${matchingAlerts.length > 0}`);

  await request(`/alerts/rules/${ruleResult.data.id}`, 'DELETE');
}

async function main() {
  try {
    console.log('Starting performance tests...');
    await testBatchWrite();
    await testOneYearQuery();
    await testAlert();
    console.log('\n=== All tests completed ===');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

main();
