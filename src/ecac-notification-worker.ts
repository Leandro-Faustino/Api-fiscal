import { loadEnv } from './config/env.js';
import { EcacNotificationWorker } from './modules/ecac/infra/workers/ecac-notification-worker.js';
import { createApplicationContainer } from './shared/container.js';
import { prisma } from './shared/infra/database/prisma-client.js';
import { JsonLineWorkerLogger } from './shared/infra/observability/json-line-worker-logger.js';

const env = loadEnv();
const container = createApplicationContainer(env, prisma);
const logger = new JsonLineWorkerLogger();
const worker = new EcacNotificationWorker({
  processEcacNotificationEventsUseCase:
    container.cradle.processEcacNotificationEventsUseCase,
  logger,
  pollIntervalMs: env.ECAC_NOTIFICATION_WORKER_POLL_INTERVAL_MS,
  batchSize: env.ECAC_NOTIFICATION_WORKER_BATCH_SIZE,
  processingTtlMs: env.ECAC_NOTIFICATION_WORKER_PROCESSING_TTL_MS,
});

let signalReceived = false;
const requestShutdown = (signal: string): void => {
  if (signalReceived) {
    return;
  }
  signalReceived = true;
  logger.info({ signal }, 'ecac.notification_worker.shutdown.requested');
  worker.stop();
};

process.once('SIGINT', () => requestShutdown('SIGINT'));
process.once('SIGTERM', () => requestShutdown('SIGTERM'));

try {
  await worker.run();
} catch (error: unknown) {
  logger.error(
    { errorType: error instanceof Error ? error.name : 'unknown' },
    'ecac.notification_worker.fatal',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
