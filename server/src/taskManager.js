const tasks = new Map();
let isShuttingDown = false;

function registerTask(name, intervalMs, fn) {
  if (tasks.has(name)) {
    clearInterval(tasks.get(name).interval);
  }

  const wrapper = async () => {
    if (isShuttingDown) return;
    try {
      await fn();
    } catch (err) {
      console.error(`[Task:${name}] Error:`, err.message);
    }
  };

  const interval = setInterval(wrapper, intervalMs);
  tasks.set(name, { interval, fn });
  console.log(`[TaskManager] Registered task '${name}' (every ${intervalMs}ms)`);

  if (intervalMs > 1000) {
    setTimeout(wrapper, 1000);
  }

  return interval;
}

function unregisterTask(name) {
  const task = tasks.get(name);
  if (task) {
    clearInterval(task.interval);
    tasks.delete(name);
    console.log(`[TaskManager] Unregistered task '${name}'`);
  }
}

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n[TaskManager] Starting graceful shutdown...');

  for (const [name, task] of tasks.entries()) {
    clearInterval(task.interval);
    console.log(`[TaskManager] Stopped task '${name}'`);
  }

  console.log('[TaskManager] All background tasks stopped');
  tasks.clear();
}

process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});

module.exports = {
  registerTask,
  unregisterTask,
  gracefulShutdown
};
