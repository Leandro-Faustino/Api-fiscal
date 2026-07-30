import type {
  ProcessEcacNotificationEventsResult,
  ProcessEcacNotificationEventsUseCase,
} from '../../application/use-cases/process-ecac-notification-events.js';
import {
  type EcacWorkerLogContext,
  type EcacWorkerLogger,
} from './ecac-scheduled-worker.js';

interface Dependencies {
  processEcacNotificationEventsUseCase: Pick<
    ProcessEcacNotificationEventsUseCase,
    'executeScheduled'
  >;
  logger: EcacWorkerLogger;
  pollIntervalMs: number;
  batchSize: number;
  processingTtlMs: number;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function safeErrorContext(error: unknown): EcacWorkerLogContext {
  if (!(error instanceof Error)) {
    return { errorType: 'unknown' };
  }

  const code =
    'code' in error &&
    (typeof error.code === 'string' || typeof error.code === 'number')
      ? String(error.code).slice(0, 80)
      : null;
  return {
    errorType: error.name.slice(0, 80),
    errorCode: code,
  };
}

export class EcacNotificationWorker {
  private readonly processor: Pick<
    ProcessEcacNotificationEventsUseCase,
    'executeScheduled'
  >;
  private readonly logger: EcacWorkerLogger;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly processingTtlMs: number;
  private controller: AbortController | null = null;

  public constructor({
    processEcacNotificationEventsUseCase,
    logger,
    pollIntervalMs,
    batchSize,
    processingTtlMs,
  }: Dependencies) {
    this.processor = processEcacNotificationEventsUseCase;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this.processingTtlMs = processingTtlMs;
  }

  public async runCycle(): Promise<ProcessEcacNotificationEventsResult | null> {
    const startedAt = Date.now();
    try {
      const result = await this.processor.executeScheduled(
        this.batchSize,
        this.processingTtlMs,
      );
      this.logger.info(
        {
          ...result,
          durationMs: Date.now() - startedAt,
        },
        'ecac.notification_worker.cycle.completed',
      );
      return result;
    } catch (error: unknown) {
      this.logger.error(
        {
          ...safeErrorContext(error),
          durationMs: Date.now() - startedAt,
        },
        'ecac.notification_worker.cycle.failed',
      );
      return null;
    }
  }

  public async run(): Promise<void> {
    if (this.controller !== null) {
      throw new Error('O worker de notificações e-CAC já está em execução.');
    }

    const controller = new AbortController();
    this.controller = controller;
    this.logger.info(
      {
        pollIntervalMs: this.pollIntervalMs,
        batchSize: this.batchSize,
        processingTtlMs: this.processingTtlMs,
      },
      'ecac.notification_worker.started',
    );

    try {
      while (!controller.signal.aborted) {
        await this.runCycle();
        await wait(this.pollIntervalMs, controller.signal);
      }
    } finally {
      this.controller = null;
      this.logger.info({}, 'ecac.notification_worker.stopped');
    }
  }

  public stop(): void {
    this.controller?.abort();
  }
}
