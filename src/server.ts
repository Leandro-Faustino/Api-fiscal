import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createApplicationContainer } from './shared/container.js';
import { prisma } from './shared/infra/database/prisma-client.js';

const env = loadEnv();
const container = createApplicationContainer(env, prisma);
const app = await buildApp({ env, container });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error: unknown) {
  app.log.error(error);
  await prisma.$disconnect();
  process.exit(1);
}
