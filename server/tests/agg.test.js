const http = require('http');

async function request(path, method, data) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function test() {
  const now = Date.now();
  const points = [];
  for (let i = 0; i < 65; i++) {
    points.push({
      metric: 'test.agg',
      timestamp: now - (65 - i) * 1000,
      value: i,
      tags: { test: 'bucket' }
    });
  }

  const writeResult = await request('/api/points', 'POST', points);
  console.log('写入:', writeResult);

  const result = await request('/api/query', 'POST', {
    metric: 'test.agg',
    start: now - 70000,
    end: now,
    aggregation: 'avg',
    bucketSeconds: 60
  });

  console.log('\n聚合查询 (bucketSeconds=60):');
  console.log('返回点数:', result.points.length);
  console.log('时间戳差(秒):', result.points.length >= 2
    ? ((result.points[1].timestamp - result.points[0].timestamp) / 1000).toFixed(0) + 's'
    : 'N/A');

  result.points.forEach((p, i) => {
    console.log('  桶' + i + ':', new Date(p.timestamp).toISOString().substr(11, 8), 'avg=' + p.value.toFixed(2));
  });

  console.log('\n=== 验证结果 ===');
  if (result.points.length >= 2) {
    const diff = (result.points[1].timestamp - result.points[0].timestamp) / 1000;
    if (diff === 60) {
      console.log('✅ 桶大小正确：60秒');
    } else {
      console.log('❌ 桶大小错误：' + diff + '秒');
    }
  }

  console.log('\nSwagger 文档路径检查:');
  console.log('访问 http://localhost:3000/docs 查看 API 文档，路径应包含 /api 前缀');
}

test().catch(console.error);
