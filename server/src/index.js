const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');

const routes = require('./routes');
const specs = require('./swagger');
const { startAlertEvaluator } = require('./alertEvaluator');
const { registerTask, gracefulShutdown } = require('./taskManager');
const { processAllCQs } = require('./cqProcessor');
const { processNotifications } = require('./notifier');
const { processRetentionPolicies } = require('./retention');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api', routes);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specs));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const server = app.listen(PORT, () => {
  console.log(`TSDB Server running on http://localhost:${PORT}`);
  console.log(`API Docs: http://localhost:${PORT}/docs`);

  startAlertEvaluator();

  registerTask('continuous-queries', 30000, processAllCQs);
  registerTask('notifications', 60000, processNotifications);
  registerTask('retention', 3600000, processRetentionPolicies);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, starting graceful shutdown...');
  await gracefulShutdown();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, starting graceful shutdown...');
  await gracefulShutdown();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});
