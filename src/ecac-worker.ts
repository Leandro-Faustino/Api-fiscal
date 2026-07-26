import { loadEnv } from './config/env.js';
import { EcacScheduledWorker } from './modules/ecac/infra/workers/ecac-scheduled-worker.js';
import { createApplicationContainer } from './shared/container.js';
import { prisma } from './shared/infra/database/prisma-client.js';
import { JsonLineWorkerLogger } from './shared/infra/observability/json-line-worker-logger.js';

const env = loadEnv();
const container = createApplicationContainer(env, prisma);
const logger = new JsonLineWorkerLogger();
const worker = new EcacScheduledWorker({
  processEcacJobsUseCase: container.cradle.processEcacJobsUseCase,
  logger,
  pollIntervalMs: env.ECAC_WORKER_POLL_INTERVAL_MS,
  batchSize: env.ECAC_WORKER_BATCH_SIZE,
  lockTtlMs: env.ECAC_WORKER_LOCK_TTL_MS,
});

let signalReceived = false;
const requestShutdown = (signal: string): void => {
  if (signalReceived) {
    return;
  }
  signalReceived = true;
  logger.info({ signal }, 'ecac.worker.shutdown.requested');
  worker.stop();
};

process.once('SIGINT', () => requestShutdown('SIGINT'));
process.once('SIGTERM', () => requestShutdown('SIGTERM'));

try {
  await worker.run();
} catch (error: unknown) {
  logger.error(
    { errorType: error instanceof Error ? error.name : 'unknown' },
    'ecac.worker.fatal',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
